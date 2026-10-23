import { hasFeature } from '@/lib/feature-access'
import { FeatureLocked } from '@/components/shared/FeatureLocked'
import { notFound, redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { loadSlipDetail } from '@/lib/features/slips/detail'
import { baht, UUID } from '@/lib/utils'
import { BankLogo, bankName } from '@/components/banking/BankLogo'
import { PrintButton } from '@/app/receipts/[id]/PrintButton'

export const metadata = { title: 'ใบเสร็จรับเงิน' }

/** Deterministic receipt number: the same slip always prints the same number. */
const receiptNo = (id: string, iso: string) =>
  `RC-${new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).replaceAll('-', '')}-${id.slice(0, 8).toUpperCase()}`
const thaiDate = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  })

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  // the page reads with the service role, so check the session and the tenant here too
  const actor = await getActor()
  if (!actor) redirect(`/login?next=/receipts/${id}`)

  const db = supabaseAdmin()
  const { data: scope, error } = await db
    .from('slips')
    .select('tenant_id')
    .eq('id', id)
    .maybeSingle()
  if (error || !scope || !(await canAccessTenant(actor, scope.tenant_id))) notFound()
  if (!(await hasFeature(db, scope.tenant_id, 'customer_management'))) return <FeatureLocked />
  const slip = await loadSlipDetail(db, id, scope.tenant_id)
  if (!slip || slip.tenant_id !== scope.tenant_id) notFound()

  if (slip.status !== 'valid' && !slip.approved_at) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center text-sm text-slate-600">
        ออกใบเสร็จได้เฉพาะสลิปที่ตรวจผ่านหรืออนุมัติแล้ว
      </main>
    )
  }

  const [{ data: tenant }, { data: customer }] = await Promise.all([
    slip.tenant_id
      ? db
          .from('tenants')
          .select('name, account_name, account_number, bank_code')
          .eq('id', slip.tenant_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    slip.customer_id
      ? db
          .from('customers')
          .select('display_name, phone, address')
          .eq('id', slip.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const issuedAt = slip.approved_at ?? slip.verified_at ?? slip.created_at
  const paidAt = slip.transferredAt ?? slip.created_at

  return (
    <main className="min-h-dvh bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-2xl justify-end px-4">
        <PrintButton />
      </div>

      <article className="mx-auto max-w-2xl bg-white p-10 shadow-sm ring-1 ring-slate-200 print:shadow-none print:ring-0">
        <header className="flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">ใบเสร็จรับเงิน</h1>
            <p className="text-sm text-slate-500">Receipt</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{tenant?.name ?? slip.tenantName ?? 'ร้านค้า'}</p>
            <p className="mt-1 font-mono text-xs text-slate-500">
              เลขที่ {receiptNo(slip.id, issuedAt)}
            </p>
            <p className="text-xs text-slate-500">ออกเมื่อ {thaiDate(issuedAt)}</p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 py-6 text-sm">
          <div>
            <h2 className="text-xs font-medium text-slate-500">ได้รับเงินจาก</h2>
            <p className="mt-1 font-medium">{customer?.display_name ?? slip.sender.name ?? '-'}</p>
            {customer?.phone && <p className="text-slate-600">โทร {customer.phone}</p>}
            {customer?.address && (
              <p className="whitespace-pre-wrap text-slate-600">{customer.address}</p>
            )}
          </div>
          <div>
            <h2 className="text-xs font-medium text-slate-500">ชำระเข้าบัญชี</h2>
            <div className="mt-1 flex items-center gap-2">
              <BankLogo code={tenant?.bank_code ?? slip.receiver.bank} size="sm" />
              <span>{bankName(tenant?.bank_code ?? slip.receiver.bank)}</span>
            </div>
            <p className="text-slate-600">{tenant?.account_name ?? slip.receiver.name ?? '-'}</p>
          </div>
        </section>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 font-medium">รายการ</th>
              <th className="py-2 text-right font-medium">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-3">
                ชำระค่าสินค้า / บริการ
                <p className="text-xs text-slate-500">โอนเมื่อ {thaiDate(paidAt)}</p>
                {slip.trans_ref && (
                  <p className="font-mono text-xs text-slate-500">อ้างอิง {slip.trans_ref}</p>
                )}
              </td>
              <td className="py-3 text-right tabular-nums">{baht(slip.amount)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-4 text-right font-semibold">รวมทั้งสิ้น</td>
              <td className="pt-4 text-right text-lg font-semibold tabular-nums">
                {baht(slip.amount)}
              </td>
            </tr>
          </tfoot>
        </table>

        <footer className="mt-12 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
          เอกสารนี้ออกโดยระบบอัตโนมัติจากสลิปที่ตรวจสอบแล้ว ไม่ต้องลงลายมือชื่อ
        </footer>
      </article>
    </main>
  )
}
