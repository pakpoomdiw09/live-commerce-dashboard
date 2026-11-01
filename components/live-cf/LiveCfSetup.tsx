'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PageBanner } from '@/components/ui/page-banner'
import { QuickProductModal } from './QuickProductModal'
import {
  BadgeCheck,
  ChevronDown,
  CircleStop,
  CreditCard,
  ExternalLink,
  Eye,
  FlaskConical,
  Link2,
  Minus,
  Package,
  Play,
  Plus,
  Radio,
  Send,
  ShoppingCart,
  Sparkles,
  X,
} from 'lucide-react'
import type { CommentRule, LiveProductOption } from '@/lib/features/comments/comment-rules'
import {
  MAX_LIVE_CF_CODES,
  addLiveCfCode,
  parseLiveCfCodes,
  matchLiveCfCode,
  liveCfCodeExamples,
  previewLiveCfCodes,
} from '@/lib/features/commerce/live-cf-codes'
import {
  extractFacebookLiveId,
  displayLiveReplyTemplate,
  storedLiveReplyTemplate,
} from '@/lib/features/commerce/live-cf-setup'

function generateDefaultPrivateText(
  productName?: string,
  price?: number,
  variantLabel?: string | null,
  customerSelectVariant = false,
) {
  const variantPart = variantLabel ? ' {variant_name}' : ''
  return displayLiveReplyTemplate(
    `ยินดีด้วยครับ! คุณได้รับสินค้า {product_name}${variantPart}\nราคา: {price} บาท (ยอดชำระ: {total} บาท)${customerSelectVariant ? '\nกรุณาเลือกรูปแบบสินค้าและตรวจสอบยอดสุดท้ายในหน้าชำระเงินก่อนโอน' : ''}\nชำระเงินและแนบสลิปเซลเพจได้ที่ลิงก์นี้: {payment_link}`,
  )
}

