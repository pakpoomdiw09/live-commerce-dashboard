import { after, NextRequest, NextResponse } from 'next/server'
import {
  inboxCustomer,
  inboxTenant,
  inboxError,
  InboxError,
} from '@/lib/features/inbox/inbox-server'
import { canAccessTenant } from '@/lib/auth'
import {
  TAB_COLUMNS,
  customerTabSummary,
  enrichCustomerTabs,
} from '@/lib/features/commerce/customer-tabs-server'
import { runCustomerTabReminders } from '@/lib/features/commerce/customer-tab-reminders'
import type { CustomerTab } from '@/lib/features/commerce/customer-tab-types'
import { UUID } from '@/lib/utils'

export const maxDuration = 60
const json = (data: unknown) =>
  NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
export async function GET(req: NextRequest) {
  try {
    const customerId = req.nextUrl.searchParams.get('customerId') ?? ''
    const { db, tenantId, actor } = await inboxCustomer(req, customerId)
    const tabs = await db
      .from('customer_tabs')
      .select(TAB_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (tabs.error) throw tabs.error
    const canCancelOrders = await canAccessTenant(actor, tenantId, 'owner')
    const hydrated = await enrichCustomerTabs(db, (tabs.data ?? []) as CustomerTab[])
    const visibleTabs = hydrated
      .filter(
        (tab) =>
          !['cancelled', 'void'].includes(tab.status) &&
          (Number(tab.total_amount) > 0 || tab.customer_tab_items.some((item) => !item.cancelled)),
      )
      .map((tab) => ({
        ...tab,
        can_dismiss: canCancelOrders,
        customer_tab_items: tab.customer_tab_items.map((item) => ({
          ...item,
          can_cancel: canCancelOrders && item.can_cancel === true,
        })),
      }))
    const summaryId = req.nextUrl.searchParams.get('summary')
    if (summaryId) {
      const tab = visibleTabs.find((bill) => bill.id === summaryId)
      if (!tab) throw new InboxError('ไม่พบบิลของลูกค้านี้', 404)
      const page = await db
        .from('tenants')
        .select('send_payment_link')
        .eq('id', tenantId)
        .eq('page_id', tab.page_id)
        .single()
      if (page.error) throw page.error
      return json(await customerTabSummary(db, tab, undefined, page.data.send_payment_link))
    }
    const ids = visibleTabs.map((tab) => tab.id)
    const jobs = ids.length
      ? await db
          .from('customer_tab_reminders')
          .select('id,tab_id,status,stage,run_at,error_code')
          .in('tab_id', ids)
          .order('created_at', { ascending: false })
          .limit(100)
      : { data: [], error: null }
    if (jobs.error) throw jobs.error
    return json({ tabs: visibleTabs, reminders: jobs.data })
  } catch (error) {
    return inboxError(error)
  }
}
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get('origin') !== req.nextUrl.origin)
      throw new InboxError('คำขอไม่ถูกต้อง', 403)
    const input = await req.json()
    if (!input || !UUID.test(input.requestId ?? '')) throw new InboxError('คำขอไม่ถูกต้อง')
    const scope = input.customerId
      ? await inboxCustomer(req, input.customerId)
      : await inboxTenant(req, input.tenantId ?? '')
    const { db, tenantId, actor } = scope
    if (
      (!input.customerId || input.action === 'end_live' || input.action === 'remind_all') &&
      !(await canAccessTenant(actor, tenantId, 'owner'))
    )
      throw new InboxError('เฉพาะเจ้าของร้าน', 403)
    if (input.action === 'end_live') {
      if (typeof input.livePostId !== 'string' || !/^\d+$/.test(input.livePostId))
        throw new InboxError('รหัสไลฟ์ไม่ถูกต้อง')
      const page = await db.from('tenants').select('page_id').eq('id', tenantId).single()
      if (page.error) throw page.error
      const session = await db
        .from('live_sessions')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('page_id', page.data.page_id)
        .eq('live_post_id', input.livePostId)
        .single()
      if (session.error) throw session.error
      const ended = await db.rpc('end_customer_tab_live', {
        p_session: session.data.id,
        p_tenant: tenantId,
        p_reminders: input.reminders !== false,
      })
      if (ended.error) throw ended.error
      return json({
        message:
          'จบไลฟ์แล้ว ตั้งทวงยอดหลังจบ 1 ชั่วโมงและเช้าวันถัดไปเวลา 09:00 น. (เมื่อเพจยังส่งข้อความได้)',
      })
    }
    if (input.action === 'cancel_order') {
      if (!input.customerId || !UUID.test(input.tabId ?? '') || !UUID.test(input.orderId ?? ''))
        throw new InboxError('ข้อมูลบิลหรือรายการไม่ถูกต้อง')
      if (!(await canAccessTenant(actor, tenantId, 'owner')))
        throw new InboxError('เฉพาะเจ้าของร้านเท่านั้นที่ยกเลิกรายการได้', 403)
      const cancelled = await db.rpc('cancel_customer_tab_order', {
        p_tenant: tenantId,
        p_customer: input.customerId,
        p_tab: input.tabId,
        p_order: input.orderId,
      })
      if (cancelled.error) {
        if (cancelled.error.message.includes('TAB_ORDER_NOT_CANCELLABLE'))
          throw new InboxError('ยกเลิกรายการนี้ไม่ได้ เพราะชำระแล้วหรือสถานะเปลี่ยนไป', 409)
        if (cancelled.error.message.includes('TAB_ORDER_SCOPE'))
          throw new InboxError('ไม่พบรายการในบิลของลูกค้ารายนี้', 404)
        throw cancelled.error
      }
      console.info('[customer-tabs/order] cancelled', {
        orderId: input.orderId,
        tabId: input.tabId,
        tenantId,
      })
      return json(cancelled.data)
    }
    if (!['remind', 'remind_all'].includes(input.action)) throw new InboxError('คำสั่งไม่ถูกต้อง')
    const queued = await db.rpc('queue_customer_tab_reminders', {
      p_tenant: tenantId,
      p_customer: input.customerId ?? null,
      p_request: input.requestId,
    })
    if (queued.error) throw queued.error
    after(async () => {
      try {
        await runCustomerTabReminders(db)
      } catch {
        console.error('[customer-tabs/reminder] deferred worker unavailable')
      }
    })
    return json({
      queued: queued.data,
      message: 'เข้าคิวแจ้งยอดแล้ว ระบบจะตรวจยอดล่าสุดและสิทธิ์ส่งข้อความก่อนส่งทุกครั้ง',
    })
  } catch (error) {
    return inboxError(error)
  }
}
