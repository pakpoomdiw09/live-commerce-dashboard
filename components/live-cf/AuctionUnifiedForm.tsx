'use client'

import {
  Gavel,
  Package,
  Truck,
  Coins,
  Megaphone,
  MessageSquareText,
  Bot,
  Landmark,
} from 'lucide-react'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Auction } from '@/lib/features/commerce/auction-types'
import type { LiveSession, SessionSnapshot } from '@/lib/features/commerce/live-session-types'
import {
  inputMoney,
  sessionMoney,
  sessionProfit,
  sumMoney,
} from '@/lib/features/commerce/live-session-types'
import {
  displaySessionTemplate,
  normalizeBidKeyword,
  normalizeCloseKeyword,
  type SessionAutomation,
} from '@/lib/features/commerce/session-automation'
import { LiveSourcePicker } from './LiveSourcePicker'
import { LiveSwitch, LiveTemplateEditor } from './LiveReplyControls'
import { AuctionKeywordEditor } from './AuctionKeywordEditor'
import type { AuctionDashboardOptions } from './AuctionSessionStart'
import { field, orange, read } from './session-ui'
import { LiveAuctionTimer } from './LiveAuctionTimer'

type Config = {
  session: LiveSession | null
  round: Auction | null
  settings: SessionAutomation | null
  preferencesOnly: boolean
}
type Draft = {
  pageId: string
  livePostId: string
  itemName: string
  startPrice: string
  minStep: string
  shippingFee: string
  durationMinutes: string
  settings: SessionAutomation
  finance: { cost: string; ads: string; shipping: string; fees: string }
}
const blankSessionAutomation = (bankAccountId = ''): SessionAutomation => ({
  keywords: [],
  closeKeywords: [],
  publicReply: false,
  privateReply: false,
  auto_accumulate_summary: true,
  bidText: '',
  privateText: '',
  closeText: '',
  bankAccountId,
  countEnabled: false,
  closeEnabled: false,
  heartCloses: false,
})
const variables = [
  { tag: '{ชื่อลูกค้า}', label: 'ชื่อลูกค้า' },
  { tag: '{รายการ}', label: 'รายการ' },
  { tag: '{ราคา}', label: 'ราคา' },
  { tag: '{ยอดรวมสะสม}', label: 'ยอดรวมสะสม' },
  { tag: '{เลขบัญชี}', label: 'เลขบัญชี' },
]

