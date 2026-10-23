// Offline test fixture only. No environment files, real APIs, or provider requests.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BankAccountsManager } from '@/components/settings/BankAccountsManager'
import { TenantSettingsForm } from '@/components/settings/TenantSettingsForm'
import { SUPPORTED_BANKS } from '@/lib/features/banking/banks'
import type { BankAccount } from '@/lib/features/banking/bank-accounts'

const tenantId = '11111111-1111-4111-8111-111111111111'
const initialAccount: BankAccount = {
  id: '22222222-2222-4222-8222-222222222222',
  tenant_id: tenantId,
  bank_code: 'KBANK',
  account_name: 'บัญชีตัวอย่างสำหรับทดสอบ',
  account_number: '1234567890',
  is_active: true,
  is_primary: true,
  created_at: '2026-01-01T00:00:00Z',
}
const accounts: BankAccount[] = [{ ...initialAccount }]
const posts: Record<string, unknown>[] = []
const fixture = { banks: SUPPORTED_BANKS, accounts, posts }
declare global {
  interface Window {
    bankFixture: typeof fixture
  }
}
window.bankFixture = fixture
window.confirm = () => true
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.origin,
  )
  if (url.pathname === '/api/bank-accounts') {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      posts.push(body)
      if (body.action === 'save') {
        const index = accounts.findIndex((account) => account.id === body.id)
        const row: BankAccount = {
          ...initialAccount,
          id: index < 0 ? '33333333-3333-4333-8333-333333333333' : String(body.id),
          bank_code: String(body.bank_code),
          account_name: String(body.account_name),
          account_number: String(body.account_number),
          is_active: Boolean(body.is_active),
          is_primary: index >= 0,
        }
        if (index < 0) accounts.push(row)
        else accounts[index] = row
      }
      return Response.json({ ok: true })
    }
    return Response.json({ accounts: accounts.map((account) => ({ ...account })), audit: [] })
  }
  throw Error('Offline fixture blocked request: ' + url.pathname)
}

function Fixture() {
  const [create, setCreate] = useState(false)
  return (
    <main className="mx-auto min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-slate-900">บัญชีรับเงิน SnapBot</h1>
      <p className="text-sm text-slate-500">
        ตัวอย่างทดสอบออฟไลน์ · ไม่มีการเชื่อมต่อธนาคารหรือส่งข้อความจริง
      </p>
      <button
        id="fixture-mode"
        type="button"
        className="rounded-lg border px-3 py-2 text-sm"
        onClick={() => setCreate(!create)}
      >
        {create ? 'กลับไปบัญชีรับเงิน' : 'ทดสอบแบบฟอร์มสร้างร้าน'}
      </button>
      {create ? (
        <TenantSettingsForm
          tenant={null}
          billing={null}
          slipCredits={{ quota: 0, used: 0 }}
          pages={[]}
          isFirst
          role="admin"
          section="bank-slip"
          embedded
        />
      ) : (
        <BankAccountsManager tenantId={tenantId} canManage />
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
)
