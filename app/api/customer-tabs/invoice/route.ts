import { NextRequest, NextResponse } from 'next/server'
import { inboxCustomer, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { loadCustomerTab, customerTabSummary } from '@/lib/features/commerce/customer-tabs-server'
import { tabMoney } from '@/lib/features/commerce/customer-tab-types'
import {
  pageTokenFor,
  sendAuctionInvoiceWithReceipt,
  SendApiError,
  needsMessengerSession,
  isUnsupportedPurchaseTag,
  MESSENGER_FIRST_MESSAGE_REQUIRED,
} from '@/lib/integrations/facebook/client'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'

/** Transactional invoices are generated from an owned ledger, never supplied as chat text. */
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get('origin') !== req.nextUrl.origin)
      throw new InboxError('คำขอไม่ถูกต้อง', 403)
    const input = await req.json().catch(() => null)
    if (
      !UUID.test(input?.customerId ?? '') ||
      !UUID.test(input?.tabId ?? '') ||
      !UUID.test(input?.clientId ?? '')
    )
      throw new InboxError('รหัสบิลหรือข้อความไม่ถูกต้อง')
    const { db, customer, tenantId } = await inboxCustomer(req, input.customerId)
    const tab = await loadCustomerTab(db, input.tabId, tenantId)
    if (!tab || tab.customer_id !== customer.id || tab.customer_fb_id !== customer.platform_user_id)
      throw new InboxError('ไม่พบบิลของลูกค้านี้', 404)
    const facebookCustomer = await db
      .from('customers')
      .select('id')
      .eq('id', customer.id)
      .eq('tenant_id', tenantId)
      .eq('platform', 'facebook')
      .maybeSingle()
    if (facebookCustomer.error) throw facebookCustomer.error
    if (!facebookCustomer.data) throw new InboxError('บิลนี้ไม่ได้ผูกกับผู้ใช้ Facebook', 404)
    const page = await db
      .from('tenants')
      .select('page_id,page_access_token,send_payment_link')
      .eq('id', tenantId)
      .eq('page_id', tab.page_id)
      .eq('is_active', true)
      .single()
    if (page.error || !page.data)
      throw new InboxError('เพจของบิลยังไม่พร้อมส่งข้อความ', 409, 'PAGE_NOT_READY')
    const token = pageTokenFor(page.data)
    if (!token) throw new InboxError('กรุณาเชื่อมต่อเพจก่อนส่งบิล', 409, 'PAGE_NOT_READY')

    const externalId = `invoice:${input.clientId}`
    const previous = await db
      .from('messages')
      .select('id,delivery_status')
      .eq('customer_id', customer.id)
      .eq('external_id', externalId)
      .maybeSingle()
    if (previous.error) throw previous.error
    if (previous.data) {
      if (['sent', 'delivered', 'read'].includes(previous.data.delivery_status))
        return NextResponse.json({ ok: true, ...previous.data, duplicate: true })
      throw new InboxError(
        'คำขอนี้ถูกส่งแล้ว กรุณาตรวจสถานะในแชทก่อนส่งใหม่',
        409,
        'SEND_ALREADY_CLAIMED',
      )
    }
    const summary = await customerTabSummary(db, tab, undefined, page.data.send_payment_link)
    // One private reply must contain the complete payment destination, even for long ledgers.
    const text = [
      'สรุปบิลรายการที่สั่งซื้อ / ประมูล',
      `บิล …${tab.id.slice(-6)}`,
      `ยอดรวม ${tabMoney(tab.total_amount)} บาท`,
      `ชำระแล้ว ${tabMoney(tab.paid_amount)} บาท`,
      `คงเหลือ ${tabMoney(tab.remaining_amount)} บาท`,
      `บัญชีรับเงิน: ${summary.account}`,
      ...(summary.link ? [`รายการทั้งหมด / QR / แนบสลิป: ${summary.link}`] : []),
    ].join('\n')
    if (text.length > 2000) throw new InboxError('ข้อมูลบิลยาวเกินกำหนด')
    const inserted = await db
      .from('messages')
      .insert({
        customer_id: customer.id,
        external_id: externalId,
        sender: 'agent',
        body: text,
        delivery_status: 'pending',
        attachments: summary.link ? [{ type: 'link', payload: { url: summary.link } }] : [],
      })
      .select('id')
      .single()
    if (inserted.error?.code === '23505')
      throw new InboxError('บิลนี้กำลังถูกส่งแล้ว', 409, 'SEND_ALREADY_CLAIMED')
    if (inserted.error) throw inserted.error
    const id = inserted.data.id
    try {
      const receipt = await sendAuctionInvoiceWithReceipt(
        token,
        customer.platform_user_id,
        text,
        undefined,
        externalId,
      )
      const saved = await db
        .from('messages')
        .update({ delivery_status: 'sent', provider_message_id: receipt.message_id })
        .eq('id', id)
      if (saved.error) throw saved.error
      return NextResponse.json({ ok: true, id, delivery_status: 'sent' })
    } catch (error) {
      const rejected = error instanceof SendApiError && error.status >= 400 && error.status < 500
      await db
        .from('messages')
        .update({ delivery_status: rejected ? 'failed' : 'unknown' })
        .eq('id', id)
      if (rejected && (needsMessengerSession(error) || isUnsupportedPurchaseTag(error)))
        throw new InboxError(MESSENGER_FIRST_MESSAGE_REQUIRED, 409, 'MESSENGER_SESSION_REQUIRED')
      throw new InboxError(
        rejected
          ? 'Facebook ปฏิเสธการส่งบิล กรุณาตรวจสิทธิ์เพจ'
          : 'ยังยืนยันผลส่งบิลไม่ได้ กรุณาตรวจ Messenger ก่อนส่งใหม่',
        502,
        rejected ? 'SEND_REJECTED' : 'SEND_UNKNOWN',
      )
    }
  } catch (error) {
    return inboxError(error)
  }
}
