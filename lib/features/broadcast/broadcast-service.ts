import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canAccessTenant, type Actor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getBilling } from '@/lib/features/billing/billing'
import { getPageTokenStatus, pageTokenFor } from '@/lib/integrations/facebook/client'
import { BROADCAST_COLUMNS, type BroadcastRow, type BroadcastSegment } from '@/lib/features/agents/chatbot'
import { fetchAll } from '@/lib/features/broadcast/broadcast'
import { broadcastReadiness, broadcastPolicyVerified, broadcastReasonLabels, recipientReason, standardWindowReason, type BroadcastEvidence, type BroadcastReason } from '@/lib/features/broadcast/broadcast-policy'
import { InboxError } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'

export type BroadcastDraft = { name: string; message: string; audience_segment: BroadcastSegment; audience_tags: string[]; selected_customer_ids?: string[] | null }
export function parseBroadcastDraft(input: unknown): BroadcastDraft {
  const value = input as Record<string, unknown> | null
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 100) throw new InboxError('ใส่ชื่อรายการไม่เกิน 100 ตัวอักษร', 400, 'INVALID_NAME')
  if (typeof value.message !== 'string' || !value.message.trim() || value.message.trim().length > 2000) throw new InboxError('ใส่ข้อความไม่เกิน 2,000 ตัวอักษร', 400, 'INVALID_MESSAGE')
  if (!['all', 'pending_payment', 'paid_before'].includes(String(value.audience_segment))) throw new InboxError('เลือกกลุ่มลูกค้าให้ถูกต้อง', 400)
  if (!Array.isArray(value.audience_tags) || value.audience_tags.length > 20 || value.audience_tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80)) throw new InboxError('เลือกแท็กไม่เกิน 20 แท็ก และแท็กละไม่เกิน 80 ตัวอักษร', 400)
  if (value.message_tag || value.audience_window && value.audience_window !== 'within_24h' || value.scheduled_at || value.attachments || value.buttons) throw new InboxError('ยังไม่รองรับช่องทาง รูปภาพ ปุ่ม หรือตั้งเวลานี้', 400, 'UNSUPPORTED_CHANNEL')
  if(value.selected_customer_ids!=null&&(!Array.isArray(value.selected_customer_ids)||value.selected_customer_ids.length>10000||value.selected_customer_ids.some(id=>typeof id!=='string'||!UUID.test(id))))throw new InboxError('Invalid recipient selection',400)
  return { selected_customer_ids:value.selected_customer_ids==null?null:[...new Set(value.selected_customer_ids as string[])], name: value.name.trim(), message: value.message.trim(), audience_segment: value.audience_segment as BroadcastSegment, audience_tags: [...new Set(value.audience_tags as string[])] }
}
export function broadcastSignature(tenantId: string, pageId: string | null, draft: Pick<BroadcastRow, 'name' | 'message' | 'audience_segment' | 'audience_tags' | 'selected_customer_ids'>) {
  return createHash('sha256').update(JSON.stringify([tenantId, pageId, draft.name, draft.message, draft.audience_segment, [...draft.audience_tags].sort(),draft.selected_customer_ids?[...draft.selected_customer_ids].sort():null])).digest('hex')
}
export async function broadcastScope(actor: Actor | null, tenantId: string, owner = false) {
  if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
  if (!UUID.test(tenantId) || !await canAccessTenant(actor, tenantId, owner ? 'owner' : 'staff')) throw new InboxError('ไม่พบร้านค้าหรือไม่มีสิทธิ์', 403)
  const db = supabaseAdmin()
  const page = await db.from('tenants').select('id,name,page_name,page_id,page_access_token,is_active').eq('id', tenantId).maybeSingle()
  if (page.error || !page.data || !page.data.is_active) throw new InboxError('ไม่พบเพจที่เปิดใช้งาน', 409)
  return { db, actor, tenantId, page: page.data, token: pageTokenFor(page.data) }
}
export type BroadcastScope = Awaited<ReturnType<typeof broadcastScope>>
export async function readBroadcast(db: SupabaseClient, id: string, tenantId?: string) {
  if (!UUID.test(id)) throw new InboxError('รหัสรายการไม่ถูกต้อง', 400)
  let query = db.from('broadcasts').select(BROADCAST_COLUMNS).eq('id', id)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const result = await query.maybeSingle()
  if (result.error || !result.data) throw new InboxError('ไม่พบรายการบรอดแคสต์', 404)
  return result.data as BroadcastRow
}
export type BroadcastCustomer = { id: string; platform_user_id: string; display_name: string | null; agent_opted_out?: boolean }
export async function selectedBroadcastCustomers(db: SupabaseClient, tenantId: string, segment: BroadcastSegment, tags: string[]) {
  const select = (columns: string) => fetchAll<BroadcastCustomer>((start, end) => {
    let query = db.from('customers').select(columns).eq('tenant_id', tenantId).eq('platform', 'facebook')
    if (tags.length) query = query.overlaps('tags', tags)
    return query.order('id').range(start, end).returns<BroadcastCustomer[]>()
  })
  let customers: BroadcastCustomer[]
  try { customers = await select('id,platform_user_id,display_name,agent_opted_out') }
  catch { customers = await select('id,platform_user_id,display_name') }
  const unique = [...new Map(customers.map(customer => [customer.id, customer])).values()]
  if (segment === 'all') return unique
  const orders = await fetchAll<{ customer_id: string }>((start, end) => db.from('orders').select('customer_id').eq('tenant_id', tenantId).in('status', segment === 'pending_payment' ? ['pending_payment'] : ['paid', 'shipped']).order('id').range(start, end))
  const ids = new Set(orders.map(order => order.customer_id))
  return unique.filter(customer => ids.has(customer.id))
}
export async function broadcastEvidence(db: SupabaseClient, tenantId: string, pageId?:string|null, customerId?:string) {
  const events = await fetchAll<BroadcastEvidence & { customer_id: string }>((start,end)=>{
    let query=db.from('broadcast_messaging_events').select('customer_id,event_id,page_id,kind,interacted_at').eq('tenant_id',tenantId).eq('kind','inbound_message')
    if(pageId)query=query.eq('page_id',pageId)
    if(customerId)query=query.eq('customer_id',customerId)
    // Preview needs only currently open windows, not years of webhook history.
    // Individual transport checks still read the latest event at any age.
    else query=query.gte('interacted_at',new Date(Date.now()-24*60*60*1000).toISOString())
    return query.order('interacted_at',{ascending:false}).order('event_id').range(start,customerId?start:end)
  })
  const latest = new Map<string, BroadcastEvidence>()
  for (const event of events) if (!latest.has(event.customer_id)) latest.set(event.customer_id, event)
  return latest
}
export async function broadcastPageStatus(scope: BroadcastScope) {
  if (!scope.token || !scope.page.page_id) return 'missing' as const
  return getPageTokenStatus(scope.token, scope.page.page_id)
}
export async function previewBroadcast(scope: BroadcastScope, draft: BroadcastRow) {
  const [customers, status, billing] = await Promise.all([
    selectedBroadcastCustomers(scope.db, scope.tenantId, draft.audience_segment, draft.audience_tags), broadcastPageStatus(scope),
    getBilling(scope.db, scope.tenantId, scope.actor.isPlatformAdmin),
  ])
  let evidence = new Map<string, BroadcastEvidence>(), evidenceReady = true
  try { evidence = await broadcastEvidence(scope.db, scope.tenantId,scope.page.page_id) } catch { evidenceReady = false }
  const now = Date.now(), policyVerified = broadcastPolicyVerified(now), credits = billing.monthly + billing.topup
  const attempted = new Set<string>()
  if (draft.status !== 'draft') {
    const processed = await fetchAll<{ customer_id: string }>((start, end) => scope.db.from('broadcast_deliveries').select('customer_id').eq('tenant_id', scope.tenantId).eq('broadcast_id', draft.id).order('customer_id').range(start, end))
    for (const row of processed) attempted.add(row.customer_id)
  }
  let allocated = 0, within = 0, outside = 0, missing = 0
  const reasons: Partial<Record<BroadcastReason, number>> = {}
  const members = customers.filter(customer=>!draft.selected_customer_ids||draft.selected_customer_ids.includes(customer.id)).map(customer => {
    const window = standardWindowReason(evidence.get(customer.id), scope.page.page_id, now)
    if (window === 'eligible') within++; else if (window === 'outside_window') outside++; else missing++
    const reason = attempted.has(customer.id) ? 'already_processed' : recipientReason({ evidence: evidence.get(customer.id), pageId: scope.page.page_id, optedOut: customer.agent_opted_out, pageVerified: status === 'verified', policyVerified, credits: credits - allocated, channel: draft.audience_window, tag: draft.message_tag }, now)
    if (reason === 'eligible') allocated++
    reasons[reason] = (reasons[reason] ?? 0) + 1
    return { id: customer.id, name: customer.display_name ?? 'ลูกค้า', reason, detail: reason==='policy_unverified'?broadcastReadiness(now).message:broadcastReasonLabels[reason], lastInteractionAt:evidence.get(customer.id)?.interacted_at??null, windowEligible:window==='eligible' }
  })
  return { total: customers.length, reachable: allocated, skipped: customers.length - allocated, within, outside, missing, reasons,
    members, membersLimited: false, checkedAt: new Date(now).toISOString(),
    fingerprint: broadcastSignature(scope.tenantId, scope.page.page_id, draft),
    draft: { name: draft.name, message: draft.message, audience_segment: draft.audience_segment, audience_tags: draft.audience_tags },
    page: { id: scope.page.page_id, name: scope.page.page_name ?? scope.page.name, status },
    policyVerified, readiness: broadcastReadiness(now), evidenceReady, credits, estimatedCredits: allocated, channel: 'standard', outsideEnabled: false,
  }
}
export type BroadcastPreviewResult = Awaited<ReturnType<typeof previewBroadcast>>
