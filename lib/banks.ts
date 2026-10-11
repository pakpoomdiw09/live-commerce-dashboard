/**
 * Thai banks a tenant can receive payments into. `code` is what tenants.bank_code stores;
 * `slipCode` is SlipOK's numeric receivingBank / sendingBank code (see bankMatches in lib/slip/process.ts).
 * Brand colors stand in for logos, so no image assets or third-party CDN are needed.
 */
export type Bank = { code: string; slipCode: string | null; name: string; short: string; color: string }

export const BANKS: Bank[] = [
  { code: 'KBANK', slipCode: '004', name: 'ธนาคารกสิกรไทย', short: 'K', color: '#138f2d' },
  { code: 'SCB', slipCode: '014', name: 'ธนาคารไทยพาณิชย์', short: 'SCB', color: '#4e2e7f' },
  { code: 'BBL', slipCode: '002', name: 'ธนาคารกรุงเทพ', short: 'BBL', color: '#1e4598' },
  { code: 'KTB', slipCode: '006', name: 'ธนาคารกรุงไทย', short: 'KTB', color: '#1ba5e1' },
  { code: 'BAY', slipCode: '025', name: 'ธนาคารกรุงศรีอยุธยา', short: 'BAY', color: '#d4a106' },
  { code: 'TTB', slipCode: '011', name: 'ธนาคารทหารไทยธนชาต', short: 'ttb', color: '#0050f0' },
  { code: 'GSB', slipCode: '030', name: 'ธนาคารออมสิน', short: 'GSB', color: '#eb198d' },
  { code: 'PROMPTPAY', slipCode: null, name: 'พร้อมเพย์', short: 'PP', color: '#003b71' },
]

/** Find a bank by tenant code (KBANK) or SlipOK numeric code (004). */
export function findBank(code: string | null | undefined): Bank | undefined {
  const c = (code ?? '').trim().toUpperCase()
  if (!c) return undefined
  return BANKS.find((b) => b.code === c || b.slipCode === c) ?? (c === 'TMB' || c === 'TTBNK' ? BANKS.find((b) => b.code === 'TTB') : undefined)
}

export const BANK_CODES = BANKS.map((b) => b.code)
