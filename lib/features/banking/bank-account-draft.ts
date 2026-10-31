import type { BankAccount } from '@/lib/features/banking/bank-accounts'

export type BankAccountDraft = Pick<
  BankAccount,
  'bank_code' | 'account_name' | 'account_number' | 'is_active'
>
export function bankAccountDraft(account: BankAccountDraft): BankAccountDraft {
  return {
    bank_code: account.bank_code,
    account_name: account.account_name.trim(),
    account_number: account.account_number.replace(/[\s-]/g, ''),
    is_active: account.is_active,
  }
}
