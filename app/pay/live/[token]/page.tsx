import { notFound } from 'next/navigation'
import { Building2, Clock3, LockKeyhole, PackageCheck } from 'lucide-react'
import { verifyLiveCfPaymentToken } from '@/lib/features/commerce/live-cf-payment-link'
import { supabaseAdmin } from '@/lib/supabase/server'
import { findBank } from '@/lib/features/banking/banks'
import { LiveCfVariantPayment } from '@/components/live-cf/LiveCfVariantPayment'

export const metadata = { title: 'ชำระเงินออเดอร์ Live CF | SnapBot' }
export const dynamic = 'force-dynamic'

export default async function LiveCfPaymentPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const token = (await params).token
  const verified = verifyLiveCfPaymentToken(token)
  if (!verified) notFound()
  const db = supabaseAdmin()
  const order = await db
    .from('orders')
    .select(
      'id,tenant_id,customer_id,product_id,product_name,variant_id,variant_label,amount,status,live_bank_account_id,created_at,live_variant_selection_required,live_variant_confirmed_at',
    )
    .eq('id', verified.orderId)
    .maybeSingle()
  if (order.error || !order.data) notFound()
  const orderData = order.data

  const baseAccount = () =>
    db
      .from('bank_accounts')
      .select('id,bank_code,account_name,account_number')
      .eq('tenant_id', orderData.tenant_id)
      .eq('is_active', true)
  const account = orderData.live_bank_account_id
    ? await baseAccount().eq('id', orderData.live_bank_account_id).maybeSingle()
    : await baseAccount().eq('is_primary', true).maybeSingle()
  const bank = account.data
  let qrUrl: string | null = null
  if (bank) {
    const qr = await db
      .from('bank_receiving_qr')
      .select('image_path,bank_code_snapshot,account_number_snapshot')
      .eq('tenant_id', orderData.tenant_id)
      .eq('account_id', bank.id)
      .maybeSingle()
    if (
      qr.data &&
      qr.data.bank_code_snapshot === bank.bank_code &&
      qr.data.account_number_snapshot === bank.account_number
    ) {
      const signed = await db.storage
        .from('bank-receiving-qr')
        .createSignedUrl(qr.data.image_path, 600)
      qrUrl = signed.data?.signedUrl ?? null
    }
  }
  const paid = orderData.status !== 'pending_payment'

  if (orderData.live_variant_selection_required) {
    const pending = await db
      .from('orders')
      .select('amount,live_variant_selection_required,live_variant_confirmed_at')
      .eq('tenant_id', orderData.tenant_id)
      .eq('customer_id', orderData.customer_id)
      .eq('status', 'pending_payment')
    const variants = await db
      .from('commerce_variants')
      .select('id,label,price,stock')
      .eq('tenant_id', orderData.tenant_id)
      .eq('product_id', orderData.product_id)
      .eq('is_active', true)
      .order('label')
    return (
      <LiveCfVariantPayment
        token={token}
        productName={orderData.product_name}
        status={orderData.status}
        initialSelection={{
          variant_id: orderData.variant_id,
          variant_label: orderData.variant_label,
          amount: Number(orderData.amount),
          confirmed_at: orderData.live_variant_confirmed_at,
          payment_total: pending.error
            ? 0
            : (pending.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0),
          remaining_selections: pending.error
            ? 1
            : (pending.data ?? []).filter(
                (row) => row.live_variant_selection_required && !row.live_variant_confirmed_at,
              ).length,
        }}
        variants={(variants.data ?? []).map((variant) => ({
          ...variant,
          price: Number(variant.price),
        }))}
        bank={
          bank
            ? {
                name: findBank(bank.bank_code)?.name ?? bank.bank_code,
                account_name: bank.account_name,
                account_number: bank.account_number,
              }
            : null
        }
        qrUrl={qrUrl}
      />
    )
  }

  return (
    <main className="min-h-dvh bg-linear-to-br from-orange-50 via-white to-rose-50 px-4 py-10 text-slate-900">
      <section className="mx-auto max-w-lg overflow-hidden rounded-3xl bg-white shadow-xl shadow-orange-950/10 ring-1 ring-orange-100">
        <header className="bg-linear-to-r from-orange-500 to-rose-500 p-6 text-white">
          <p className="flex items-center gap-2 text-sm font-medium text-white/90">
            <LockKeyhole className="h-4 w-4" /> ลิงก์ชำระเงินที่ปลอดภัย
          </p>
          <h1 className="mt-2 text-2xl font-bold">ออเดอร์ Live Commerce CF</h1>
        </header>
        <div className="space-y-5 p-6">
          <div className="flex gap-3 rounded-2xl bg-slate-50 p-4">
            <PackageCheck className="mt-0.5 h-6 w-6 text-orange-500" />
            <div>
              <p className="font-semibold">{orderData.product_name}</p>
              {orderData.variant_label && (
                <p className="text-sm text-slate-500">{orderData.variant_label}</p>
              )}
              <p className="mt-1 text-2xl font-bold text-orange-600">
                {Number(orderData.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
              </p>
            </div>
          </div>
          {paid ? (
            <div className="rounded-2xl bg-emerald-50 p-4 font-medium text-emerald-800">
              ออเดอร์นี้ได้รับการชำระหรือดำเนินการแล้ว
            </div>
          ) : bank ? (
            <div className="rounded-2xl border border-slate-200 p-5 text-center">
              <Building2 className="mx-auto h-6 w-6 text-slate-500" />
              <p className="mt-2 text-sm text-slate-500">โอนเข้าบัญชี</p>
              <p className="font-semibold">{findBank(bank.bank_code)?.name ?? bank.bank_code}</p>
              <p className="mt-1 text-xl font-bold tracking-wide">{bank.account_number}</p>
              <p className="text-sm text-slate-500">{bank.account_name}</p>
              {qrUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed QR URL
                <img
                  src={qrUrl}
                  alt="QR สำหรับชำระเงิน"
                  className="mx-auto mt-4 h-52 w-52 rounded-xl object-contain"
                />
              )}
            </div>
          ) : (
            <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
              ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับเงิน กรุณาติดต่อร้านค้าทางแชท
            </p>
          )}
          <p className="flex items-center justify-center gap-2 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" /> ลิงก์นี้หมดอายุอัตโนมัติภายใน 24 ชั่วโมง
          </p>
        </div>
      </section>
    </main>
  )
}