export function AuctionUnifiedForm({
  tenantId,
  sessionId,
  data,
  options,
  onSaved,
}: {
  tenantId: string
  sessionId: string
  data: SessionSnapshot | null
  options: AuctionDashboardOptions
  onSaved: (sessionId: string) => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [base, setBase] = useState<Config | null>(null)
  const [source, setSource] = useState<{ pageId: string; livePostId: string } | null>(null)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const dirty = useRef(false)
  const savedCallback = useRef(onSaved)
  savedCallback.current = onSaved
  const request = useRef({ key: '', id: '' })

  const hydrate = useCallback(
    (config: Config, selected?: { pageId: string; livePostId: string } | null) => {
      const settings = config.settings ?? blankSessionAutomation()
      const session = config.session
      setBase(config)
      setDraft({
        pageId: selected?.pageId ?? session?.page_id ?? options.pages[0]?.id ?? '',
        livePostId: selected?.livePostId || session?.live_post_id || '',
        itemName: config.round?.item_name ?? '',
        startPrice: config.round ? String(config.round.start_price) : '',
        minStep: config.round ? String(config.round.min_step) : '',
        shippingFee: config.round ? String(config.round.shipping_fee) : '',
        durationMinutes: String((config.round?.duration_seconds ?? 300) / 60),
        settings: {
          ...settings,
          auto_accumulate_summary: settings.auto_accumulate_summary ?? true,
          bankAccountId: config.round?.bank_account_id ?? settings.bankAccountId,
          keywords: settings.keywords ?? [],
          closeKeywords: settings.closeKeywords ?? [],
          bidText: displaySessionTemplate(
            settings.closeKeywords ? settings.bidText : settings.closeText,
          ),
          privateText: displaySessionTemplate(settings.privateText),
        },
        finance: {
          cost: session ? String(session.cost_amount) : '0',
          ads: session ? String(session.ad_spent) : '0',
          shipping: session ? String(session.shipping_cost) : '0',
          fees: session?.other_fees == null ? '0' : String(session.other_fees),
        },
      })
      dirty.current = false
    },
    [options.pages],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ tenantId })
    if (source?.pageId) {
      params.set('pageId', source.pageId)
      if (source.livePostId) params.set('livePostId', source.livePostId)
    } else if (sessionId) params.set('sessionId', sessionId)
    void read(`/api/live-auction/workspace?${params}`, controller.signal)
      .then((config: Config) => {
        if (!controller.signal.aborted) {
          hydrate(config, source)
          if (config.session && config.session.id !== sessionId)
            savedCallback.current(config.session.id)
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'โหลดค่าที่บันทึกไว้ไม่สำเร็จ')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // Hydrate only on explicit selection/reload, never on the dashboard polling interval.
  }, [tenantId, sessionId, source, reload, hydrate])

  const liveActiveId = data?.activeAuction?.id
  const liveSessionId = data?.session.id
  const savedSessionId = base?.session?.id
  const savedActiveId = base?.round?.status === 'active' ? base.round.id : undefined
  useEffect(() => {
    if (
      liveSessionId &&
      savedSessionId === liveSessionId &&
      !dirty.current &&
      savedActiveId !== liveActiveId
    ) {
      setReload((n) => n + 1)
    }
  }, [liveActiveId, liveSessionId, savedSessionId, savedActiveId])

  function edit(patch: Partial<Draft>) {
    dirty.current = true
    setNotice('')
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous))
  }
  function setKeywords(kind: 'keywords' | 'closeKeywords', value: React.SetStateAction<string[]>) {
    dirty.current = true
    setDraft((previous) => {
      if (!previous) return previous
      const words = previous.settings[kind] ?? []
      return {
        ...previous,
        settings: {
          ...previous.settings,
          [kind]: typeof value === 'function' ? value(words) : value,
        },
      }
    })
  }
  async function handleSubmitAll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || loading || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    const input = {
      tenantId,
      pageId: draft.pageId,
      livePostId: draft.livePostId,
      sessionId: base?.session?.id ?? null,
      roundId: !base?.preferencesOnly && base?.round?.status === 'active' ? base.round.id : null,
      revision: base?.session?.automation_revision ?? 0,
      financialRevision: base?.session?.financial_revision ?? 0,
      itemName: draft.itemName,
      startPrice: draft.startPrice,
      minStep: draft.minStep,
      shippingFee: draft.shippingFee,
      durationSeconds: Number(draft.durationMinutes) * 60,
      settings: { ...draft.settings, closeText: draft.settings.bidText },
      finance: draft.finance,
    }
    const key = JSON.stringify(input)
    if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() }
    try {
      const response = await fetch('/api/live-auction/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, requestId: request.current.id }),
        signal: AbortSignal.timeout(45000),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'บันทึกไม่สำเร็จ')
      const config: Config = await read(
        `/api/live-auction/workspace?${new URLSearchParams({ tenantId, sessionId: result.sessionId })}`,
      )
      hydrate(config)
      setSource(null)
      request.current = { key: '', id: '' }
      setNotice('บันทึกครบแล้ว ระบบพร้อมรับบิดในไลฟ์ที่เลือก')
      onSaved(result.sessionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }
  const disabled = loading || busy || !!base?.session?.ended_at
  const locked =
    disabled ||
    (!base?.preferencesOnly && base?.round?.status === 'active' && !!base.round.leading_bidder_id)
  const sales =
    data && data.session.id === base?.session?.id
      ? (data.metrics.auctionSales ??
        sumMoney([
          ...data.rounds
            .filter((round) => round.status === 'closed' && !!round.orderId)
            .map((round) => round.price),
          ...(data.activeAuction?.currentPrice == null ? [] : [data.activeAuction.currentPrice]),
        ]))
      : 0
  const financialValues = draft
    ? {
        cost: draft.finance.cost === '' ? 0 : inputMoney(draft.finance.cost),
        ads: draft.finance.ads === '' ? 0 : inputMoney(draft.finance.ads),
        shipping: draft.finance.shipping === '' ? 0 : inputMoney(draft.finance.shipping),
        fees: draft.finance.fees === '' ? 0 : inputMoney(draft.finance.fees),
      }
    : null
  const profit =
    financialValues &&
    financialValues.cost !== null &&
    financialValues.ads !== null &&
    financialValues.shipping !== null &&
    financialValues.fees !== null
      ? sessionProfit(
          sales,
          financialValues.cost,
          financialValues.ads,
          financialValues.shipping,
          financialValues.fees,
        )
      : null
  const financeCards = [
    { key: 'cost', label: 'ต้นทุนสินค้า (บาท)', color: 'border-t-slate-400' },
    { key: 'ads', label: 'ค่าแอด / ยิงโฆษณา (บาท)', color: 'border-t-violet-500' },
    { key: 'shipping', label: 'ค่าจัดส่งจริง (บาท)', color: 'border-t-sky-500' },
    { key: 'fees', label: 'ค่าธรรมเนียม / อื่นๆ (บาท)', color: 'border-t-amber-500' },
  ] as const

  return (
    <form
      onSubmit={handleSubmitAll}
      data-auction-unified-form
      className="min-w-0 space-y-5 rounded-2xl bg-slate-50/60 p-3 text-slate-900 sm:p-5"
    >
      <header className="bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-2xl p-4 sm:p-5 shadow-sm mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="p-2.5 rounded-xl bg-white/20 text-white flex items-center justify-center"
            aria-hidden="true"
          >
            <Gavel className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-wide">
              ระบบประมูลไลฟ์สด (Live Auction)
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-orange-100">
              ตั้งค่าการประมูล เคาะราคา ดักคำปิดรอบ และระบบตอบกลับอัตโนมัติ
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-semibold shadow-sm w-fit">
          <span className="h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
          กำลังทำงาน
        </span>
      </header>
      {base?.round && !base.preferencesOnly && <LiveAuctionTimer
        key={base.round.id} tenantId={tenantId} auctionId={base.round.id}
        onResolved={() => { setReload((n) => n + 1); onSaved(base.session?.id ?? sessionId) }}
      />}
      {draft && <label className="block text-sm font-medium text-slate-700">
        ระยะเวลาประมูล (นาที)
        <input type="number" min="0.5" max="1440" step="0.5"
          className={field} value={draft.durationMinutes} disabled={disabled}
          onChange={(event) => { dirty.current = true; setDraft({ ...draft, durationMinutes: event.target.value }) }} />
        <span className="mt-1 block text-xs text-slate-500">นับจากเวลาเริ่มรอบ การบันทึกซ้ำไม่เริ่มเวลาใหม่</span>
      </label>}
      {loading && (
        <p
          role="status"
          className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500"
        >
          กำลังโหลดค่าที่บันทึกไว้…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      {draft && (
        <section data-auction-workspace className="min-w-0 space-y-5">
          <div>
            <div
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 w-full"
              data-auction-header-cards
            >
              {financeCards.slice(0, 3).map(({ label, key, color }) => (
                <label
                  key={key}
                  className={`min-w-0 rounded-xl border border-t-2 border-slate-200 ${color} bg-white p-2.5 text-xs font-medium text-slate-600 shadow-sm sm:text-sm ${key === 'cost' ? 'order-1' : key === 'shipping' ? 'order-3' : 'order-5'}`}
                >
                  <span className="flex min-h-10 items-start gap-2 leading-5">
                    {key === 'cost' ? (
                      <Package
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-blue-600"
                      />
                    ) : key === 'shipping' ? (
                      <Truck
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-violet-600"
                      />
                    ) : (
                      <Megaphone
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-sky-600"
                      />
                    )}
                    <span>{label}</span>
                  </span>
                  <span className="mt-1 flex min-w-0 items-center text-lg font-bold tabular-nums text-slate-900 sm:text-xl">
                    <span aria-hidden="true">฿</span>
                    <input
                      type="number"
                      min="0"
                      max="999999999999.99"
                      step="0.01"
                      aria-label={label}
                      className={`${field} !mt-0 !min-w-0 !rounded-md !border-transparent !bg-transparent !px-1 !py-1 !text-lg !font-bold !text-slate-900 focus:!border-orange-300 focus:!bg-orange-50/40 sm:!text-xl`}
                      value={draft.finance[key]}
                      disabled={disabled}
                      onChange={(e) =>
                        edit({ finance: { ...draft.finance, [key]: e.target.value } })
                      }
                    />
                  </span>
                </label>
              ))}
              <div className="order-2 min-w-0 rounded-xl border border-t-2 border-slate-200 border-t-orange-400 bg-white p-2.5 shadow-sm">
                <p className="flex min-h-10 items-start gap-2 text-xs font-medium leading-5 text-slate-600 sm:text-sm">
                  <Gavel aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                  <span>ราคาปิดประมูล / ยอดขายสุทธิ (บาท)</span>
                </p>
                <p
                  aria-label="ยอดขายสุทธิของไลฟ์นี้"
                  className="mt-1 break-words py-1 text-lg font-bold tabular-nums text-orange-700 sm:text-xl"
                >
                  ฿{sessionMoney(sales)}
                </p>
              </div>
              <div className="order-4 min-w-0 rounded-xl border border-t-2 border-slate-200 border-t-emerald-400 bg-white p-2.5 shadow-sm">
                <p className="flex min-h-10 items-start gap-2 text-xs font-medium leading-5 text-slate-600 sm:text-sm">
                  <Coins aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>กำไรสุทธิ (บาท)</span>
                </p>
                <p
                  aria-label="กำไรสุทธิของไลฟ์นี้"
                  className={`mt-1 break-words py-1 text-lg font-bold tabular-nums sm:text-xl ${profit !== null && profit < 0 ? 'text-red-700' : 'text-emerald-700'}`}
                >
                  {profit === null ? '—' : `฿${sessionMoney(profit)}`}
                </p>
              </div>
              <input type="hidden" value={draft.finance.fees} />
            </div>
          </div>
          <div className="w-full rounded-2xl border border-slate-200 bg-white shadow-sm">
            <section data-auction-zone="1" className="min-w-0 w-full bg-white p-4 sm:p-5">
              <h2 className="-mx-4 -mt-4 mb-4 flex items-center gap-3 rounded-t-2xl bg-orange-500 px-4 py-3 text-lg font-bold tracking-tight text-white sm:-mx-5 sm:-mt-5 sm:px-5 sm:text-xl">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-lg text-orange-600">
                  1
                </span>
                <span>เลือกไลฟ์สด</span>
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                เลือกไลฟ์ที่ต้องการเปิดระบบประมูล (Live CF)
              </p>
              <div className="mt-4 [&_select]:!rounded-lg [&_select]:!border-slate-300 [&_select]:!py-2.5 [&_[role=combobox]]:!rounded-lg [&_[role=combobox]]:!border-slate-300 [&>div]:items-start md:[&>div]:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] [&>div>div:nth-child(2)]:grid [&>div>div:nth-child(2)]:grid-cols-1 [&>div>div:nth-child(2)]:gap-x-3 sm:[&>div>div:nth-child(2)]:grid-cols-[minmax(0,1fr)_auto] [&>div>div:nth-child(2)>div:nth-child(2)]:contents [&>div>div:nth-child(2)>div:nth-child(2)>button:first-child]:col-span-full [&>div>div:nth-child(2)>div:nth-child(2)>button:first-child]:justify-self-start [&>div>div:nth-child(2)>div:nth-child(2)>button:first-child]:!text-[11px] [&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:rounded-lg [&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:border [&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:border-orange-200 [&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:bg-orange-50 [&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:px-3 [&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:py-2.5 [&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:font-semibold [&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:no-underline sm:[&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:col-start-2 sm:[&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:row-start-1 sm:[&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:mt-6 sm:[&>div>div:nth-child(2)>div:nth-child(2)>button:last-child]:h-16 [&>div>div:nth-child(2)>p]:col-span-full">
                <LiveSourcePicker
                  thai
                  pages={options.pages}
                  pageId={draft.pageId}
                  livePostId={draft.livePostId}
                  disabled={busy || loading}
                  onPageChange={(pageId) => {
                    setSource({ pageId, livePostId: '' })
                    edit({ pageId, livePostId: '' })
                  }}
                  onLiveChange={(livePostId) => {
                    if (livePostId !== draft.livePostId) {
                      setSource({ pageId: draft.pageId, livePostId })
                      edit({ livePostId })
                    }
                  }}
                />
              </div>
            </section>
            <section
              data-auction-zone="2"
              className="min-w-0 w-full border-t border-slate-200 bg-white p-4 sm:p-5"
            >
              <h2 className="-mx-4 -mt-4 mb-4 flex items-center gap-3 bg-orange-500 px-4 py-3 text-lg font-bold tracking-tight text-white sm:-mx-5 sm:-mt-5 sm:px-5 sm:text-xl">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-lg text-orange-600">
                  2
                </span>
                <span>เงื่อนไขการประมูล</span>
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                กำหนดข้อมูลสินค้าและกติกาการประมูล
              </p>
              <div className="mt-4 space-y-4">
                <div className="w-full rounded-xl bg-orange-50/70 p-3 sm:p-4">
                  <label className="block text-sm font-semibold text-slate-800">
                    <span className="flex items-center gap-2">
                      <Package aria-hidden="true" className="h-4 w-4 text-orange-500" />
                      ชื่อสินค้า{' '}
                      <span aria-hidden="true" className="text-red-600">
                        *
                      </span>
                    </span>
                    <input
                      className={`${field} !mt-2 !rounded-lg !border-slate-300 !px-3 !py-2.5`}
                      aria-label="ชื่อสินค้า"
                      required
                      maxLength={200}
                      disabled={locked}
                      value={draft.itemName}
                      onChange={(e) => edit({ itemName: e.target.value })}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                  {(
                    [
                      {
                        key: 'startPrice',
                        label: 'ราคาเปิดประมูล (บาท)',
                        min: '0.01',
                        max: 999999999,
                      },
                      {
                        key: 'minStep',
                        label: 'ราคาเคาะขั้นต่ำต่อครั้ง (บาท)',
                        min: '0.01',
                        max: 999999999,
                      },
                      {
                        key: 'shippingFee',
                        label: 'ค่าจัดส่งที่เรียกเก็บ (บาท)',
                        min: '0',
                        max: 999999,
                      },
                    ] as const
                  ).map(({ key, label, min, max }) => (
                    <label key={key} className="block min-w-0 text-sm font-semibold text-slate-800">
                      <span className="flex min-h-10 items-center gap-2 leading-5">
                        {key === 'startPrice' ? (
                          <Coins aria-hidden="true" className="h-4 w-4 shrink-0 text-orange-500" />
                        ) : key === 'minStep' ? (
                          <Gavel aria-hidden="true" className="h-4 w-4 shrink-0 text-orange-500" />
                        ) : (
                          <Truck aria-hidden="true" className="h-4 w-4 shrink-0 text-orange-500" />
                        )}
                        <span>
                          {label}{' '}
                          <span aria-hidden="true" className="text-red-600">
                            *
                          </span>
                        </span>
                      </span>
                      <input
                        className={`${field} !rounded-lg !border-slate-300 !px-3 !py-2.5`}
                        aria-label={label}
                        type="number"
                        min={min}
                        max={max}
                        step="0.01"
                        required
                        disabled={locked}
                        value={draft[key]}
                        onChange={(e) => edit({ [key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  ค่าส่งที่เรียกเก็บจากลูกค้าแยกจากค่าส่งจริงของร้าน
                  รอบที่รับบิดแล้วจะล็อกเงื่อนไขราคา
                </p>
              </div>
            </section>
            <section
              data-auction-zone="3"
              className="min-w-0 w-full border-t border-slate-200 bg-white p-4 sm:p-5"
            >
              <h2 className="-mx-4 -mt-4 mb-4 flex items-center gap-3 bg-orange-500 px-4 py-3 text-lg font-bold tracking-tight text-white sm:-mx-5 sm:-mt-5 sm:px-5 sm:text-xl">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-lg text-orange-600">
                  3
                </span>
                <span>คำดักข้อความ & ระบบตอบกลับ</span>
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                ตั้งค่าคำที่ลูกค้าพิมพ์ เพื่อให้ระบบรับบิดและตอบกลับอัตโนมัติ
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full mt-4 items-start">
                <div className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:p-4 [&_input]:!rounded-lg [&_input]:!border-slate-300 [&_input]:!px-3 [&_input]:!py-2.5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <MessageSquareText aria-hidden="true" className="h-5 w-5 text-orange-500" />
                    คำดักข้อความ
                  </h3>
                  <AuctionKeywordEditor
                    key={`bid:${base?.session?.id}:${reload}`}
                    label="คำดักบิด / ยืนยันผู้ชนะ"
                    kind="bid"
                    keywords={draft.settings.keywords}
                    onChange={(value) => setKeywords('keywords', value)}
                    onEdited={() => setNotice('')}
                    normalize={normalizeBidKeyword}
                    disabled={disabled}
                  />
                  <div className="border-t border-slate-200 pt-4">
                    <AuctionKeywordEditor
                      key={`close:${base?.session?.id}:${reload}`}
                      label="คำปิดรอบของเพจ / แอดมิน"
                      kind="close"
                      keywords={draft.settings.closeKeywords ?? []}
                      onChange={(value) => setKeywords('closeKeywords', value)}
                      onEdited={() => setNotice('')}
                      normalize={normalizeCloseKeyword}
                      disabled={disabled}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    ขณะเปิดรอบ คำดักใช้เคาะราคา หลังปิดรอบ ผู้ชนะพิมพ์คำเดิมอีกครั้งเพื่อรับยอด
                  </p>
                </div>
                <div className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-3 sm:p-4 [&_textarea]:!rounded-lg [&_textarea]:!border-slate-300 [&_textarea]:!px-3 [&_textarea]:!py-2.5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Bot aria-hidden="true" className="h-5 w-5 text-orange-500" />
                    ระบบตอบกลับอัตโนมัติ
                  </h3>
                  {(
                    [
                      {
                        key: 'bidText',
                        toggle: 'publicReply',
                        label: 'Public Reply ใต้คอมเมนต์',
                        maxLength: 600,
                      },
                      {
                        key: 'privateText',
                        toggle: 'privateReply',
                        label: 'Private Reply เข้า Inbox',
                        maxLength: 1500,
                      },
                    ] as const
                  ).map(({ key, toggle, label, maxLength }) => (
                    <div key={key} className="min-w-0 space-y-2 border-t border-slate-100 pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
                        <LiveSwitch
                          checked={draft.settings[toggle]}
                          onChange={(value) =>
                            edit({ settings: { ...draft.settings, [toggle]: value } })
                          }
                          label={`เปิด ${label}`}
                          disabled={disabled}
                        />
                      </div>
                      <LiveTemplateEditor
                        label={label}
                        value={draft.settings[key]}
                        onChange={(value) =>
                          edit({ settings: { ...draft.settings, [key]: value } })
                        }
                        variables={variables}
                        maxLength={maxLength}
                        disabled={disabled || !draft.settings[toggle]}
                      />
                    </div>
                  ))}
                  <div className="space-y-2 rounded-xl border border-orange-100 bg-orange-50/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 text-sm font-semibold leading-relaxed text-slate-800">
                        แยกส่งแจ้งยอดชิ้นล่าสุด + บิลรวมสะสมอัตโนมัติ
                      </h3>
                      <LiveSwitch
                        checked={draft.settings.auto_accumulate_summary ?? true}
                        onChange={(value) =>
                          edit({ settings: { ...draft.settings, auto_accumulate_summary: value } })
                        }
                        label="แยกส่งแจ้งยอดชิ้นล่าสุด + บิลรวมสะสมอัตโนมัติ"
                        disabled={disabled}
                      />
                    </div>
                    <p className="text-xs leading-relaxed text-slate-600">
                      ส่งข้อความแรกแจ้งยอดชิ้นที่เพิ่งปิด
                      แล้วส่งข้อความที่สองสรุปบิลรวมสะสมตามหลังทันที
                    </p>
                    <p className="text-xs leading-relaxed text-slate-500">
                      หากหน้าต่างแชตยังไม่เปิด ข้อความสรุปจะรอให้ลูกค้าตอบกลับใน Inbox ก่อน
                    </p>
                  </div>
                  <label className="block text-sm font-semibold text-slate-800">
                    <span className="flex items-center gap-2">
                      <Landmark aria-hidden="true" className="h-4 w-4 text-orange-500" />
                      บัญชีธนาคารรับเงิน
                    </span>
                    <select
                      aria-label="บัญชีธนาคารรับเงิน"
                      className={`${field} !mt-2 !rounded-lg !border-slate-300 !px-3 !py-2.5`}
                      required
                      disabled={locked}
                      value={draft.settings.bankAccountId}
                      onChange={(e) =>
                        edit({ settings: { ...draft.settings, bankAccountId: e.target.value } })
                      }
                    >
                      <option value="">เลือกบัญชีรับเงิน</option>
                      {options.bankAccounts.map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.bank_code} · {bank.account_number}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </section>
          </div>
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50/60 p-4 text-center sm:p-5">
            <div className="text-sm leading-relaxed text-slate-600">
              {base?.session?.ended_at
                ? 'ไลฟ์นี้จบแล้ว เลือกไลฟ์ใหม่เพื่อเริ่มประมูล'
                : base?.round?.status === 'active' && !base.preferencesOnly
                  ? `กำลังประมูล: ${base.round.item_name}`
                  : 'บันทึกเงื่อนไขและคำดักทั้งหมดพร้อมเปิดรอบในครั้งเดียว'}
            </div>
            <button
              type="submit"
              className={`${orange} min-h-12 w-full justify-center !rounded-lg px-6 text-base font-bold shadow-sm sm:max-w-md`}
              disabled={disabled || !draft.pageId || !draft.livePostId}
            >
              {busy ? 'กำลังบันทึก…' : 'บันทึกและเริ่มประมูล'}
            </button>
          </div>
        </section>
      )}
    </form>
  )
}
