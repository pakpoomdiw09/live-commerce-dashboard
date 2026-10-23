'use client'
import { useEffect, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import jsQR from 'jsqr'
import NextImage from 'next/image'
import { LoadingSpinner } from '@/components/ui/feedback'
import { Skeleton } from '@/components/ui/skeleton'
import { BankAccountsManager } from '@/components/settings/BankAccountsManager'
import { ReceivingCodeManager } from '@/components/slips/ReceivingCodeManager'
import { defaultQrDesign, qrTemplates, type QrDesign } from '@/lib/features/payments/qr-design'
import type { BankAccount } from '@/lib/features/banking/bank-accounts'
import { findBank } from '@/lib/features/banking/banks'
type Saved = {
  design: QrDesign
  version: number
  payload: string
  amount_satang: number | null
  original_path: string | null
  logo_path: string | null
}
const input = 'w-full min-w-0 rounded-xl border border-orange-200 bg-white p-2 text-sm'
export function BankQrWorkspace({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const [account, setAccount] = useState<BankAccount | null>(null),
    [saved, setSaved] = useState<Saved | null>(null),
    [design, setDesign] = useState<QrDesign>(defaultQrDesign)
  const [original, setOriginal] = useState<File | null>(null),
    [logo, setLogo] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [logoPreview, setLogoPreview] = useState('')
  const [amount, setAmount] = useState(''),
    [regenerate, setRegenerate] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState('')
  const lock = useRef(false),
    qr = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null)
  const endpoint = `/api/payment-designs?tenantId=${encodeURIComponent(tenantId)}&accountId=${account?.id ?? ''}`
  const payload = saved?.payload ?? account?.qrPayload
  useEffect(() => {
    if (!original) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(original)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [original])
  useEffect(() => {
    if (!logo) {
      setLogoPreview('')
      return
    }
    const url = URL.createObjectURL(logo)
    setLogoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [logo])
  useEffect(() => {
    if (!dirty) return
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const navigate = (e: MouseEvent) => {
      if (
        (e.target as Element).closest('a[href]') &&
        !confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการออกจากหน้านี้หรือไม่?')
      ) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', navigate, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', navigate, true)
    }
  }, [dirty])
  useEffect(() => {
    if (!account) return
    const abort = new AbortController()
    setLoading(true)
    setSaved(null)
    setMessage('')
    setOriginal(null)
    setLogo(null)
    setDirty(false)
    setRegenerate(false)
    fetch(endpoint, { signal: abort.signal, cache: 'no-store' })
      .then(async (r) => {
        const v = await r.json()
        if (!r.ok) throw Error(v.error ?? 'โหลดแบบไม่ได้')
        if (abort.signal.aborted) return
        setSaved(v.design)
        setDesign(v.design?.design ?? defaultQrDesign)
        setAmount(v.design?.amount_satang ? String(v.design.amount_satang / 100) : '')
        if (v.stale) {
          setRegenerate(true)
          setMessage('บัญชีเปลี่ยนแล้ว กรุณาสร้าง QR ใหม่')
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setMessage(e.message)
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [account, endpoint])
  useEffect(() => {
    let cancelled = false
    async function draw() {
      const target = canvas.current,
        source = qr.current?.querySelector('canvas')
      if (!target || !source || !payload) return
      const ctx = target.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = design.background
      ctx.fillRect(0, 0, 600, 820)
      ctx.fillStyle = design.frame
      ctx.fillRect(20, 20, 560, 780)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(30, 30, 540, 760)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 24px sans-serif'
      ctx.fillText(design.shop || account?.account_name || '', 300, 90, 480)
      ctx.font = '18px sans-serif'
      ctx.fillText(findBank(account?.bank_code ?? '')?.name ?? '', 300, 125, 480)
      // QR includes four untouched white modules. Branding is outside this rectangle.
      ctx.drawImage(source, 80, 180, 440, 440)
      ctx.fillText(
        saved?.amount_satang
          ? `${(saved.amount_satang / 100).toLocaleString('th-TH')} บาท`
          : 'ไม่ระบุยอดเงิน',
        300,
        660,
        480,
      )
      ctx.fillText(design.caption, 300, 705, 480)
      const url =
        logoPreview || (saved?.logo_path ? `${endpoint}&asset=logo&v=${saved.version}` : '')
      if (url) {
        const image = new Image()
        image.src = url
        try {
          await image.decode()
          if (!cancelled) ctx.drawImage(image, 270, 730, 60, 45)
        } catch {
          if (!cancelled) setMessage('โหลดโลโก้ไม่ได้ กรุณาตรวจรูปแล้วลองใหม่')
        }
      }
    }
    void draw()
    return () => {
      cancelled = true
    }
  }, [design, payload, logoPreview, saved, endpoint, account])
  function choose(a: BankAccount) {
    if (dirty && !confirm('ละทิ้งการตกแต่งที่ยังไม่บันทึกหรือไม่?')) return
    setAccount(a)
  }
  function edit(next: QrDesign) {
    setDesign(next)
    setDirty(true)
  }
  async function save() {
    if (lock.current || !account || loading) return
    if (!confirm('ยืนยันข้อมูลบัญชีและ QR รับเงินนี้?')) return
    lock.current = true
    setBusy(true)
    setMessage('กำลังอัปโหลดและบันทึก…')
    try {
      const form = new FormData()
      form.set('accountId', account.id)
      form.set('version', String(saved?.version ?? 0))
      form.set('confirmed', 'true')
      form.set('design', JSON.stringify(design))
      form.set('amount', amount)
      form.set('regenerate', String(regenerate))
      if (original) form.set('original', original)
      if (logo) form.set('logo', logo)
      const r = await fetch(endpoint, { method: 'POST', body: form }),
        v = await r.json()
      if (!r.ok) throw Error(v.error ?? 'บันทึกไม่ได้')
      const reload = await fetch(endpoint, { cache: 'no-store' }),
        data = await reload.json()
      if (!reload.ok) throw Error('บันทึกแล้วแต่โหลดผลไม่ได้ กรุณาโหลดหน้าใหม่')
      setSaved(data.design)
      setOriginal(null)
      setLogo(null)
      setDirty(false)
      setRegenerate(false)
      setMessage('บันทึกรูปและการตกแต่งแล้ว')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'บันทึกไม่ได้')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function download() {
    if (!canvas.current || dirty || busy) return
    try {
      const r = await fetch(endpoint, { cache: 'no-store' }),
        v = await r.json()
      if (!r.ok || !v.design || v.design.version !== saved?.version || v.design.payload !== payload)
        throw Error('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่')
      const ctx = canvas.current.getContext('2d')!,
        pixels = ctx.getImageData(0, 0, 600, 820)
      if (jsQR(pixels.data, 600, 820)?.data !== payload)
        throw Error('ภาพส่งออกอ่าน QR ไม่ได้ กรุณาตรวจรูปแบบ')
      const a = document.createElement('a')
      a.download = 'snapbot-payment-qr.png'
      a.href = canvas.current.toDataURL('image/png')
      a.click()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'ดาวน์โหลดไม่ได้')
    }
  }
  function upload(file: File | undefined, kind: 'original' | 'logo') {
    if (!file) return
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setMessage('รองรับ PNG/JPG/WebP ไม่เกิน 5 MB')
      return
    }
    if (kind === 'original') setOriginal(file)
    else setLogo(file)
    setDirty(true)
  }
  return (
    <>
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]">
        <BankAccountsManager
          tenantId={tenantId}
          canManage={canManage}
          onSelectQr={canManage ? choose : undefined}
        />
        {canManage && (
          <aside
            className="min-w-0 space-y-4 rounded-3xl border border-orange-100 bg-white p-5 shadow-sm"
            aria-label="ตกแต่ง QR รับเงิน"
          >
            <h3 className="text-lg font-bold">ตกแต่ง QR รับเงิน</h3>
            {!account ? (
              <p className="text-sm text-slate-500">
                เลือก “ตกแต่ง QR” ที่บัญชีพร้อมเพย์เพื่อเริ่มต้น
              </p>
            ) : (
              <fieldset disabled={busy || loading} className="min-w-0 space-y-3">
                <legend className="mb-3 text-sm">{account.account_name}</legend>
                {loading && (
                  <>
                    <LoadingSpinner label="กำลังโหลดแบบ…" />
                    <Skeleton className="h-64 w-full" />
                  </>
                )}
                <div ref={qr} className="hidden">
                  {payload && <QRCodeCanvas value={payload} size={440} marginSize={4} level="M" />}
                </div>
                {payload && (
                  <canvas
                    ref={canvas}
                    width={600}
                    height={820}
                    className="h-auto w-full rounded-xl border"
                    aria-label="ตัวอย่าง QR ตกแต่ง"
                  />
                )}
                {preview && (
                  <NextImage
                    unoptimized
                    width={400}
                    height={400}
                    src={preview}
                    alt="รูป QR ที่เลือก รอยืนยันก่อนบันทึก"
                    className="max-h-64 max-w-full object-contain"
                  />
                )}
                {saved?.original_path && (
                  <a
                    className="block text-sm text-orange-700 underline"
                    href={`${endpoint}&asset=original`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ดูรูป QR ต้นฉบับที่บันทึก
                  </a>
                )}
                <label className="block text-sm">
                  รูป QR ต้นฉบับ (PNG/JPG/WebP ≤ 5 MB)
                  <input
                    className="peer sr-only"
                    type="file"
                    lang="th"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => upload(e.target.files?.[0], 'original')}
                  />
                  <span className="mt-1 block cursor-pointer break-all rounded-xl border border-orange-200 p-2 peer-focus-visible:outline-2">
                    {original?.name ?? 'เลือกรูป QR จากอุปกรณ์'}
                  </span>
                </label>
                <label className="block text-sm">
                  แม่แบบ
                  <select
                    className={input}
                    defaultValue=""
                    onChange={(e) => {
                      const t = qrTemplates[Number(e.target.value)]
                      if (t) edit({ ...design, background: t.background, frame: t.frame })
                    }}
                  >
                    <option value="" disabled>
                      เลือกแม่แบบ
                    </option>
                    {qrTemplates.map((t, i) => (
                      <option key={t.name} value={i}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-4">
                  {(['background', 'frame'] as const).map((key) => (
                    <label key={key} className="text-sm">
                      {key === 'background' ? 'สีพื้นหลัง' : 'สีกรอบ'}
                      <input
                        aria-label={key === 'background' ? 'สีพื้นหลัง' : 'สีกรอบ'}
                        type="color"
                        value={design[key]}
                        onChange={(e) => edit({ ...design, [key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
                <label className="block text-sm">
                  ชื่อร้าน
                  <input
                    className={input}
                    maxLength={80}
                    placeholder="ตัวอย่าง: ร้านสุขใจ (ไม่ใช่ข้อมูลจริง)"
                    value={design.shop}
                    onChange={(e) => edit({ ...design, shop: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  ข้อความใต้ QR
                  <input
                    className={input}
                    maxLength={120}
                    value={design.caption}
                    onChange={(e) => edit({ ...design, caption: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  โลโก้ร้าน (อยู่นอก QR)
                  <input
                    className={input}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => upload(e.target.files?.[0], 'logo')}
                  />
                  <span className="mt-1 block cursor-pointer break-all rounded-xl border border-orange-200 p-2 peer-focus-visible:outline-2">
                    {logo?.name ?? 'เลือกรูปโลโก้จากอุปกรณ์'}
                  </span>
                </label>
                <label className="block text-sm">
                  ยอดสำหรับสร้าง QR ใหม่ (เว้นว่าง = ไม่ระบุยอด)
                  <input
                    className={input}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value)
                      setRegenerate(true)
                      setOriginal(null)
                      setDirty(true)
                    }}
                  />
                </label>
                <p className="text-xs text-slate-500">
                  การเปลี่ยนยอดจะสร้าง QR ใหม่หลังบันทึก รูปนำเข้าจะใช้ยอดตามข้อมูลในรูป
                  ตัวอย่างด้านบนแสดง QR ที่บันทึกแล้ว
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-xl border p-2 text-sm"
                    onClick={() => edit(defaultQrDesign)}
                  >
                    คืนค่าแบบเริ่มต้น
                  </button>
                  <button
                    className="rounded-xl bg-orange-500 p-2 text-sm text-white disabled:opacity-50"
                    disabled={!dirty && !!saved && !regenerate}
                    onClick={() => void save()}
                  >
                    บันทึกการตกแต่ง
                  </button>
                  <button
                    className="rounded-xl border p-2 text-sm disabled:opacity-50"
                    disabled={!saved || dirty}
                    onClick={() => void download()}
                  >
                    ดาวน์โหลด PNG
                  </button>
                </div>
                {dirty && <p className="text-xs text-amber-700">มีการแก้ไขที่ยังไม่บันทึก</p>}
              </fieldset>
            )}
            {busy && <LoadingSpinner label="กำลังอัปโหลดและบันทึก…" />}
            {message && (
              <p role="status" className="break-words text-sm text-orange-800">
                {message}
              </p>
            )}
            <p className="text-xs text-slate-500">
              รองรับพร้อมเพย์ที่ตรงกับบัญชีร้านเท่านั้น QR ธนาคารรูปแบบอื่นและบาร์โค้ด:
              ยังไม่เชื่อมต่อ การสร้าง QR ไม่ยืนยันการรับเงินจริง
            </p>
          </aside>
        )}
      </div>
      {canManage && (
        <details className="rounded-2xl border border-orange-100 bg-white p-4">
          <summary className="cursor-pointer font-medium">QR เพิ่มเติมและ QR ตามออเดอร์</summary>
          <div className="mt-4">
            <ReceivingCodeManager tenantId={tenantId} />
          </div>
        </details>
      )}
    </>
  )
}
