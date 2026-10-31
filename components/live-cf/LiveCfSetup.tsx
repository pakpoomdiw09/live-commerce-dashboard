'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BadgeCheck,
  ChevronDown,
  CircleStop,
  CreditCard,
  FlaskConical,
  Link2,
  Minus,
  Package,
  Play,
  Plus,
  Radio,
  Send,
  ShoppingCart,
} from 'lucide-react'
import type { CommentRule, LiveProductOption } from '@/lib/features/comments/comment-rules'
import { matchesCfCode, normalizeCfCode } from '@/lib/features/commerce/cf-code'

type Page = { id: string; name: string; picture: string | null }
type Bank = {
  id: string
  bank_code: string
  account_name: string
  account_number: string
  is_primary: boolean | null
}

const field =
  'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-3 focus:ring-orange-100'
const card = 'rounded-2xl bg-white shadow-sm ring-1 ring-slate-200'

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-orange-500' : 'bg-slate-300'}`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`}
      />
    </button>
  )
}

function StepTitle({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 text-lg font-bold text-slate-900">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-orange-500 text-white">
        {number}
      </span>
      {children}
    </h2>
  )
}

export function LiveCfSetup({
  tenantId,
  pages,
  products,
  bankAccounts,
  initialRule,
  setupError,
}: {
  tenantId: string
  pages: Page[]
  products: LiveProductOption[]
  bankAccounts: Bank[]
  initialRule: CommentRule | null
  setupError: string | null
}) {
  const router = useRouter()
  const [id, setId] = useState(initialRule?.id ?? null)
  const [pageId, setPageId] = useState(initialRule?.page_ids[0] ?? pages[0]?.id ?? '')
  const [livePostId, setLivePostId] = useState(initialRule?.live_post_id ?? '')
  const [productId, setProductId] = useState(initialRule?.live_product_id ?? products[0]?.id ?? '')
  const initialProduct = products.find(
    (item) => item.id === (initialRule?.live_product_id ?? products[0]?.id),
  )
  const [variantId, setVariantId] = useState(
    initialRule?.live_variant_id ?? initialProduct?.variants[0]?.id ?? '',
  )
  const [code, setCode] = useState(initialRule?.keywords[0] ?? '159')
  const [stockLimit, setStockLimit] = useState(
    initialRule?.live_stock_limit ?? Math.max(1, Math.min(initialProduct?.stock ?? 5, 5)),
  )
  const [deductStock, setDeductStock] = useState(initialRule?.live_deduct_stock ?? true)
  const [privateReply, setPrivateReply] = useState(initialRule?.inbox_enabled ?? true)
  const [publicReply, setPublicReply] = useState(initialRule?.reply_enabled ?? true)
  const [privateText, setPrivateText] = useState(
    initialRule?.inbox_text ??
      'ยินดีด้วยครับ! คุณได้รับสินค้า {product_name}\nยอดชำระทั้งหมด {price} บาท\nชำระเงินอย่างปลอดภัย: {payment_link}',
  )
  const [publicText, setPublicText] = useState(
    initialRule?.reply_text ?? 'รับออเดอร์แล้วค่ะ กรุณาตรวจสอบรายละเอียดในข้อความส่วนตัว',
  )
  const [bankAccountId, setBankAccountId] = useState(
    initialRule?.live_bank_account_id ?? bankAccounts[0]?.id ?? '',
  )
  const [testText, setTestText] = useState('CF 159')
  const [active, setActive] = useState(initialRule?.is_active ?? false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(setupError)

  const product = products.find((item) => item.id === productId)
  const variant = product?.variants.find((item) => item.id === variantId) ?? null
  const selectedStock = variant
    ? Math.min(product?.stock ?? 0, variant.stock)
    : (product?.stock ?? 0)
  const selectedPrice = variant?.price ?? product?.price ?? 0
  const parserMatch = !!normalizeCfCode(code) && matchesCfCode(testText, code)
  const selectedBank = bankAccounts.find((item) => item.id === bankAccountId)

  const examples = useMemo(() => {
    const value = code.trim() || '159'
    return [value, `CF ${value}`, `cf${value}`, `เอา ${value}`]
  }, [code])

  function chooseProduct(nextId: string) {
    setProductId(nextId)
    const next = products.find((item) => item.id === nextId)
    setVariantId(next?.variants[0]?.id ?? '')
    setStockLimit(Math.max(1, Math.min(next?.variants[0]?.stock ?? next?.stock ?? 1, 5)))
  }

  async function save() {
    setNotice(null)
    if (!pageId || !product || !normalizeCfCode(code) || stockLimit < 1)
      return setNotice('กรุณาเลือกเพจ สินค้า และกรอกรหัส CF ให้ครบ')
    if (product.variants.length && !variant) return setNotice('กรุณาเลือกตัวเลือกสินค้า')
    setSaving(true)
    try {
      const response = await fetch('/api/live-cf/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          tenantId,
          pageId,
          livePostId,
          productId,
          variantId: variant?.id ?? null,
          code,
          stockLimit,
          deductStock,
          privateReply,
          publicReply,
          privateText,
          publicText,
          bankAccountId: bankAccountId || null,
          isActive: true,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'บันทึกไม่สำเร็จ')
      setId(result.id)
      setActive(true)
      setNotice('บันทึกแล้ว ระบบพร้อมรับคอมเมนต์จากไลฟ์นี้')
      router.refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-50/70 p-4 text-slate-700 md:p-7">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span
                className={`h-4 w-4 rounded-full ${active ? 'bg-emerald-500' : 'bg-rose-500'}`}
              />
              <h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">
                ตั้งค่าระบบดูดออเดอร์ไลฟ์สด{' '}
                <span className="text-base font-medium text-slate-500 md:text-lg">
                  Live Commerce CF
                </span>
              </h1>
            </div>
            <p className="mt-1.5 text-sm text-slate-500 md:text-base">
              เลือกสินค้า ตั้งรหัสจอง และสร้างออเดอร์จากคอมเมนต์แบบ atomic
            </p>
          </div>
          <span
            className={`rounded-full px-4 py-2 text-sm font-semibold ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}
          >
            {active ? '● กำลังทำงาน' : '● ยังไม่เริ่มทำงาน'}
          </span>
        </header>

        {notice && (
          <div
            role="status"
            className={`mb-5 rounded-xl px-4 py-3 text-sm ring-1 ${notice.startsWith('บันทึกแล้ว') ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}`}
          >
            {notice}
          </div>
        )}

        <section className={`${card} mb-5 grid gap-4 p-5 md:grid-cols-2`}>
          <label className="text-sm font-semibold text-slate-800">
            Facebook Page
            <select
              className={field}
              value={pageId}
              onChange={(event) => setPageId(event.target.value)}
            >
              <option value="">เลือกเพจ</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-800">
            Active Live Video ID
            <input
              className={field}
              inputMode="numeric"
              value={livePostId}
              onChange={(event) => setLivePostId(event.target.value)}
              placeholder="เช่น 123456789 หรือ 123_456"
            />
            <span className="mt-1.5 flex items-center gap-1 text-xs font-normal text-slate-400">
              <Link2 className="h-3.5 w-3.5" /> เว้นว่างเพื่อรับทุกไลฟ์ของเพจที่เลือก
            </span>
          </label>
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(330px,.8fr)]">
          <section className={`${card} divide-y divide-slate-200 overflow-hidden`}>
            <div className="space-y-4 p-5 md:p-6">
              <StepTitle number={1}>เลือกสินค้าจากร้านค้า / เซลเพจ</StepTitle>
              <label className="block text-sm font-semibold">
                สินค้าในร้าน
                <div className="relative">
                  <select
                    className={`${field} appearance-none pr-10`}
                    value={productId}
                    onChange={(event) => chooseProduct(event.target.value)}
                  >
                    <option value="">เลือกสินค้า</option>
                    {products.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} • ฿{Number(item.price).toLocaleString('th-TH')} • คงเหลือ{' '}
                        {item.stock}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-5 h-4 w-4 text-slate-400" />
                </div>
              </label>
              {product && (
                <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-3">
                  <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- tenant-owned dynamic product URL
                      <img src={product.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-7 w-7 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{product.name}</p>
                    <p className="text-sm text-slate-500">
                      ฿{Number(selectedPrice).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                    คงเหลือ {selectedStock} ชิ้น
                  </span>
                </div>
              )}
              {!!product?.variants.length && (
                <label className="block text-sm font-semibold">
                  ตัวเลือกสินค้า
                  <select
                    className={field}
                    value={variantId}
                    onChange={(event) => setVariantId(event.target.value)}
                  >
                    {product.variants.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label} • ฿{Number(item.price).toLocaleString('th-TH')} • {item.stock}{' '}
                        ชิ้น
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="space-y-4 p-5 md:p-6">
              <StepTitle number={2}>กำหนดรหัส CF</StepTitle>
              <label className="block text-sm font-semibold">
                รหัสเปิดจอง
                <input
                  className={`${field} text-base font-bold`}
                  value={code}
                  maxLength={40}
                  onChange={(event) => {
                    setCode(event.target.value)
                    if (testText.startsWith('CF ')) setTestText(`CF ${event.target.value}`)
                  }}
                  placeholder="159, A1, Z99, แดง"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setTestText(example)}
                    className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-600"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold">จำนวนที่เปิดให้ CF ในไลฟ์นี้</span>
                <div className="flex overflow-hidden rounded-xl border border-slate-200">
                  <button
                    type="button"
                    aria-label="ลดจำนวน"
                    onClick={() => setStockLimit((value) => Math.max(1, value - 1))}
                    className="grid h-11 w-11 place-items-center hover:bg-slate-50"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    aria-label="จำนวนสต็อกไลฟ์"
                    value={stockLimit}
                    onChange={(event) =>
                      setStockLimit(Math.max(1, Number(event.target.value) || 1))
                    }
                    className="w-20 border-x border-slate-200 text-center font-bold outline-none"
                  />
                  <button
                    type="button"
                    aria-label="เพิ่มจำนวน"
                    onClick={() => setStockLimit((value) => Math.min(1_000_000, value + 1))}
                    className="grid h-11 w-11 place-items-center hover:bg-slate-50"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <span className="text-sm">ชิ้น</span>
              </div>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={deductStock}
                  onChange={(event) => setDeductStock(event.target.checked)}
                  className="mt-0.5 h-5 w-5 accent-orange-500"
                />
                <span>
                  <b>ตัดสต็อกหน้าร้านทันทีเมื่อ CF สำเร็จ</b>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    ใช้ transaction เดียวกับหน้าเซลเพจเพื่อป้องกันการขายเกินสต็อก
                  </span>
                </span>
              </label>
            </div>

            <div className="space-y-5 p-5 md:p-6">
              <StepTitle number={3}>ข้อความตอบกลับอัตโนมัติ</StepTitle>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Toggle checked={privateReply} onChange={setPrivateReply} label="Private Reply" />
                  <b>ส่งสรุปยอดเข้า Messenger</b>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">
                    Private Reply
                  </span>
                </div>
                {privateReply && (
                  <>
                    <textarea
                      className={field}
                      rows={4}
                      value={privateText}
                      onChange={(event) => setPrivateText(event.target.value)}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold">
                        บัญชีรับเงิน
                        <select
                          className={field}
                          value={bankAccountId}
                          onChange={(event) => setBankAccountId(event.target.value)}
                        >
                          <option value="">ยังไม่เลือกบัญชี</option>
                          {bankAccounts.map((bank) => (
                            <option key={bank.id} value={bank.id}>
                              {bank.bank_code} • {bank.account_number}{' '}
                              {bank.is_primary ? '• หลัก' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-700">
                        <CreditCard className="mb-1 h-4 w-4" />
                        Meta จะได้รับข้อความเดียวพร้อม Secure Payment Link เท่านั้น ไม่มีการแนบรูป
                        QR ดิบ
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="space-y-3 border-t border-slate-200 pt-5">
                <div className="flex items-center gap-3">
                  <Toggle checked={publicReply} onChange={setPublicReply} label="Public Reply" />
                  <b>ตอบกลับใต้คอมเมนต์</b>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">
                    Public Reply
                  </span>
                </div>
                {publicReply && (
                  <textarea
                    className={field}
                    rows={2}
                    value={publicText}
                    onChange={(event) => setPublicText(event.target.value)}
                  />
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-5 lg:sticky lg:top-5">
            <section className={`${card} p-5`}>
              <h2 className="text-lg font-bold text-slate-950">สรุปการตั้งค่า</h2>
              {product ? (
                <>
                  <div className="mt-4 flex items-center gap-3">
                    <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-xl bg-slate-100">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- tenant-owned dynamic product URL
                        <img
                          src={product.image_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Package className="text-slate-300" />
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{product.name}</p>
                      {variant && <p className="text-xs text-slate-500">{variant.label}</p>}
                      <span className="text-xs font-medium text-emerald-600">
                        คงเหลือ {selectedStock} ชิ้น
                      </span>
                    </div>
                  </div>
                  <dl className="mt-5 divide-y divide-slate-100 border-t border-slate-200 text-sm">
                    {[
                      ['รหัส CF', code || '—'],
                      ['เปิดจอง', `${stockLimit} ชิ้น`],
                      ['ตัดสต็อกอัตโนมัติ', deductStock ? 'เปิด' : 'ปิด'],
                      ['ส่งข้อความส่วนตัว', privateReply ? 'เปิด' : 'ปิด'],
                      ['ตอบใต้คอมเมนต์', publicReply ? 'เปิด' : 'ปิด'],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4 py-3">
                        <dt className="text-slate-500">{label}</dt>
                        <dd
                          className={`font-semibold ${value === 'เปิด' ? 'text-emerald-600' : 'text-slate-900'}`}
                        >
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {selectedBank && (
                    <p className="mt-3 text-xs text-slate-500">
                      บัญชี: {selectedBank.bank_code} ••••{selectedBank.account_number.slice(-4)}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-4 text-sm text-slate-500">เลือกสินค้าเพื่อดูสรุป</p>
              )}
            </section>
            <section className={`${card} p-5`}>
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
                <FlaskConical className="h-5 w-5 text-orange-500" /> Interactive Test Input
              </h2>
              <p className="mt-1 text-xs text-slate-500">จำลองคอมเมนต์โดยไม่เรียก Facebook API</p>
              <input
                className={`${field} mt-4`}
                value={testText}
                onChange={(event) => setTestText(event.target.value)}
                placeholder="ลองพิมพ์ CF 159"
              />
              <div
                className={`mt-3 flex items-center gap-3 rounded-xl p-3 text-sm ${parserMatch ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-500'}`}
              >
                {parserMatch ? (
                  <>
                    <BadgeCheck className="h-5 w-5" />
                    <span className="flex-1">ตรงรหัสแบบเต็มคำ</span>
                    <ShoppingCart className="h-5 w-5" />
                  </>
                ) : (
                  <>
                    <CircleStop className="h-5 w-5" />
                    <span>ไม่สร้างออเดอร์ — Parser ไม่ตรงรหัส</span>
                  </>
                )}
              </div>
            </section>
          </aside>
        </div>

        <div className="sticky bottom-3 z-10 mt-5 flex justify-end rounded-2xl bg-white/95 p-3 shadow-lg ring-1 ring-slate-200 backdrop-blur">
          <button
            type="button"
            disabled={saving || !products.length || !pages.length}
            onClick={save}
            className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 px-5 py-3 font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Radio className="h-5 w-5 animate-pulse" />
            ) : active ? (
              <Send className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 fill-current" />
            )}
            {saving ? 'กำลังบันทึก...' : active ? 'บันทึกการตั้งค่า' : 'บันทึกและเริ่มดูดคอมเมนต์'}
          </button>
        </div>
      </div>
    </div>
  )
}
