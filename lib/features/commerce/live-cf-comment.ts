import { cfQuantity, normalizeCfCode } from './cf-code'
import { renderCommentTemplate } from './comment-config'

export type LiveCfOrder =
  | {
      status: 'created'
      orderId: string
      name: string
      code: string
      quantity?: number
      unitPrice?: number
      subtotal?: number
      quantityClamped?: boolean
      amount: number
      variantLabel: string | null
    }
  | { status: 'sold_out'; name: string; code: string; remainingStock?: number }
  | { status: 'insufficient_stock'; name: string; code: string; remainingStock?: number }
  | { status: 'require_variant'; name: string; code: string }
  | { status: 'no_match' }

export type LiveCfPayment = { bankName: string; accountName: string | null; accountNumber: string }
const money = (value: number) =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Attempt each enabled channel, then propagate failures to the durable worker. */
async function deliverReplies(
  jobs: { channel: string; send: () => Promise<unknown> }[],
  commentId: string,
) {
  const results = await Promise.allSettled(jobs.map(async (job) => job.send()))
  let failure: PromiseRejectedResult | undefined
  results.forEach((result, index) => {
    if (result.status !== 'rejected') return
    failure ??= result
    console.error('[live-cf/reply] failed', {
      commentId,
      channel: jobs[index].channel,
      errorCode:
        typeof result.reason?.code === 'number'
          ? result.reason.code
          : /^[A-Z0-9_]{2,80}$/.test(result.reason?.code ?? '')
            ? result.reason.code
            : /^[A-Z][A-Z0-9_]{2,80}$/.test(result.reason?.message ?? '')
              ? result.reason.message
              : 'DELIVERY_FAILED',
      errorSubcode: typeof result.reason?.subcode === 'number' ? result.reason.subcode : null,
    })
  })
  if (failure) throw failure.reason
}