const VARIABLE_CHIPS = [
  { tag: '{product_name}', label: 'ชื่อสินค้า' },
  { tag: '{price}', label: 'ราคา' },
  { tag: '{variant_name}', label: 'ตัวเลือกสินค้า' },
  { tag: '{total}', label: 'ยอดชำระ' },
  { tag: '{payment_link}', label: 'ลิงก์ชำระเงิน/แนบสลิปเซลเพจ' },
]

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
  salesPageUrl = null,
}: {
  tenantId: string
  pages: Page[]
  products: LiveProductOption[]
  bankAccounts: Bank[]
  initialRule: CommentRule | null
  setupError: string | null
  salesPageUrl?: string | null
}) {
  const router = useRouter()
  const [createdProducts, setCreatedProducts] = useState<LiveProductOption[]>([])
  const [showProductModal, setShowProductModal] = useState(false)
  const productOptions = useMemo(
    () => [
      ...products,
      ...createdProducts.filter((item) => !products.some((row) => row.id === item.id)),
    ],
    [products, createdProducts],
  )
  const [id, setId] = useState(initialRule?.id ?? null)
  const [pageId, setPageId] = useState(initialRule?.page_ids[0] ?? pages[0]?.id ?? '')
  const [livePostId, setLivePostId] = useState(initialRule?.live_post_id ?? '')
  const [liveLinkTouched, setLiveLinkTouched] = useState(false)
  const parsedLiveId = extractFacebookLiveId(livePostId)
  const liveLinkError = liveLinkTouched && parsedLiveId === null
  const [productId, setProductId] = useState('')
  const [codes, setCodes] = useState<string[]>(() => [...(initialRule?.keywords ?? [])])
  const [codeDraft, setCodeDraft] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const [matchMode, setMatchMode] = useState<'flexible' | 'strict'>(
    (initialRule as CommentRule & { match_mode?: 'flexible' | 'strict' })?.match_mode ??
      (initialRule?.match_type === 'exact' ? 'strict' : 'flexible'),
  )
  const [stockLimit, setStockLimit] = useState(initialRule?.live_stock_limit ?? 5)
  const [deductStock, setDeductStock] = useState(initialRule?.live_deduct_stock ?? true)
  const [privateReply, setPrivateReply] = useState(initialRule?.inbox_enabled ?? true)
  const [publicReply, setPublicReply] = useState(initialRule?.reply_enabled ?? true)
  const [privateText, setPrivateText] = useState(
    initialRule?.inbox_text != null
      ? displayLiveReplyTemplate(initialRule.inbox_text)
      : generateDefaultPrivateText(),
  )
  const [publicText, setPublicText] = useState(
    initialRule?.reply_text ?? 'รับออเดอร์แล้วค่ะ กรุณาตรวจสอบรายละเอียดในข้อความส่วนตัว',
  )
  const [bankAccountId, setBankAccountId] = useState(
    initialRule?.live_bank_account_id ?? bankAccounts[0]?.id ?? '',
  )
  const [testText, setTestText] = useState('')
  const [active, setActive] = useState(initialRule?.is_active ?? false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(setupError)
  const privateTextareaRef = useRef<HTMLTextAreaElement>(null)

  const product = productOptions.find((item) => item.id === productId)
  const customerSelectVariant = !!product?.variants.length
  const selectedStock = product?.stock ?? 0
  const selectedPrice = product?.price ?? 0
  const previewCodes = useMemo(() => previewLiveCfCodes(codes, codeDraft), [codes, codeDraft])
  const matchedCode = matchLiveCfCode(testText, previewCodes, matchMode)
  const examples = useMemo(
    () => liveCfCodeExamples(previewCodes, matchMode),
    [previewCodes, matchMode],
  )
  const selectedBank = bankAccounts.find((item) => item.id === bankAccountId)

  function selectProduct(next: LiveProductOption | undefined, useEnteredProductCode = false) {
    setProductId(next?.id ?? '')
    setStockLimit(Math.max(1, Math.min(next?.stock ?? 1, 5)))
    setCodes(useEnteredProductCode && next?.code ? [next.code] : [])
    setCodeDraft('')
    setCodeError(null)
    setTestText('')
    // เติมข้อความเริ่มต้น (Default Template) ที่มีข้อมูลของสินค้านั้นให้อัตโนมัติทันที
    if (next) {
      setPrivateText(
        generateDefaultPrivateText(next.name, next.price, null, !!next.variants.length),
      )
    }
  }

  function chooseProduct(nextId: string) {
    selectProduct(productOptions.find((item) => item.id === nextId))
  }

  function onProductCreated(next: LiveProductOption) {
    setCreatedProducts((current) => [...current, next])
    selectProduct(next, true)
    setShowProductModal(false)
    setNotice(
      next.is_active === false
        ? `บันทึกสินค้าแล้ว: ${next.name} ยังไม่เปิดขาย กรุณาเปิดขายที่หน้าร้านค้าก่อนเริ่มรับออเดอร์`
        : `เพิ่มสินค้าแล้ว: ${next.name} พร้อมใช้ในไลฟ์นี้`,
    )
  }

  function addCode() {
    try {
      setCodes(addLiveCfCode(codes, codeDraft))
      setCodeDraft('')
      setCodeError(null)
      codeInputRef.current?.focus()
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : 'เพิ่มรหัสไม่สำเร็จ')
    }
  }

  function codesForSave() {
    try {
      // Include a typed pending tag so saving never silently discards the last code.
      const next = codeDraft.trim() ? addLiveCfCode(codes, codeDraft) : parseLiveCfCodes(codes)
      setCodes(next)
      setCodeDraft('')
      setCodeError(null)
      return next
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : 'กรุณาตรวจสอบรหัสสั่งซื้อ')
      codeInputRef.current?.focus()
      return null
    }
  }

  function insertVariable(tag: string) {
    const textarea = privateTextareaRef.current
    if (!textarea) {
      setPrivateText((prev) => (prev ? `${prev} ${tag}` : tag))
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = privateText
    const nextText = text.substring(0, start) + tag + text.substring(end)
    setPrivateText(nextText)
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + tag.length, start + tag.length)
    }, 0)
  }

  const previewMessage = useMemo(() => {
    if (!product) return privateText
    const priceFormatted = Number(selectedPrice).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
    })
    const sampleLink = product.sales_page_url
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}${product.sales_page_url}`
      : 'https://snapbot.app/pay/live/sample.order123'
    return storedLiveReplyTemplate(privateText)
      .replaceAll('{product_name}', product.name)
      .replaceAll('{variant_name}', customerSelectVariant ? 'ลูกค้าเลือกในหน้าชำระเงิน' : 'มาตรฐาน')
      .replaceAll('{price}', priceFormatted)
      .replaceAll('{total}', priceFormatted)
      .replaceAll('{payment_link}', sampleLink)
  }, [privateText, product, selectedPrice, customerSelectVariant])

  async function save() {
    setNotice(null)
    setLiveLinkTouched(true)
    if (parsedLiveId === null) return
    const nextCodes = codesForSave()
    if (!nextCodes) return
    if (!pageId || !product || stockLimit < 1)
      return setNotice('กรุณาเลือกเพจ สินค้า และกรอกรหัสสั่งซื้อให้ครบ')
    if (product.is_active === false)
      return setNotice('สินค้านี้ยังไม่เปิดขาย กรุณาเปิดขายที่หน้าร้านค้าก่อนเริ่มรับออเดอร์')
    setSaving(true)
    try {
      const response = await fetch('/api/live-cf/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          tenantId,
          pageId,
          livePostId: parsedLiveId,
          productId,
          variantId: null,
          customerSelectVariant,
          codes: nextCodes,
          matchMode,
          stockLimit,
          deductStock,
          privateReply,
          publicReply,
          privateText: storedLiveReplyTemplate(privateText),
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
    if (!product) return setNotice('กรุณาเลือกสินค้าก่อนเปลี่ยนสถานะระบบ')
    if (nextActive && product?.is_active === false)
      return setNotice('สินค้านี้ยังไม่เปิดขาย กรุณาเปิดขายที่หน้าร้านค้าก่อนเริ่มรับออเดอร์')
    setLiveLinkTouched(true)
    if (parsedLiveId === null) return
    const nextCodes = codesForSave()
    if (!nextCodes) return
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
          livePostId: parsedLiveId,
          productId,
          variantId: null,
          customerSelectVariant,
          codes: nextCodes,
          matchMode,
          stockLimit,
          deductStock,
          privateReply,
          publicReply,
          privateText: storedLiveReplyTemplate(privateText),
          publicText,
          bankAccountId: bankAccountId || null,
          isActive: nextActive,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'เปลี่ยนสถานะไม่สำเร็จ')
      setActive(nextActive)
      setNotice(
        nextActive ? 'เปิดใช้งานระบบดูดออเดอร์แล้ว' : 'หยุดการทำงานระบบดูดออเดอร์ชั่วคราวแล้ว',
      )
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
              เลือกสินค้า ตั้งรหัสจอง และสร้างออเดอร์จากคอมเมนต์แบบเรียลไทม์
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
            notice.startsWith('บันทึกแล้ว') ||
            notice.startsWith('เปิดใช้งาน') ||
            notice.startsWith('เพิ่มสินค้าแล้ว')
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
          ลิงก์หรือรหัสไลฟ์สด Facebook
          <input
            aria-label="ลิงก์หรือรหัสไลฟ์สด Facebook"
            aria-invalid={liveLinkError}
            aria-describedby="live-link-help"
            className={field}
            value={livePostId}
            onChange={(event) => setLivePostId(event.target.value)}
            onPaste={(event) => {
              const extracted = extractFacebookLiveId(event.clipboardData.getData('text'))
              if (extracted) {
                event.preventDefault()
                setLivePostId(extracted)
                setLiveLinkTouched(true)
              }
            }}
            onBlur={() => {
              setLiveLinkTouched(true)
              if (parsedLiveId !== null) setLivePostId(parsedLiveId)
            }}
            placeholder="วางลิงก์ไลฟ์ Facebook หรือใส่รหัส เช่น 123456789"
          />
          <span
            id="live-link-help"
            className={`mt-1.5 flex items-center gap-1.5 text-xs font-normal ${liveLinkError ? 'text-red-600' : 'text-slate-500'}`}
          >
            <Link2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {liveLinkError
              ? 'อ่านรหัสจากลิงก์นี้ไม่ได้ กรุณาคัดลอกลิงก์วิดีโอแบบเต็มจาก Facebook'
              : 'วางลิงก์แล้วระบบจะดึงรหัสให้อัตโนมัติ เว้นว่างเพื่อรับทุกไลฟ์ของเพจ'}
          </span>
        </label>
      </section>

      {/* Responsive Layout 2 คอลัมน์บน Desktop */}
      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* ฝั่งซ้าย: 3 สเต็ปตั้งค่า */}
        <section
          className={`${card} divide-y divide-slate-100 overflow-hidden lg:col-span-7 xl:col-span-8`}
        >
          {/* สเต็ป 1: เลือกสินค้า */}
          <div className="space-y-4 p-5 md:p-6">
            <StepTitle number={1}>เลือกสินค้าจากร้านค้า / เซลเพจ</StepTitle>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1 text-sm font-semibold text-slate-800">
                สินค้าในร้าน
                <div className="relative">
                  <select
                    aria-label="สินค้าจากร้านค้า / เซลเพจ"
                    className={`${field} appearance-none pr-10`}
                    value={productId}
                    onChange={(event) => chooseProduct(event.target.value)}
                  >
                    <option value="">เลือกสินค้า</option>
                    {productOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} • ฿{Number(item.price).toLocaleString('th-TH')} • คงเหลือ{' '}
                        {item.stock} ชิ้น
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-5 right-3 h-4 w-4 text-slate-400" />
                </div>
              </label>
              <button
                type="button"
                onClick={() => setShowProductModal(true)}
                className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-orange-500"
              >
                <Plus className="h-4 w-4" /> เพิ่มสินค้าใหม่เข้าเซลล์เพจ
              </button>
            </div>
            {!productOptions.length && (
              <p className="rounded-xl bg-amber-50 p-3.5 text-xs text-amber-800 ring-1 ring-amber-200">
                ยังไม่มีสินค้า กด “เพิ่มสินค้าใหม่เข้าเซลล์เพจ” ด้านบน หรือจัดการสินค้าที่หน้า{' '}
                <Link
                  href="/shop"
                  className="font-semibold text-orange-600 underline hover:text-orange-700"
                >
                  ร้านค้า / เซลเพจ
                </Link>{' '}
              </p>
            )}
            {product && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex items-start gap-4">
                  <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- tenant-owned dynamic product URL
                      <img src={product.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-7 w-7 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-semibold text-slate-900">{product.name}</p>
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        คงเหลือ {selectedStock} ชิ้น
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm font-semibold text-orange-600">
                      ฿{Number(selectedPrice).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </p>
                    {product.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                        {product.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* ลิงก์เซลเพจของสินค้านี้ */}
                {product.sales_page_url && (
                  <div className="flex items-center justify-between border-t border-slate-200/70 pt-2.5 text-xs text-slate-600">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" /> หน้าร้านค้า /
                      เซลเพจที่เชื่อมต่อ:
                    </span>
                    <a
                      href={product.sales_page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      เปิดดูหน้าเซลเพจ <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>
            )}
            {!!product?.variants.length && (
              <div className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
                สินค้ามี {product.variants.length} รูปแบบ
                ลูกค้าใช้รหัสจองหลักแล้วเลือกสีหรือขนาดในหน้าชำระเงิน
              </div>
            )}
          </div>

          {/* สเต็ป 2: กำหนดคีย์เวิร์ด */}
          <div className="space-y-4 p-5 md:p-6">
            <StepTitle number={2}>กำหนดคีย์เวิร์ดดูดออเดอร์ (Keywords)</StepTitle>

            {/* โหมดการตรวจจับรหัส (Match Mode) */}
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-slate-800">
                รูปแบบการพิมพ์จองของลูกค้า
              </span>
              <div className="grid gap-3 xl:grid-cols-2">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                    matchMode === 'flexible'
                      ? 'border-orange-500 bg-orange-50/60 ring-2 ring-orange-500/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="matchMode"
                    value="flexible"
                    checked={matchMode === 'flexible'}
                    onChange={() => setMatchMode('flexible')}
                    className="mt-1 h-4 w-4 accent-orange-500"
                  />
                  <div>
                    <span className="block text-sm font-semibold text-slate-900">
                      {'ตรวจจับข้อความที่มีคีย์เวิร์ด (Contains) - '}
                      <span className="ml-1.5 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                        แนะนำ
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                      ลูกค้าพิมพ์คีย์เวิร์ดรวมกับข้อความอื่น ระบบก็ดึงออเดอร์ให้อัตโนมัติ
                    </span>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                    matchMode === 'strict'
                      ? 'border-orange-500 bg-orange-50/60 ring-2 ring-orange-500/20'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="matchMode"
                    value="strict"
                    checked={matchMode === 'strict'}
                    onChange={() => setMatchMode('strict')}
                    className="mt-1 h-4 w-4 accent-orange-500"
                  />
                  <div>
                    <span className="block text-sm font-semibold text-slate-900">
                      ตรงตามคีย์เวิร์ดทุกตัวอักษร (Exact Match)
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                      ข้อความต้องตรงกับคีย์เวิร์ดที่ตั้งไว้เท่านั้น ห้ามมีคำอื่นปะปน
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <label
                  htmlFor="live-cf-code-draft"
                  className="text-sm font-semibold leading-relaxed text-slate-800"
                >
                  คีย์เวิร์ดสำหรับสั่งซื้อ (เพิ่มได้ 1 - 5 คำ)
                </label>
                <span
                  aria-label="จำนวนรหัสที่เพิ่มแล้ว"
                  className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-orange-700 ring-1 ring-orange-200"
                >
                  {codes.length}/{MAX_LIVE_CF_CODES}
                </span>
              </div>
              <div
                role="group"
                aria-label="รหัสสั่งซื้อที่เพิ่มแล้ว"
                className="flex min-h-14 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 transition focus-within:border-orange-400 focus-within:ring-3 focus-within:ring-orange-100"
              >
                {codes.map((code, index) => (
                  <span
                    key={`${code}-${index}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 py-1 pl-3 pr-1 text-sm font-bold text-orange-700"
                  >
                    <span className="min-w-0 break-all">{code}</span>
                    <button
                      type="button"
                      aria-label={`ลบรหัส ${code}`}
                      disabled={saving}
                      onClick={() => {
                        setCodes((current) => current.filter((_, position) => position !== index))
                        setCodeError(null)
                      }}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-orange-500 transition hover:bg-orange-100 hover:text-orange-800 focus-visible:outline-2 focus-visible:outline-orange-500 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
                <input
                  id="live-cf-code-draft"
                  ref={codeInputRef}
                  aria-label="เพิ่มรหัสสั่งซื้อ"
                  aria-describedby="live-cf-code-help live-cf-code-status"
                  aria-invalid={!!codeError}
                  disabled={saving || codes.length >= MAX_LIVE_CF_CODES}
                  className="min-w-0 flex-[1_1_9rem] rounded-lg bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                  value={codeDraft}
                  maxLength={40}
                  onChange={(event) => {
                    setCodeDraft(event.target.value)
                    setCodeError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      addCode()
                    }
                  }}
                  placeholder={
                    codes.length >= MAX_LIVE_CF_CODES ? 'ครบ 5 รหัสแล้ว' : 'พิมพ์รหัส แล้วกด Enter'
                  }
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p id="live-cf-code-help" className="text-xs leading-relaxed text-slate-500">
                  ตัวพิมพ์เล็กและใหญ่ใช้แทนกันได้ จึงไม่ต้องเพิ่มรหัสซ้ำ เช่น A1 กับ a1
                </p>
                <button
                  type="button"
                  disabled={saving || codes.length >= MAX_LIVE_CF_CODES || !codeDraft.trim()}
                  onClick={addCode}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  เพิ่มรหัส
                </button>
              </div>
              <div id="live-cf-code-status" aria-live="polite">
                {codeError && (
                  <p role="alert" className="text-sm font-medium text-red-600">
                    {codeError}
                  </p>
                )}
                {codes.length >= MAX_LIVE_CF_CODES && (
                  <p className="text-xs font-medium text-amber-700">เพิ่มได้สูงสุด 5 รหัส</p>
                )}
                {!codes.length && !codeError && (
                  <p className="text-xs font-medium text-amber-700">
                    กรุณาเพิ่มรหัสสั่งซื้ออย่างน้อย 1 รหัส
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="mb-2 text-sm font-semibold text-slate-800">
                ตัวอย่างข้อความที่ลูกค้าพิมพ์
              </p>
              {!!examples.length && (
                <p className="mb-3 text-xs text-slate-500">
                  ตัวอย่างอัปเดตตามรหัสที่พิมพ์ กดเพื่อทดลองจับคู่ได้ทันที
                </p>
              )}
              <div aria-label="ตัวอย่างคำสั่งซื้อ" className="flex flex-wrap gap-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setTestText(example)}
                    className="max-w-full break-all rounded-full border border-orange-200 bg-white px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-orange-500"
                  >
                    {example}
                  </button>
                ))}
                {!examples.length && (
                  <span className="text-xs text-slate-500">กรุณากรอกรหัสสินค้าเพื่อดูตัวอย่าง</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <span className="text-sm font-semibold text-slate-800">
                จำนวนที่เปิดให้จองในไลฟ์นี้:
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
                  onChange={(event) => setStockLimit(Math.max(1, Number(event.target.value) || 1))}
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
                <b className="font-semibold text-slate-900">ตัดสต็อกหน้าร้านทันทีเมื่อจองสำเร็จ</b>
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
              <div className="flex items-start gap-3">
                <Toggle checked={privateReply} onChange={setPrivateReply} label="ส่งแชทส่วนตัว" />
                <span className="font-semibold text-slate-900">
                  ส่งสรุปยอดและลิงก์ชำระเงินเข้ากล่องข้อความ Facebook
                </span>
              </div>
              {privateReply && (
                <div className="space-y-3">
                  <div className="relative">
                    <textarea
                      ref={privateTextareaRef}
                      aria-label="ข้อความส่งแชทส่วนตัว"
                      className={`${field} min-h-[110px] resize-y font-sans`}
                      rows={4}
                      value={privateText}
                      onChange={(event) => setPrivateText(event.target.value)}
                    />
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                      <span>กดปุ่มด้านล่างเพื่อใส่ข้อมูลสินค้าในข้อความ</span>
                      {product && (
                        <button
                          type="button"
                          onClick={() =>
                            setPrivateText(
                              generateDefaultPrivateText(
                                product.name,
                                product.price,
                                null,
                                customerSelectVariant,
                              ),
                            )
                          }
                          className="inline-flex items-center gap-1 font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> ใช้ข้อความเริ่มต้นของสินค้านี้
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ปุ่มแทรกตัวแปรอัตโนมัติ (Chip Buttons) */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <p className="mb-2 text-xs font-semibold text-slate-700">
                      เลือกข้อมูลที่จะใส่ในข้อความ ระบบจะเติมข้อมูลจริงเมื่อลูกค้าจอง:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {VARIABLE_CHIPS.map((chip) => (
                        <button
                          key={chip.tag}
                          type="button"
                          onClick={() => insertVariable(displayLiveReplyTemplate(chip.tag))}
                          className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-white px-2.5 py-1 text-xs font-semibold text-orange-700 shadow-2xs transition hover:bg-orange-50 active:scale-95"
                          title={`ใส่${chip.label}ในข้อความ`}
                        >
                          <span className="font-mono font-bold text-orange-600">+</span>
                          <span>{chip.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* กล่อง Live Preview จำลองข้อความจริง */}
                  {product && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                          <Eye className="h-3.5 w-3.5 text-orange-500" />{' '}
                          ตัวอย่างข้อความที่ลูกค้าจะได้รับทาง Facebook
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          ตัวอย่าง
                        </span>
                      </div>
                      <div className="mt-2.5 whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-800">
                        {previewMessage}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 pt-1 sm:grid-cols-2">
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
                      ระบบจะส่งสรุปยอดและลิงก์ชำระเงินที่ปลอดภัยเข้ากล่องข้อความ Facebook
                      ของลูกค้าโดยอัตโนมัติ
                    </div>
                  </div>
                </div>
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
                      <img src={product.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-6 w-6 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold text-slate-900">{product.name}</p>
                    {customerSelectVariant && (
                      <p className="text-xs text-slate-500">ลูกค้าเลือกสีหรือขนาดก่อนชำระเงิน</p>
                    )}
                    <p className="mt-1 text-lg font-bold text-orange-600">
                      ฿
                      {Number(selectedPrice).toLocaleString('th-TH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <span className="text-xs font-semibold text-emerald-600">
                      คงเหลือ {selectedStock} ชิ้น
                    </span>
                  </div>
                </div>
                <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-200 text-sm">
                  {[
                    ['คีย์เวิร์ดคำสั่งซื้อ', previewCodes.join(', ') || '—'],
                    ['สต็อกคงเหลือ', `${selectedStock} ชิ้น`],
                    [
                      'รูปแบบการตรวจจับ',
                      matchMode === 'strict'
                        ? 'ตรงตามคีย์เวิร์ด (Exact Match)'
                        : 'ตรวจจับที่มีคีย์เวิร์ด (Contains)',
                    ],
                    ['เปิดจอง', `${stockLimit} ชิ้น`],
                    ['ตัดสต็อกอัตโนมัติ', deductStock ? 'เปิด' : 'ปิด'],
                    ['ส่งแชทส่วนตัว', privateReply ? 'เปิด' : 'ปิด'],
                    ['ตอบใต้คอมเมนต์', publicReply ? 'เปิด' : 'ปิด'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 py-2.5">
                      <dt className="shrink-0 text-slate-500">{label}</dt>
                      <dd
                        className={`min-w-0 break-words text-right font-semibold ${value === 'เปิด' ? 'text-emerald-600' : 'text-slate-900'}`}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {selectedBank && (
                  <p className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-600">
                    บัญชีรับเงิน: <b className="text-slate-800">{selectedBank.bank_code}</b> ••••
                    {selectedBank.account_number.slice(-4)}
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">
                <FlaskConical className="h-5 w-5 text-orange-500" /> ทดลองพิมพ์คอมเมนต์
              </h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  matchMode === 'strict'
                    ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                    : 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'
                }`}
              >
                โหมด: {matchMode === 'strict' ? 'Exact Match' : 'Contains'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {matchMode === 'strict'
                ? 'ข้อความต้องตรงกับคีย์เวิร์ดที่ตั้งไว้เท่านั้น ห้ามมีคำอื่นปะปน'
                : 'มีคีย์เวิร์ดอยู่ส่วนใดของข้อความก็ตรวจจับได้ ไม่แยกตัวพิมพ์เล็กหรือใหญ่ และรองรับช่องว่างระหว่างตัวอักษรกับตัวเลข'}
            </p>
            <input
              aria-label="ทดลองพิมพ์คอมเมนต์"
              className={`${field} mt-4`}
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              placeholder={
                matchMode === 'strict'
                  ? `พิมพ์ ${previewCodes[0] || 'รหัสจอง'}`
                  : `ลองพิมพ์ รับ ${previewCodes[0] || 'รหัสจอง'}`
              }
            />
            <div
              className={`mt-3 flex items-center gap-2.5 rounded-xl border p-3 text-sm font-medium transition ${
                matchedCode
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-slate-100 text-slate-600'
              }`}
            >
              {matchedCode ? (
                <>
                  <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1 break-words">
                    ตรงรหัส <b>{matchedCode}</b> ระบบพร้อมสร้างออเดอร์
                  </span>
                  <ShoppingCart className="h-4 w-4 shrink-0 text-emerald-600" />
                </>
              ) : (
                <>
                  <CircleStop className="h-5 w-5 shrink-0 text-slate-400" />
                  <span className="flex-1">
                    ไม่สร้างออเดอร์ — ข้อความไม่ตรงกับรหัสจองที่ตั้งไว้
                  </span>
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
            {!id ? 'สถานะ: ยังไม่เริ่มทำงาน' : active ? 'สถานะ: กำลังทำงาน' : 'สถานะ: หยุดชั่วคราว'}
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
            disabled={saving || !productOptions.length || !pages.length}
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
            {saving ? 'กำลังบันทึก...' : active ? 'บันทึกการตั้งค่า' : 'เริ่มเปิดระบบดูดออเดอร์'}
          </button>
        </div>
      </div>
      {showProductModal && (
        <QuickProductModal
          tenantId={tenantId}
          salesPageUrl={salesPageUrl ?? product?.sales_page_url ?? null}
          onCreated={onProductCreated}
          onDismiss={() => setShowProductModal(false)}
        />
      )}
    </div>
  )
}
