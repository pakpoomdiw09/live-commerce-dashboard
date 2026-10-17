import 'server-only'
import { canAccessTenant } from './auth'
import { assertAutomationRunning } from './automation-safety'
import { getBilling } from './billing'
import { SendApiError, sendMessageWithReceipt } from './facebook'
import { broadcastPolicyVerified, recipientReason } from './broadcast-policy'
import { broadcastEvidence, broadcastPageStatus, broadcastSignature, selectedBroadcastCustomers, type BroadcastScope } from './broadcast-service'
import type { BroadcastRow } from './chatbot'
import { InboxError } from './inbox-server'
import { fetchAll } from './broadcast'

export async function broadcastDeliveryStats(scope: BroadcastScope, id: string) {
  const deliveries = await fetchAll<{ customer_id: string; status: string; reason: string | null }>((from, to) => scope.db.from('broadcast_deliveries').select('customer_id,status,reason').eq('tenant_id', scope.tenantId).eq('broadcast_id', id).order('customer_id').range(from, to))
  return { deliveries, sent: deliveries.filter(row => ['accepted', 'delivered', 'read'].includes(row.status)).length,
    delivered: deliveries.filter(row => ['delivered', 'read'].includes(row.status)).length, read: deliveries.filter(row => row.status === 'read').length,
    failed: deliveries.filter(row => row.status === 'failed').length, unknown: deliveries.filter(row => ['unknown', 'claimed'].includes(row.status)).length,
    skipped: deliveries.filter(row => row.status === 'skipped').length }
}

