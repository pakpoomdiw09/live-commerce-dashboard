/** Pure, single-pass templates shared by setup, webhook delivery and previews. */
export const AUCTION_PRIVATE_TEMPLATE =
  'ยินดีด้วยครับ! คุณชนะประมูล {product_name} ราคา {price} บาท ยอดค้างชำระสุทธิ {total} บาท\nชำระเงิน / แนบสลิป: {payment_link}'
export const SESSION_WINNER_TEMPLATE =
  'ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท\nยอดรวมบิลของคุณตอนนี้: {total} บาท\nเลขบัญชีรับเงิน: {bank_account}'
export const SESSION_PUBLIC_WINNER_TEMPLATE =
  'ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท'
export const AUCTION_BID_TEMPLATE =
  '✅ ยืนยันคุณ {bidder_name} ขึ้นนำ {product_name} ที่ {price} บาท เคาะขั้นต่ำ +{min_step} บาท'
export const AUCTION_CLOSE_TEMPLATE =
  '❌ ปิดประมูล {product_name} ผู้ชนะ: {bidder_name} ราคา {price} บาท'
const aliases: Record<string, string> = {
  ชื่อลูกค้า: 'bidder_name',
  รายการ: 'product_name',
  ยอดรวมสะสม: 'total',
  เลขบัญชี: 'bank_account',
  ชื่อสินค้า: 'product_name',
  ราคา: 'price',
  ยอดชำระ: 'total',
  'ลิงก์ชำระเงิน/แนบสลิป': 'payment_link',
  ลิงก์ชำระเงิน: 'payment_link',
  ชื่อผู้ชนะ: 'bidder_name',
  ชื่อผู้ประมูล: 'bidder_name',
  สเต็ปขั้นต่ำ: 'min_step',
  ราคาเคาะขั้นต่ำ: 'min_step',
  ยอดโอนแล้ว: 'paid',
  บัญชีรับเงิน: 'bank_account',
  ยอดค้างสุทธิ: 'remaining',
}
const labels: Record<string, string> = {
  product_name: 'ชื่อสินค้า',
  price: 'ราคา',
  total: 'ยอดชำระ',
  payment_link: 'ลิงก์ชำระเงิน/แนบสลิป',
  bidder_name: 'ชื่อผู้ชนะ',
  min_step: 'สเต็ปขั้นต่ำ',
  paid: 'ยอดโอนแล้ว',
  bank_account: 'บัญชีรับเงิน',
  remaining: 'ยอดค้างสุทธิ',
}
export const auctionVariables = Object.entries(labels).map(([key, label]) => ({
  tag: `{${label}}`,
  label,
  key,
}))
export const auctionPublicVariables = auctionVariables.filter((variable) =>
  ['product_name', 'price', 'bidder_name', 'min_step'].includes(variable.key),
)
export const storeAuctionTemplate = (text: string) =>
  text.replace(/\{([^{}]+)\}/g, (match, key: string) =>
    aliases[key] ? `{${aliases[key]}}` : match,
  )
export const displayAuctionTemplate = (text: string) =>
  text.replace(/\{([^{}]+)\}/g, (match, key: string) => (labels[key] ? `{${labels[key]}}` : match))
export function validAuctionTemplate(
  value: unknown,
  channel: 'private' | 'public' | 'winner-public',
): value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > (channel === 'private' ? 1500 : 600)
  )
    return false
  const stored = storeAuctionTemplate(value)
  const allowed =
    channel === 'private'
      ? Object.keys(labels)
      : channel === 'winner-public'
        ? [...auctionPublicVariables.map((variable) => variable.key), 'total', 'bank_account']
        : auctionPublicVariables.map((variable) => variable.key)
  return [...stored.matchAll(/\{([^{}]+)\}/g)].every((match) => allowed.includes(match[1]))
}
export const renderAuctionTemplate = (template: string, values: Record<string, string>) =>
  storeAuctionTemplate(template).replace(
    /\{([^{}]+)\}/g,
    (match, key: string) => values[key] ?? match,
  )

/** The totals/account/link are mandatory even if the merchant omits their variables. */
export function auctionPrivateMessage(
  template: string,
  values: Record<string, string>,
  summary: string,
  compactSummary: string,
) {
  const greeting = renderAuctionTemplate(template, values)
  const full = `${greeting}\n\n${summary}`
  if (full.length <= 1900) return full
  // Keep the financial footer intact; long names and item lists remain on the signed bill.
  return `${greeting.slice(0, Math.max(0, 1898 - compactSummary.length))}\n\n${compactSummary}`.slice(
    0,
    2000,
  )
}