/** One comment-scoped private text reply, with a signed payment link. */
export async function handleLiveCfComment(
  input: { text: string; commentId: string; code?: string; quantity?: number },
  dependencies: {
    placeOrder: (code: string, quantity: number) => Promise<LiveCfOrder>
    getPayment: () => Promise<LiveCfPayment | null>
    getPendingTotal: () => Promise<number>
    getPaymentLink: (orderId: string) => Promise<string | null> | string | null
    getCumulativeBill?: (orderId: string) => Promise<string | null>
    sendPrivateReply?: (message: string) => Promise<unknown>
    replyToComment?: (message: string) => Promise<unknown>
    privateTemplate?: string | null
    publicTemplate?: string | null
    customerName?: string
  },
): Promise<boolean> {
  const rawCode = input.code?.trim() || normalizeCfCode(input.text)
  const code = rawCode ? rawCode.toLocaleLowerCase('en-US').trim() : null
  if (!code) {
    console.info('[live-cf/order] skipped', {
      commentId: input.commentId,
      reason: 'NO_PRODUCT_CODE',
      textLength: input.text.length,
    })
    return false
  }
  const requestedQuantity = Math.min(99, input.quantity ?? cfQuantity(input.text))
  const order = await dependencies.placeOrder(code, requestedQuantity)
  if (order.status === 'no_match') {
    console.warn('[live-cf/order] skipped', {
      commentId: input.commentId,
      code,
      reason: 'ORDER_RPC_NO_MATCH',
    })
    return false
  }
  if (!dependencies.sendPrivateReply && !dependencies.replyToComment)
    console.warn('[live-cf/reply] skipped', {
      commentId: input.commentId,
      reason: 'NO_ENABLED_REPLY_CHANNEL',
      orderStatus: order.status,
    })
  const jobs: { channel: string; send: () => Promise<unknown> }[] = []
  if (order.status === 'require_variant' || order.status === 'sold_out' || order.status === 'insufficient_stock') {
    const privateText =
      order.status === 'require_variant'
        ? `${order.name} มีตัวเลือกสินค้า กรุณาติดต่อแอดมินเพื่อเลือกสีหรือขนาดก่อนสั่งซื้อ`
        : `ขออภัยค่ะ ${order.name} (รหัส ${order.code}) มีสินค้าไม่พอ จำนวนคงเหลือ ${order.remainingStock ?? 0} ชิ้น`
    const publicText =
      order.status === 'require_variant'
        ? 'สินค้ามีตัวเลือก กรุณาตรวจสอบข้อความส่วนตัวค่ะ'
        : `ขออภัยค่ะ สินค้ารหัสนี้มีจำนวนไม่พอ (เหลือ ${order.remainingStock ?? 0} ชิ้น)`
    if (dependencies.sendPrivateReply)
      jobs.push({ channel: 'private', send: () => dependencies.sendPrivateReply!(privateText) })
    if (dependencies.replyToComment)
      jobs.push({ channel: 'public', send: () => dependencies.replyToComment!(publicText) })
    await deliverReplies(jobs, input.commentId)
    return true
  }
  if (dependencies.sendPrivateReply)
    jobs.push({
      channel: 'private',
      send: async () => {
        const cumulative = await dependencies.getCumulativeBill?.(order.orderId)
        if (cumulative && !dependencies.privateTemplate?.trim()) {
          await dependencies.sendPrivateReply!(cumulative)
          return
        }
        // A failed total lookup or missing signed link must not produce an incorrect bill.
        const [payment, total, paymentLink] = await Promise.all([
          dependencies.getPayment(),
          dependencies.getPendingTotal(),
          dependencies.getPaymentLink(order.orderId),
        ])
        if (!paymentLink) throw new Error('LIVE_CF_PAYMENT_LINK_UNAVAILABLE')
        if (!Number.isFinite(total) || total <= 0)
          throw new Error('LIVE_CF_PAYMENT_TOTAL_UNAVAILABLE')
        const variantLabel = order.variantLabel ?? ''
        const product = dependencies.privateTemplate?.includes('{variant_name}')
          ? order.name
          : `${order.name}${variantLabel ? ` • ${variantLabel}` : ''}`
        const quantity = order.quantity ?? 1
        const unitPrice = order.unitPrice ?? order.amount
        const subtotal = order.subtotal ?? order.amount
        const priceText = money(unitPrice)
        const subtotalText = money(subtotal)
        const itemLine = `${product} x ${quantity} ชิ้น = ${subtotalText} บาท`
        let message = dependencies.privateTemplate?.trim()
          ? renderCommentTemplate(dependencies.privateTemplate, {
              product_name: product,
              variant_name: variantLabel,
              price: priceText,
              unit_price: priceText,
              quantity: String(quantity),
              subtotal: subtotalText,
              item_summary: itemLine,
              bidder_name: dependencies.customerName ?? '',
              total: money(total),
              payment_link: paymentLink,
              bank_account: payment
                ? `${payment.bankName} ${payment.accountNumber}${payment.accountName ? ` (${payment.accountName})` : ''}`
                : '',
            }).trim()
          : [
              `รับออเดอร์ ${itemLine} (${order.code})`,
              ...(order.quantityClamped ? [`ระบบปรับจำนวนตามเพดานที่ตั้งไว้ เหลือ ${quantity} ชิ้น`] : []),
              `ยอดชำระ ${money(total)} บาท`,
              payment
                ? `บัญชี ${payment.bankName} ${payment.accountNumber}${payment.accountName ? ` (${payment.accountName})` : ''}`
                : null,
              `ชำระเงินอย่างปลอดภัย: ${paymentLink}`,
            ]
              .filter(Boolean)
              .join('\n')
        if (!message.includes(itemLine)) message = `${itemLine}\n${message}`
        if (order.quantityClamped && !message.includes('ปรับจำนวนตามเพดาน'))
          message = `ระบบปรับจำนวนตามเพดานที่ตั้งไว้ เหลือ ${quantity} ชิ้น\n${message}`
        if (!message.includes(paymentLink)) message += `\nชำระเงินอย่างปลอดภัย: ${paymentLink}`
        await dependencies.sendPrivateReply!(message)
      },
    })
  if (dependencies.replyToComment)
    jobs.push({
      channel: 'public',
      send: async () => {
        const template = dependencies.publicTemplate?.trim()
        if (!template)
          return dependencies.replyToComment!(
            'รับออเดอร์แล้วค่ะ กรุณาตรวจสอบรายละเอียดและลิงก์ชำระเงินในข้อความส่วนตัว',
          )
        const [bank, total, link] = await Promise.all([
          template.includes('{bank_account}') ? dependencies.getPayment() : null,
          /\{(?:total|total_amount)\}/u.test(template)
            ? dependencies.getPendingTotal()
            : order.amount,
          template.includes('{payment_link}') ? dependencies.getPaymentLink(order.orderId) : '',
        ])
        if (!Number.isFinite(total) || total <= 0)
          throw new Error('LIVE_CF_PAYMENT_TOTAL_UNAVAILABLE')
        return dependencies.replyToComment!(
          renderCommentTemplate(template, {
            product_name: order.name,
            variant_name: order.variantLabel ?? '',
            price: money(order.unitPrice ?? order.amount),
            unit_price: money(order.unitPrice ?? order.amount),
            quantity: String(order.quantity ?? 1),
            subtotal: money(order.subtotal ?? order.amount),
            item_summary: `${order.name} x ${order.quantity ?? 1} ชิ้น = ${money(order.subtotal ?? order.amount)} บาท`,
            total: money(total),
            bidder_name: dependencies.customerName ?? '',
            payment_link: link ?? '',
            bank_account: bank
              ? `${bank.bankName} ${bank.accountNumber}${bank.accountName ? ` (${bank.accountName})` : ''}`
              : '',
          }),
        )
      },
    })
  await deliverReplies(jobs, input.commentId)
  return true
}
