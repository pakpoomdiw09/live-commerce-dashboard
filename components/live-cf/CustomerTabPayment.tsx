import { supabaseAdmin } from '@/lib/supabase/server'
import { findBank } from '@/lib/features/banking/banks'
import type { CustomerTab } from '@/lib/features/commerce/customer-tab-types'
import { tabMoney, customerTabItemLabel } from '@/lib/features/commerce/customer-tab-types'
import { AuctionSlipUpload } from './AuctionSlipUpload'

export async function CustomerTabPayment({ tab, token }: { tab: CustomerTab; token: string }) {
  const db = supabaseAdmin()
  let account = db
    .from('bank_accounts')
    .select('id,bank_code,account_name,account_number')
    .eq('tenant_id', tab.tenant_id)
    .eq('is_active', true)
  account = tab.bank_account_id
    ? account.eq('id', tab.bank_account_id)
    : account.eq('is_primary', true)
  const bank = await account.maybeSingle()
  let qrUrl: string | null = null
  if (bank.data) {
    const qr = await db
      .from('bank_receiving_qr')
      .select('image_path,bank_code_snapshot,account_number_snapshot')
      .eq('tenant_id', tab.tenant_id)
      .eq('account_id', bank.data.id)
      .maybeSingle()
    if (
      qr.data &&
      qr.data.account_number_snapshot === bank.data.account_number &&
      qr.data.bank_code_snapshot === bank.data.bank_code
    )
      qrUrl =
        (await db.storage.from('bank-receiving-qr').createSignedUrl(qr.data.image_path, 600)).data
          ?.signedUrl ?? null
  }
  return (
    <main className="min-h-dvh bg-orange-50 px-4 py-10 text-slate-900">
      <section className="mx-auto max-w-xl space-y-5 rounded-3xl bg-white p-6 shadow-lg">
        <header>
          <p className="text-sm font-medium text-orange-600">บิลสะสมประมูล / CF</p>
          <h1 className="mt-1 text-2xl font-bold">สรุปยอดพระเครื่องของคุณ</h1>
        </header>
        <ul className="divide-y divide-slate-100">
          {tab.customer_tab_items
            .filter((item) => !item.cancelled)
            .sort((a, b) => a.closed_at.localeCompare(b.closed_at))
            .map((item) => (
              <li key={item.order_id} className="flex justify-between gap-3 py-3 text-sm">
                <span>
                  {customerTabItemLabel(item)}
                  {item.variant_label ? ` • ${item.variant_label}` : ''}
                  {item.requires_variant && item.selection_link && (
                    <a
                      className="mt-1 block font-semibold text-orange-700 underline"
                      href={item.selection_link}
                    >
                      เลือกรูปแบบสินค้าเพื่อยืนยันราคาก่อนชำระเงิน
                    </a>
                  )}
                  <span className="mt-1 block text-xs text-slate-400">
                    {new Date(item.closed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
                  </span>
                </span>
                <span className="whitespace-nowrap font-semibold">{tabMoney(item.amount)} บาท</span>
              </li>
            ))}
        </ul>
        <dl className="space-y-2 rounded-2xl bg-slate-50 p-4 text-sm">
          {[
            ['ค่าจัดส่งครั้งเดียว', tab.shipping_fee],
            ['ยอดรวมสะสม', tab.total_amount],
            ['โอนแล้วและตรวจผ่าน', tab.paid_amount],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between">
              <dt>{label}</dt>
              <dd>{tabMoney(Number(value))} บาท</dd>
            </div>
          ))}
          <div className="border-t border-slate-200 pt-3">
            <dt>ยอดค้างชำระสุทธิที่ต้องโอนเพิ่ม</dt>
            <dd className="mt-1 text-3xl font-bold text-orange-600">
              {tabMoney(tab.remaining_amount)} บาท
            </dd>
          </div>
        </dl>
        {tab.credit_amount > 0 && (
          <p className="text-sm text-emerald-700">
            ยอดโอนเกินคงเหลือ {tabMoney(tab.credit_amount)} บาท
            กรุณาติดต่อร้านค้าเพื่อยืนยันการจัดการยอดเกิน
          </p>
        )}
        {bank.data && (
          <div className="rounded-2xl border border-slate-200 p-4 text-center">
            <p>{findBank(bank.data.bank_code)?.name ?? bank.data.bank_code}</p>
            <p className="mt-1 text-xl font-bold">{bank.data.account_number}</p>
            <p className="text-sm text-slate-500">{bank.data.account_name}</p>
            {qrUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- private QR uses a short-lived signed URL
              <img
                src={qrUrl}
                alt="QR บัญชีรับเงินของร้าน"
                className="mx-auto mt-4 h-52 w-52 object-contain"
              />
            )}
          </div>
        )}
        {tab.customer_tab_items.some((item) => !item.cancelled && item.requires_variant) ? (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            กรุณาเลือกรูปแบบสินค้าในรายการที่ยังไม่ยืนยันก่อนแนบสลิปครับ
          </p>
        ) : Number(tab.remaining_amount) > 0 ? (
          <>
            <p className="text-sm text-slate-600">
              โอนบางส่วนได้ ระบบจะตรวจสลิปและหักยอดให้อัตโนมัติ โดยคิดค่าจัดส่งครั้งเดียวในไลฟ์นี้
            </p>
            <AuctionSlipUpload
              key={`${tab.id}:${tab.revision}`}
              token={token}
              initiallySubmitted={false}
              automatic
            />
          </>
        ) : (
          <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">
            ชำระครบแล้วครับ รายการใหม่จากไลฟ์เดียวกันจะเพิ่มเข้าบิลนี้โดยเก็บยอดที่โอนแล้วไว้
          </p>
        )}
        <p className="text-xs text-slate-400">
          ยอดในหน้านี้อ้างอิงข้อมูลล่าสุดเมื่อเปิดหน้า กรุณาเปิดหน้าใหม่หลังชนะรายการเพิ่มเติม
        </p>
      </section>
    </main>
  )
}
