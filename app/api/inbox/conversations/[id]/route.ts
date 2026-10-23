import { NextRequest, NextResponse } from 'next/server'
import { inboxCustomer, inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import { hasFeature } from '@/lib/feature-access'
import { aiConfigured } from '@/lib/features/agents/ai-agent'
import { UUID } from '@/lib/utils'
type Context = { params: Promise<{ id: string }> }
export async function GET(req: NextRequest, { params }: Context) {
  try {
    const { db, customer, tenantId } = await inboxCustomer(req, (await params).id)
    const pro = process.env.SMART_INBOX_PRO_ENABLED === 'true'
    const [events, orders, followups] = await Promise.all([
      db
        .from('conversation_events')
        .select(
          'id,actor_id,action,previous_assignee,next_assignee,created_at' + (pro ? ',reason' : ''),
        )
        .eq('tenant_id', tenantId)
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
        .limit(20),
      db
        .from('orders')
        .select('id,product_name,amount,status,created_at')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
        .limit(20),
      pro && (await hasFeature(db, tenantId, 'customer_follow_up'))
        ? db
            .from('follow_up_jobs')
            .select('id,kind,status,run_at,sent_at,reason')
            .eq('tenant_id', tenantId)
            .eq('customer_id', customer.id)
            .order('created_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (events.error || orders.error || followups.error)
      throw events.error || orders.error || followups.error
    return NextResponse.json(
      { customer, events: events.data, orders: orders.data, followups: followups.data },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { db, actor, customer, tenantId } = await inboxCustomer(req, (await params).id)
    const pro = process.env.SMART_INBOX_PRO_ENABLED === 'true'
    if (pro) {
      const origin = req.headers.get('origin'),
        site = req.headers.get('sec-fetch-site')
      if ((origin && origin !== req.nextUrl.origin) || site === 'cross-site')
        throw new InboxError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น', 403)
    }
    const input = await req.json().catch(() => null)
    if (
      !input ||
      !(
        pro
          ? ['claim', 'transfer', 'release', 'start', 'resolve', 'close', 'reopen', 'pause', 'bot']
          : ['claim', 'transfer', 'close', 'reopen', 'pause', 'bot']
      ).includes(input.action) ||
      !Number.isInteger(input.version) ||
      input.version < 0 ||
      (input.action === 'transfer' && !UUID.test(input.assigneeId ?? ''))
    )
      throw new InboxError('ข้อมูลการจัดการแชทไม่ถูกต้อง')
    if (
      pro &&
      (!UUID.test(input.requestId ?? '') ||
        (input.reason !== undefined &&
          (typeof input.reason !== 'string' || input.reason.length > 500)) ||
        (input.action === 'close' && !input.reason?.trim()))
    )
      throw new InboxError('กรุณาระบุรหัสคำขอและเหตุผลปิดแชทไม่เกิน 500 ตัวอักษร')
    if (input.action === 'bot') {
      const page = await db.from('tenants').select('page_id').eq('id', tenantId).single()
      if (page.error) throw page.error
      const { inboxInboundEvidence } = await import('@/lib/features/inbox/inbox-policy-server')
      const { inboxWindow } = await import('@/lib/features/inbox/inbox-v2')
      if (
        !inboxWindow(await inboxInboundEvidence(db, tenantId, customer.id, page.data.page_id))
          .allowed
      )
        throw new InboxError(
          'หมดเวลา 24 ชั่วโมง ส่งแชทให้แอดมินดูแลแทน',
          409,
          'MESSAGING_WINDOW_CLOSED',
        )
      if (process.env.SNAPBOT_SAFETY_ENABLED === 'true')
        await (await import('@/lib/automation-safety')).assertAutomationRunning(db, tenantId)
      const { data, error } = await db
        .from('bot_settings')
        .select('reply_mode')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (error) throw error
      if (data?.reply_mode === 'ai') {
        if (!(await hasFeature(db, tenantId, 'ai_agent')))
          throw new InboxError('อัปเกรดแพ็กเกจเพื่อเปิด ผู้ช่วยอัจฉริยะ', 403, 'FEATURE_LOCKED')
        if (!aiConfigured())
          throw new InboxError('ยังไม่ได้ตั้งค่า ผู้ให้บริการผู้ช่วยอัจฉริยะ', 503)
      }
    }
    const { error, data } = pro
      ? await db.rpc('manage_inbox_pro', {
          p_customer: customer.id,
          p_actor: actor.id,
          p_action: input.action,
          p_version: input.version,
          p_key: input.requestId,
          p_reason: input.reason?.trim() || null,
          p_assignee: input.assigneeId ?? null,
        })
      : await db.rpc('manage_inbox_conversation', {
          p_customer: customer.id,
          p_actor: actor.id,
          p_action: input.action,
          p_version: input.version,
          p_assignee: input.assigneeId ?? null,
        })
    checkRpc(error)
    return NextResponse.json(pro ? data : { ok: true })
  } catch (error) {
    return inboxError(error)
  }
}
