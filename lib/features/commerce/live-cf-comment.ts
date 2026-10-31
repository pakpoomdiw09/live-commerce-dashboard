import { cfCode } from './cf-code'

export type LiveCfOrder =
  | {
      status: 'created'
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
  qrImageUrl: string | null
}

export async function handleLiveCfComment(
  input: { text: string; commentId: string; code?: string },
  dependencies: {
    placeOrder: (code: string) => Promise<LiveCfOrder>
    getPayment: () => Promise<LiveCfPayment | null>
    getPendingTotal: () => Promise<number>
    sendPrivateReply: (message: string, qrImageUrl: string | null) => Promise<unknown>
    replyToComment?: (message: string) => Promise<unknown>
  },
): Promise<boolean> {
  const code = input.code ?? cfCode(input.text)
  if (!code) return false

  const order = await dependencies.placeOrder(code)
  if (order.status === 'no_match') return false

  if (order.status === 'require_variant') {
    await dependencies.sendPrivateReply(
      `${order.name} มีตัวเลือกสินค้า กรุณาติดต่อแอดมินเพื่อเลือกรหัสสีหรือขนาดก่อนสั่งซื้อ`,
      null,
    )
    if (dependencies.replyToComment) {
      await dependencies.replyToComment('สินค้ามีตัวเลือก กรุณาเช็คและตอบกลับทางแชทค่ะ')
    }
    return true
  }
  if (order.status === 'sold_out') {
    await dependencies.sendPrivateReply(
      `ขออภัยค่ะ ${order.name} (รหัส ${order.code}) หมดแล้ว`,
      null,
    )
    if (dependencies.replyToComment) {
      await dependencies.replyToComment('ขออภัยค่ะ สินค้ารหัสนี้หมดแล้วนะคะ')
    }
    return true
  }

  const payment = await dependencies.getPayment()
  const total = await dependencies.getPendingTotal()
  if (payment?.qrImageUrl) {
    const title = `ยอดชำระ ${total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท · ${order.name}${order.variantLabel ? ` · ${order.variantLabel}` : ''} (${order.code})`
    const subtitle = `โอน ${payment.bankName} ${payment.accountNumber} · สแกน QR และส่งสลิป`
    await dependencies.sendPrivateReply(`${title}\n${subtitle}`, payment.qrImageUrl)
  } else if (payment) {
    const holder = payment.accountName ? ` (${payment.accountName})` : ''
    await dependencies.sendPrivateReply(
      [
        `รับออเดอร์ ${order.name}${order.variantLabel ? ` · ${order.variantLabel}` : ''} (${order.code})`,
        `ยอดชำระ ${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,
        `โอน ${payment.bankName} เลขที่ ${payment.accountNumber}${holder}`,
        'โอนแล้วส่งสลิปในแชทนี้ได้เลย',
      ].join('\n'),
      null,
    )
  } else {
    await dependencies.sendPrivateReply(
      `รับออเดอร์ ${order.name} (${order.code}) ยอด ${order.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท กรุณารอแอดมินแจ้งวิธีชำระเงิน`,
      null,
    )
  }

  if (dependencies.replyToComment) {
    await dependencies.replyToComment(
      payment?.qrImageUrl
        ? 'รับออเดอร์แล้วค่ะ ส่งยอดชำระและ QR Code ทางข้อความแล้วนะคะ'
        : payment
          ? 'รับออเดอร์แล้วค่ะ ส่งรายละเอียดการชำระเงินทางข้อความแล้วนะคะ'
          : 'รับออเดอร์แล้วค่ะ กรุณารอแอดมินแจ้งวิธีชำระเงินทางแชทนะคะ',
    )
  }

  return true
}
