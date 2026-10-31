import { cfCode } from './cf-code'

export type LiveCfOrder =
  | {
      status: 'created'
      orderId: string
      name: string
      code: string
      amount: number
      variantLabel: string | null
    }
  | { status: 'sold_out'; name: string; code: string }
  | { status: 'require_variant'; name: string; code: string }
  | { status: 'no_match' }

export type LiveCfPayment = {
  bankName: string
  accountName: string | null
  accountNumber: string
}

const money = (value: number) =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Complete one Live CF comment. The private channel is deliberately text-only:
 * Meta permits only one private reply for a comment, so payment is opened through
 * a signed HTTPS link instead of attaching a QR image.
 */
export async function handleLiveCfComment(
  input: { text: string; commentId: string; code?: string },
  dependencies: {
    placeOrder: (code: string) => Promise<LiveCfOrder>
    getPayment: () => Promise<LiveCfPayment | null>
    getPendingTotal: () => Promise<number>
    getPaymentLink: (orderId: string) => Promise<string | null> | string | null
    sendPrivateReply?: (message: string) => Promise<unknown>
    replyToComment?: (message: string) => Promise<unknown>
    privateTemplate?: string | null
    publicTemplate?: string | null
  },
): Promise<boolean> {
  const code = input.code ?? cfCode(input.text)
  if (!code) return false

  const order = await dependencies.placeOrder(code)
  if (order.status === 'no_match') return false

  if (order.status === 'require_variant') {
    await dependencies.sendPrivateReply?.(
      `${order.name} มีตัวเลือกสินค้า กรุณาติดต่อแอดมินเพื่อเลือกสีหรือขนาดก่อนสั่งซื้อ`,
    )
    await dependencies.replyToComment?.('สินค้ามีตัวเลือก กรุณาตรวจสอบข้อความส่วนตัวค่ะ')
    return true
  }
  if (order.status === 'sold_out') {
    await dependencies.sendPrivateReply?.(`ขออภัยค่ะ ${order.name} (รหัส ${order.code}) หมดแล้ว`)
    await dependencies.replyToComment?.('ขออภัยค่ะ สินค้ารหัสนี้หมดแล้ว')
    return true
  }

  const [payment, total, paymentLink] = await Promise.all([
    dependencies.getPayment(),
    dependencies.getPendingTotal(),
    dependencies.getPaymentLink(order.orderId),
  ])
  if (dependencies.sendPrivateReply && !paymentLink)
    throw new Error('LIVE_CF_PAYMENT_LINK_UNAVAILABLE')
  const variantLabel = order.variantLabel ?? ''
  const hasVariantTag = dependencies.privateTemplate?.includes('{variant_name}')
  const product = hasVariantTag
    ? order.name
    : `${order.name}${variantLabel ? ` • ${variantLabel}` : ''}`
  const priceText = dependencies.privateTemplate?.includes('{total}')
    ? money(order.amount)
    : money(total)

  const privateMessage = dependencies.privateTemplate?.trim()
    ? dependencies.privateTemplate
        .replaceAll('{product_name}', product)
        .replaceAll('{variant_name}', variantLabel)
        .replaceAll('{price}', priceText)
        .replaceAll('{total}', money(total))
        .replaceAll('{payment_link}', paymentLink ?? '')
        .trim()
    : [
        `รับออเดอร์ ${order.name}${variantLabel ? ` • ${variantLabel}` : ''} (${order.code})`,
        `ยอดชำระ ${money(total)} บาท`,
        payment
          ? `บัญชี ${payment.bankName} ${payment.accountNumber}${payment.accountName ? ` (${payment.accountName})` : ''}`
          : 'แอดมินจะแจ้งช่องทางชำระเงินให้ทางแชท',
        paymentLink ? `ชำระเงินอย่างปลอดภัย: ${paymentLink}` : null,
      ]
        .filter(Boolean)
        .join('\n')
  await dependencies.sendPrivateReply?.(privateMessage)

  await dependencies.replyToComment?.(
    dependencies.publicTemplate?.trim() ||
      'รับออเดอร์แล้วค่ะ กรุณาตรวจสอบรายละเอียดและลิงก์ชำระเงินในข้อความส่วนตัว',
  )
  return true
}
