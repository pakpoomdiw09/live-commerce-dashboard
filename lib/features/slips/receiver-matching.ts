import { findBank } from '@/lib/features/banking/banks'

/**
 * Compare the tenant's full account number with the receiver account on the slip, which banks
 * mask with 'x' or '*' (e.g. 92xxxx7828, xxx-x-x1234-x). Same length: every visible digit must
 * be in the same place. Different length: the visible digits before and after the mask must be
 * the start and end of the full number. At least 3 visible digits either way; anything else
 * counts as a mismatch, so an unreadable account is rejected.
 */
export function accountMatches(full: string | null, onSlip: string | undefined): boolean {
  const a = (full ?? '').replace(/\D/g, '')
  const b = (onSlip ?? '').replace(/\*/g, 'x').replace(/[^0-9x]/gi, '').toLowerCase()
  if (!a || !b) return false
  const visible = b.replace(/x/g, '').length
  if (visible < 3) return false
  if (a.length === b.length) {
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== 'x' && b[i] !== a[i]) return false
    }
    return true
  }
  // lengths differ: only a "<prefix>xxx<suffix>" shape can be lined up
  const m = /^(\d*)x+(\d*)$/.exec(b)
  if (!m) return false
  const [, head, tail] = m
  return head.length + tail.length <= a.length && a.startsWith(head) && a.endsWith(tail)
}

/**
 * Compare the tenant's bank_code (e.g. KTB or 006) with the receiving bank on the slip (e.g. 006).
 * PROMPTPAY tenants are paid via a proxy, so the receiving bank can be anything: skip the check.
 * An unknown or missing bank on either side counts as a mismatch.
 */
export function bankMatches(tenantBank: string | null | undefined, onSlip: string | undefined): boolean {
  const t = (tenantBank ?? '').trim().toUpperCase()
  if (t === 'PROMPTPAY') return true
  const s = (onSlip ?? '').trim()
  if (!t || !s) return false
  const bank=findBank(t)
  // Being listed by BOT does not establish support by the slip provider.
  if(bank?.support==='manual')return false
  if (t === s) return true
  return bank?.slipCode===s
}

export function receiverMatchesAny(accounts: {bank_code:string;account_number:string;is_active:boolean}[] | null | undefined, receiverBank?: string, receiverAccount?: string, receiverProxy?: string) {
  return (accounts ?? []).some(account => {
    if (!account.is_active || !bankMatches(account.bank_code,receiverBank)) return false
    let receiver=account.bank_code==='PROMPTPAY' ? receiverProxy : receiverAccount
    if (account.bank_code==='PROMPTPAY' && receiver) receiver=receiver.replace(/[\s-]/g,'').replace(/^(?:\+?66|0066)(?=[\dxX*]{9}$)/,'0')
    return accountMatches(account.account_number,receiver)
  })
}

