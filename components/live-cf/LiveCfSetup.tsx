'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PageBanner } from '@/components/ui/page-banner'
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

  async function toggleActive(nextActive: boolean) {
    if (!id) return
    setSaving(true)
    setNotice(null)
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
          isActive: nextActive,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'เปลี่ยนสถานะไม่สำเร็จ')
      setActive(nextActive)
      setNotice(nextActive ? 'เปิดใช้งานระบบดูดออเดอร์แล้ว' : 'หยุดการทำงานระบบดูดออเดอร์ชั่วคราวแล้ว')
      router.refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'เปลี่ยนสถานะไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const statusLabel = !id ? 'ยังไม่เริ่มทำงาน' : active ? 'กำลังทำงาน' : 'หยุดชั่วคราว'

  return (
    <div className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
      {/* Header สไตล์สีส้ม SnapBot ตามธีมเดียวกับหน้าตอบกลับคอมเมนต์ */}
      <PageBanner className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20 text-white shadow-xs backdrop-blur-xs ring-1 ring-white/30">
            <Radio className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              ระบบดูดออเดอร์ไลฟ์สด
            </h1>
            <p className="mt-1 text-sm text-white/90 md:text-base">
              เลือกสินค้า ตั้งรหัส CF และสร้างออเดอร์จากคอมเมนต์แบบเรียลไทม์
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-xs ring-1 backdrop-blur-xs ${
              !id
                ? 'bg-white/20 text-white ring-white/30'
                : active
                  ? 'bg-emerald-500/95 text-white ring-emerald-300'
                  : 'bg-amber-400/90 text-amber-950 ring-amber-300'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                !id ? 'bg-white/70' : active ? 'bg-white animate-pulse' : 'bg-amber-950'
              }`}
            />
            {statusLabel}
          </span>
        </div>
      </PageBanner>

      {notice && (
        <div
          role="status"
          className={`rounded-2xl px-5 py-4 text-sm font-medium ring-1 ${
            notice.startsWith('บันทึกแล้ว') || notice.startsWith('เปิดใช้งาน')
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
              : 'bg-amber-50 text-amber-800 ring-amber-200'
          }`}
        >
          {notice}
        </div>
      )}

      {/* เลือกเพจ Facebook และ Live Video ID */}
      <section className={`${card} grid gap-5 p-5 md:grid-cols-2 md:p-6`}>
        <label className="text-sm font-semibold text-slate-800">
          เลือกเพจ Facebook
          <select
            aria-label="เลือกเพจ Facebook"
            className={field}
            value={pageId}
            onChange={(event) => setPageId(event.target.value)}
          >
            <option value="">เลือกเพจที่ใช้ไลฟ์สด</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-800">
          รหัสวิดีโอไลฟ์สด (Live Video ID)
          <input
            aria-label="รหัสวิดีโอไลฟ์สด"
            className={field}
            inputMode="numeric"
            value={livePostId}
            onChange={(event) => setLivePostId(event.target.value)}
            placeholder="เช่น 123456789 หรือ 123_456"
          />
          <span className="mt-1.5 flex items-center gap-1.5 text-xs font-normal text-slate-500">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            เว้นว่างเพื่อรับทุกไลฟ์ของเพจ หรือใส่รหัสวิดีโอเพื่อระบุเฉพาะไลฟ์นี้ (เช่น 123456789 หรือ 123_456)
          </span>
        </label>
      </section>

      {/* Responsive Layout 2 คอลัมน์บน Desktop */}
      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* ฝั่งซ้าย: 3 สเต็ปตั้งค่า */}
        <section className={`${card} divide-y divide-slate-100 overflow-hidden lg:col-span-7 xl:col-span-8`}>
          {/* สเต็ป 1: เลือกสินค้า */}
          <div className="space-y-4 p-5 md:p-6">
            <StepTitle number={1}>เลือกสินค้าจากร้านค้า / เซลเพจ</StepTitle>
            <label className="block text-sm font-semibold text-slate-800">
              สินค้าในร้าน
              <div className="relative">
                <select
                  aria-label="สินค้าจากร้านค้า / เซลเพจ"
                  className={`${field} appearance-none pr-10`}
                  value={productId}
                  onChange={(event) => chooseProduct(event.target.value)}
                >
                  <option value="">เลือกสินค้า</option>
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} • ฿{Number(item.price).toLocaleString('th-TH')} • คงเหลือ {item.stock} ชิ้น
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-5 right-3 h-4 w-4 text-slate-400" />
              </div>
            </label>
            {!products.length && (
              <p className="rounded-xl bg-amber-50 p-3.5 text-xs text-amber-800 ring-1 ring-amber-200">
                ยังไม่มีสินค้าในร้านค้า กรุณาเพิ่มสินค้าที่หน้า{' '}
                <Link href="/shop" className="font-semibold text-orange-600 underline hover:text-orange-700">
                  ร้านค้า / เซลเพจ
                </Link>{' '}
                ก่อน
              </p>
            )}
            {product && (
              <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- tenant-owned dynamic product URL
                    <img src={product.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Package className="h-7 w-7 text-slate-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{product.name}</p>
                  <p className="text-sm font-medium text-slate-600">
                    ฿{Number(selectedPrice).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  คงเหลือ {selectedStock} ชิ้น
                </span>
              </div>
            )}
            {!!product?.variants.length && (
              <label className="block text-sm font-semibold text-slate-800">
                ตัวเลือกสินค้า (สี / ขนาด)
                <select
                  aria-label="ตัวเลือกสินค้า"
                  className={field}
                  value={variantId}
                  onChange={(event) => setVariantId(event.target.value)}
                >
                  {product.variants.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} • ฿{Number(item.price).toLocaleString('th-TH')} • {item.stock} ชิ้น
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* สเต็ป 2: กำหนดรหัส CF */}
          <div className="space-y-4 p-5 md:p-6">
            <StepTitle number={2}>กำหนดรหัส CF</StepTitle>
            <label className="block text-sm font-semibold text-slate-800">
              รหัส CF สำหรับพิมพ์จอง
              <input
                aria-label="รหัส CF สำหรับพิมพ์จอง"
                className={`${field} text-base font-bold text-orange-600`}
                value={code}
                maxLength={40}
                onChange={(event) => {
                  setCode(event.target.value)
                  if (testText.startsWith('CF ')) setTestText(`CF ${event.target.value}`)
                }}
                placeholder="เช่น 159, A1, Z99, แดง"
              />
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                ตัวอย่างข้อความที่ลูกค้าพิมพ์:
              </span>
              <div className="flex flex-wrap gap-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setTestText(example)}
                    className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:bg-orange-100"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <span className="text-sm font-semibold text-slate-800">
                จำนวนที่เปิดให้ CF ในไลฟ์นี้:
              </span>
              <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  aria-label="ลดจำนวน"
                  onClick={() => setStockLimit((value) => Math.max(1, value - 1))}
                  className="grid h-10 w-10 place-items-center text-slate-600 hover:bg-slate-50"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  aria-label="จำนวนสต็อกไลฟ์"
                  value={stockLimit}
                  onChange={(event) =>
                    setStockLimit(Math.max(1, Number(event.target.value) || 1))
                  }
                  className="w-20 border-x border-slate-200 text-center font-bold text-slate-800 outline-none"
                />
                <button
                  type="button"
                  aria-label="เพิ่มจำนวน"
                  onClick={() => setStockLimit((value) => Math.min(1_000_000, value + 1))}
                  className="grid h-10 w-10 place-items-center text-slate-600 hover:bg-slate-50"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <span className="text-sm font-medium text-slate-600">ชิ้น</span>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 transition hover:bg-slate-50">
              <input
                type="checkbox"
                checked={deductStock}
                onChange={(event) => setDeductStock(event.target.checked)}
                className="mt-0.5 h-5 w-5 rounded accent-orange-500"
              />
              <span className="text-sm">
                <b className="font-semibold text-slate-900">ตัดสต็อกหน้าร้านทันทีเมื่อ CF สำเร็จ</b>
                <span className="mt-0.5 block text-xs text-slate-500">
                  ใช้ระบบตัดสต็อกแบบเรียลไทม์ร่วมกับหน้าร้านค้า เพื่อป้องกันการขายเกินสต็อก
                </span>
              </span>
            </label>
          </div>

          {/* สเต็ป 3: ข้อความตอบกลับอัตโนมัติ */}
          <div className="space-y-5 p-5 md:p-6">
            <StepTitle number={3}>ข้อความตอบกลับอัตโนมัติ</StepTitle>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Toggle checked={privateReply} onChange={setPrivateReply} label="ส่งแชทส่วนตัว" />
                <span className="font-semibold text-slate-900">ส่งสรุปยอดเข้า Messenger</span>
                <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-800">
                  ส่งแชทส่วนตัว
                </span>
              </div>
              {privateReply && (
                <>
                  <textarea
                    aria-label="ข้อความส่งแชทส่วนตัว"
                    className={field}
                    rows={4}
                    value={privateText}
                    onChange={(event) => setPrivateText(event.target.value)}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-800">
                      บัญชีรับเงิน
                      <select
                        aria-label="เลือกบัญชีรับเงิน"
                        className={field}
                        value={bankAccountId}
                        onChange={(event) => setBankAccountId(event.target.value)}
                      >
                        <option value="">ยังไม่เลือกบัญชี</option>
                        {bankAccounts.map((bank) => (
                          <option key={bank.id} value={bank.id}>
                            {bank.bank_code} • {bank.account_number}{' '}
                            {bank.is_primary ? '• บัญชีหลัก' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="rounded-xl border border-orange-200/70 bg-orange-50/80 p-3.5 text-xs leading-relaxed text-orange-950">
                      <CreditCard className="mb-1.5 h-4 w-4 text-orange-600" />
                      ระบบจะส่งข้อความสรุปยอดพร้อมลิงก์ชำระเงินที่ปลอดภัย (Payment Link) ผ่าน Messenger ให้ลูกค้าโดยอัตโนมัติ
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="space-y-3 border-t border-slate-100 pt-5">
              <div className="flex items-center gap-3">
                <Toggle checked={publicReply} onChange={setPublicReply} label="ตอบใต้คอมเมนต์" />
                <span className="font-semibold text-slate-900">ตอบกลับใต้คอมเมนต์</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  ตอบใต้คอมเมนต์
                </span>
              </div>
              {publicReply && (
                <textarea
                  aria-label="ข้อความตอบกลับใต้คอมเมนต์"
                  className={field}
                  rows={2}
                  value={publicText}
                  onChange={(event) => setPublicText(event.target.value)}
                />
              )}
            </div>
          </div>
        </section>

        {/* ฝั่งขวา: กล่องสรุปเรียลไทม์ และ ทดลองพิมพ์คอมเมนต์ */}
        <aside className="space-y-6 lg:sticky lg:top-6 lg:col-span-5 xl:col-span-4">
          <section className={`${card} p-5 md:p-6`}>
            <h2 className="text-lg font-bold text-slate-950">สรุปการตั้งค่า</h2>
            {product ? (
              <>
                <div className="mt-4 flex items-center gap-3.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- tenant-owned dynamic product URL
                      <img
                        src={product.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="h-6 w-6 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{product.name}</p>
                    {variant && <p className="text-xs text-slate-500">{variant.label}</p>}
                    <span className="text-xs font-semibold text-emerald-600">
                      คงเหลือ {selectedStock} ชิ้น
                    </span>
                  </div>
                </div>
                <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-200 text-sm">
                  {[
                    ['รหัส CF', code || '—'],
                    ['เปิดจอง', `${stockLimit} ชิ้น`],
                    ['ตัดสต็อกอัตโนมัติ', deductStock ? 'เปิด' : 'ปิด'],
                    ['ส่งแชทส่วนตัว', privateReply ? 'เปิด' : 'ปิด'],
                    ['ตอบใต้คอมเมนต์', publicReply ? 'เปิด' : 'ปิด'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 py-2.5">
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
                  <p className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-600">
                    บัญชีรับเงิน: <b className="text-slate-800">{selectedBank.bank_code}</b> ••••{selectedBank.account_number.slice(-4)}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">
                กรุณาเลือกสินค้าเพื่อดูสรุป
              </p>
            )}
          </section>

          <section className={`${card} p-5 md:p-6`}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
              <FlaskConical className="h-5 w-5 text-orange-500" /> ทดลองพิมพ์คอมเมนต์
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              จำลองการพิมพ์คอมเมนต์เพื่อทดสอบรหัส CF โดยไม่กระทบเพจจริง
            </p>
            <input
              aria-label="ทดลองพิมพ์คอมเมนต์"
              className={`${field} mt-4`}
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              placeholder="ลองพิมพ์ CF 159"
            />
            <div
              className={`mt-3 flex items-center gap-2.5 rounded-xl border p-3 text-sm font-medium transition ${
                parserMatch
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-slate-100 text-slate-600'
              }`}
            >
              {parserMatch ? (
                <>
                  <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="flex-1">ตรงรหัส CF ระบบพร้อมสร้างออเดอร์</span>
                  <ShoppingCart className="h-4 w-4 shrink-0 text-emerald-600" />
                </>
              ) : (
                <>
                  <CircleStop className="h-5 w-5 shrink-0 text-slate-400" />
                  <span className="flex-1">ไม่สร้างออเดอร์ — ข้อความไม่ตรงกับรหัส CF ที่ตั้งไว้</span>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>

      {/* Sticky Action Bar ด้านล่าง */}
      <div className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-slate-200 backdrop-blur">
        <div className="flex items-center gap-2.5 text-sm">
          <span
            className={`h-3 w-3 rounded-full ${
              !id ? 'bg-slate-400' : active ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
            }`}
          />
          <span className="font-semibold text-slate-800">
            {!id
              ? 'สถานะ: ยังไม่เริ่มทำงาน'
              : active
                ? 'สถานะ: กำลังทำงาน'
                : 'สถานะ: หยุดชั่วคราว'}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {id && (
            <button
              type="button"
              disabled={saving}
              onClick={() => toggleActive(!active)}
              className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                active
                  ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100'
              }`}
            >
              {active ? 'หยุดชั่วคราว' : 'เปิดใช้งานต่อ'}
            </button>
          )}
          <button
            type="button"
            disabled={saving || !products.length || !pages.length}
            onClick={save}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3 font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:brightness-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
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