/** No automatic retry of a claimed recipient, including after a transport timeout. */
export async function sendBroadcast(scope: BroadcastScope, draft: BroadcastRow, input: { confirmed?: unknown; fingerprint?: unknown }) {
  if (input.confirmed !== true || input.fingerprint !== broadcastSignature(scope.tenantId, scope.page.page_id, draft)) throw new InboxError('ข้อมูลเปลี่ยนแล้ว กรุณาตรวจสอบผู้รับและยืนยันใหม่', 409, 'PREVIEW_CHANGED')
  if (draft.audience_window !== 'within_24h' || draft.message_tag) throw new InboxError('ยังไม่เปิดช่องทางส่งนอกช่วงเวลามาตรฐาน และไม่ใช้ Human Agent กับบรอดแคสต์', 409, 'UNSUPPORTED_CHANNEL')
  if (!broadcastPolicyVerified()) throw new InboxError('ยังไม่เปิดส่งจริง ต้องตรวจนโยบาย Meta และสิทธิ์แอปก่อน', 409, 'POLICY_UNVERIFIED')
  if (!scope.token || await broadcastPageStatus(scope) !== 'verified') throw new InboxError('ยังยืนยันสิทธิ์การส่งของเพจไม่ได้', 409, 'PAGE_UNVERIFIED')
  await assertAutomationRunning(scope.db, scope.tenantId)
  if (draft.status === 'sent') { const stats = await broadcastDeliveryStats(scope, draft.id); return { ...stats, deliveries: undefined, done: true, remaining: 0, total: draft.total } }
  const claim = await scope.db.rpc('claim_broadcast_run', { p_broadcast: draft.id, p_actor: scope.actor.id })
  if (claim.error?.code === '40001') throw new InboxError('รายการเดิมต้องตรวจสอบผลก่อน ระบบจะไม่ส่งซ้ำจากประวัติที่ยังยืนยันไม่ได้', 409, 'LEGACY_REVIEW_REQUIRED')
  if (claim.error) throw new InboxError('ระบบส่งยังไม่พร้อม กรุณาตรวจการติดตั้ง broadcast-policy.sql', 503, 'BROADCAST_SCHEMA_REQUIRED')
  if (!claim.data) throw new InboxError('รายการนี้กำลังส่งอยู่ กรุณารอสักครู่แล้วตรวจสถานะ', 409, 'BROADCAST_BUSY')
  const lease = claim.data as string
  try {
    // Claim freezes content in the database; detect edits racing the initial read.
    const locked = await scope.db.from('broadcasts').select('name,message,audience_segment,audience_tags,audience_window,message_tag').eq('id', draft.id).eq('tenant_id', scope.tenantId).maybeSingle()
    if (locked.error || !locked.data || locked.data.audience_window !== 'within_24h' || locked.data.message_tag || broadcastSignature(scope.tenantId, scope.page.page_id, locked.data) !== input.fingerprint) throw new InboxError('ฉบับร่างเปลี่ยนแล้ว กรุณาเปิดรายการและตรวจผู้รับใหม่', 409, 'PREVIEW_CHANGED')
    const customers = await selectedBroadcastCustomers(scope.db, scope.tenantId, draft.audience_segment, draft.audience_tags)
    const previous = await broadcastDeliveryStats(scope, draft.id)
    const attempted = new Set(previous.deliveries.map(row => row.customer_id))
    const queue = customers.filter(customer => !attempted.has(customer.id))
    const deadline = Date.now() + 25_000
    let processed = 0, outOfCredits = false
    for (const customer of queue) {
      if (processed >= 20 || Date.now() >= deadline) break
      if (!broadcastPolicyVerified() || !await canAccessTenant(scope.actor, scope.tenantId, 'owner')) throw new InboxError('สิทธิ์หรือการอนุญาตส่งเปลี่ยนแล้ว กรุณาตรวจสอบใหม่', 409)
      await assertAutomationRunning(scope.db, scope.tenantId)
      const currentPage = await scope.db.from('tenants').select('page_id,page_access_token,is_active').eq('id', scope.tenantId).maybeSingle()
      if (currentPage.error || !currentPage.data?.is_active || currentPage.data.page_id !== scope.page.page_id) throw new InboxError('เพจหรือสถานะร้านเปลี่ยนแล้ว กรุณาตรวจสอบใหม่', 409, 'PAGE_CHANGED')
      const billing = await getBilling(scope.db, scope.tenantId, scope.actor.isPlatformAdmin)
      if (billing.monthly + billing.topup < 1) { outOfCredits = true; break }
      // Evidence is fetched again for each recipient, not reused from the preview.
      const evidence = await broadcastEvidence(scope.db, scope.tenantId)
      const fresh = await scope.db.from('customers').select('agent_opted_out').eq('id', customer.id).eq('tenant_id', scope.tenantId).maybeSingle()
      if (fresh.error || !fresh.data) throw new InboxError('ตรวจสิทธิ์ผู้รับไม่ได้ ระบบหยุดส่งไว้ก่อน', 503)
      const reason = recipientReason({ evidence: evidence.get(customer.id), pageId: scope.page.page_id, optedOut: fresh.data.agent_opted_out, pageVerified: true, policyVerified: broadcastPolicyVerified(), credits: billing.monthly + billing.topup }, Date.now())
      const reserved = await scope.db.rpc('claim_broadcast_recipient', { p_broadcast: draft.id, p_customer: customer.id, p_lease: lease })
      if (reserved.error) throw new InboxError('จองสิทธิ์ส่งไม่ได้ ระบบหยุดไว้ก่อน', 503)
      if (reserved.data === 'credits_exhausted') { outOfCredits = true; break }
      processed++
      if (reserved.data !== 'claimed') continue
      const settle = async (result: string, detail: string | null, receipt: string | null = null) => {
        const saved = await scope.db.rpc('settle_broadcast_recipient', { p_broadcast: draft.id, p_customer: customer.id, p_lease: lease, p_result: result, p_reason: detail, p_receipt: receipt })
        if (saved.error) throw new InboxError('บันทึกผลส่งไม่ได้ ต้องตรวจสอบรายการนี้ก่อน ห้ามส่งซ้ำ', 503, 'SEND_REQUIRES_REVIEW')
      }
      if (reason !== 'eligible') { await settle('skipped', reason); continue }
      const started = await scope.db.rpc('begin_broadcast_transport', { p_broadcast: draft.id, p_customer: customer.id, p_lease: lease })
      if (started.error) throw new InboxError('ตรวจสิทธิ์ก่อนส่งไม่ได้', 503)
      if (started.data !== true) continue
      try { await assertAutomationRunning(scope.db, scope.tenantId) }
      catch (error) { await settle('skipped', 'automation_stopped'); throw error }
      // One physical message and one reservation. Never fall back to a tag or another channel.
      try {
        const receipt = await sendMessageWithReceipt(scope.token, customer.platform_user_id, { text: draft.message }, 'UPDATE')
        await settle('accepted', null, receipt)
        const transcript = await scope.db.from('messages').insert({ customer_id: customer.id, external_id: `bc:${draft.id}:${customer.id}`, sender: 'bot', body: draft.message, provider_message_id: receipt, delivery_status: 'sent' })
        if (transcript.error) console.warn('[broadcast] transcript unavailable', { code: transcript.error.code })
      } catch (error) {
        if (error instanceof InboxError) throw error
        const refused = error instanceof SendApiError && error.status < 500
        await settle(refused ? 'failed' : 'unknown', refused ? 'api_rejected' : 'transport_uncertain')
      }
    }
    const stats = await broadcastDeliveryStats(scope, draft.id)
    const remaining = Math.max(0, queue.length - processed), done = remaining === 0
    const total = Math.max(customers.length, stats.deliveries.length)
    const updated = await scope.db.from('broadcasts').update({ total, sent: stats.sent, failed: stats.failed, skipped: stats.skipped, status: done ? 'sent' : 'sending', last_error: stats.unknown ? 'บางรายการยังไม่ทราบผล ห้ามส่งซ้ำอัตโนมัติ' : outOfCredits ? 'เครดิตข้อความไม่พอ' : null, ...(done ? { finished_at: new Date().toISOString() } : {}) }).eq('id', draft.id).eq('tenant_id', scope.tenantId)
    if (updated.error) throw new InboxError('บันทึกสรุปไม่สำเร็จ กรุณาตรวจประวัติก่อนส่งต่อ', 503)
    return { ...stats, deliveries: undefined, total, remaining, done, outOfCredits }
  } finally {
    // Release only our own lease; uncertainty remains durable in the recipient ledger.
    await scope.db.from('broadcast_runs').update({ locked_until: new Date().toISOString() }).eq('broadcast_id', draft.id).eq('lease', lease)
  }
}
