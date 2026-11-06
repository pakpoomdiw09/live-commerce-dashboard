'use client'

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
  settings: SessionAutomation
  finance: { cost: string; ads: string; shipping: string; fees: string }
}
const blankSessionAutomation = (bankAccountId = ''): SessionAutomation => ({
  keywords: [],
  closeKeywords: [],
  publicReply: false,
  privateReply: false,
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
        settings: {
          ...settings,
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
      ? sumMoney([
          ...data.rounds
            .filter((round) => round.status === 'closed' && !!round.orderId)
            .map((round) => round.price),
          ...(data.activeAuction?.currentPrice == null ? [] : [data.activeAuction.currentPrice]),
        ])
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
    <form onSubmit={handleSubmitAll} data-auction-unified-form className="min-w-0 space-y-5">
      <header>
        <h1 className="text-xl font-bold text-slate-900">ไลฟ์สดการประมูล</h1>
        <p className="mt-1 text-sm text-slate-500">
          เลือกไลฟ์ ตั้งราคา และข้อความตอบกลับ แล้วบันทึกทุกอย่างในครั้งเดียว
        </p>
      </header>
      {loading && (
        <p role="status" className="text-sm text-slate-500">
          กำลังโหลดค่าที่บันทึกไว้…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {draft && (
        <section
          data-auction-workspace
          className="min-w-0 overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm"
        >
          <h2 className="bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-3 text-lg font-bold text-white">
            ตั้งค่าประมูลและสรุปการเงิน
          </h2>
          <div className="space-y-6 p-4 md:p-6">
            <div
              className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
              data-auction-header-cards
            >
              {financeCards.slice(0, 3).map(({ label, key, color }) => (
                <label
                  key={key}
                  className={`min-w-0 rounded-xl border border-t-4 border-slate-200 ${color} bg-white p-3 text-xs font-semibold text-slate-600 shadow-sm`}
                >
                  {label}
                  <input
                    type="number"
                    min="0"
                    max="999999999999.99"
                    step="0.01"
                    aria-label={label}
                    className={`${field} !mt-2 !border-0 !bg-transparent !px-0 text-lg font-bold tabular-nums text-slate-900`}
                    value={draft.finance[key]}
                    disabled={disabled}
                    onChange={(e) => edit({ finance: { ...draft.finance, [key]: e.target.value } })}
                  />
                </label>
              ))}
              <div className="min-w-0 rounded-xl border border-t-4 border-slate-200 border-t-emerald-500 bg-white p-3 shadow-sm">
                <p className="text-xs font-semibold text-slate-600">
                  ราคาปิดประมูล / ยอดขายสุทธิ (บาท)
                </p>
                <p
                  aria-label="ยอดขายสุทธิของไลฟ์นี้"
                  className="mt-2 break-words text-lg font-extrabold tabular-nums text-emerald-700"
                >
                  ฿{sessionMoney(sales)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">ยอดปิดประมูลรวมรอบที่กำลังประมูล</p>
              </div>
              <label
                className={`min-w-0 rounded-xl border border-t-4 border-slate-200 ${financeCards[3].color} bg-white p-3 text-xs font-semibold text-slate-600 shadow-sm`}
              >
                {financeCards[3].label}
                <input
                  type="number"
                  min="0"
                  max="999999999999.99"
                  step="0.01"
                  aria-label={financeCards[3].label}
                  className={`${field} !mt-2 !border-0 !bg-transparent !px-0 text-lg font-bold tabular-nums text-slate-900`}
                  value={draft.finance.fees}
                  disabled={disabled}
                  onChange={(e) => edit({ finance: { ...draft.finance, fees: e.target.value } })}
                />
              </label>
              <div className="min-w-0 rounded-xl border border-t-4 border-slate-200 border-t-orange-500 bg-orange-50 p-3 shadow-sm">
                <p className="text-xs font-semibold text-orange-800">กำไรสุทธิ (บาท)</p>
                <p
                  aria-label="กำไรสุทธิของไลฟ์นี้"
                  className={`mt-2 break-words text-lg font-extrabold tabular-nums ${profit !== null && profit < 0 ? 'text-red-700' : 'text-orange-800'}`}
                >
                  {profit === null ? '—' : `฿${sessionMoney(profit)}`}
                </p>
                <p className="mt-1 text-[11px] text-orange-700">
                  ยอดขาย − ต้นทุน − ค่าแอด − ค่าส่งจริง − ค่าธรรมเนียม
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full items-start">
              <section
                data-auction-zone="1"
                className="min-w-0 overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm md:col-span-2"
              >
                <h2 className="rounded-t-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 font-bold text-white">
                  1. เลือกไลฟ์สด
                </h2>
                <div className="p-5">
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
                className="min-w-0 overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm"
              >
                <h2 className="rounded-t-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 font-bold text-white">
                  2. เงื่อนไขการประมูล
                </h2>
                <div className="space-y-4 p-5">
                  <label className="block text-sm font-semibold">
                    ชื่อสินค้า
                    <input
                      className={field}
                      aria-label="ชื่อสินค้า"
                      required
                      maxLength={200}
                      disabled={locked}
                      value={draft.itemName}
                      onChange={(e) => edit({ itemName: e.target.value })}
                    />
                  </label>
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
                    <label key={key} className="block text-sm font-semibold">
                      {label}
                      <input
                        className={field}
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
                  <label className="block text-sm font-semibold">
                    บัญชีธนาคารรับเงิน
                    <select
                      aria-label="บัญชีธนาคารรับเงิน"
                      className={field}
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
                  <p className="text-xs text-slate-500">
                    ค่าส่งที่เรียกเก็บจากลูกค้าแยกจากค่าส่งจริงของร้าน
                    รอบที่รับบิดแล้วจะล็อกเงื่อนไขราคา
                  </p>
                </div>
              </section>
              <section
                data-auction-zone="3"
                className="min-w-0 overflow-visible rounded-2xl border border-orange-200 bg-white shadow-sm"
              >
                <h2 className="rounded-t-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 font-bold text-white">
                  3. คำดักข้อความ & ระบบตอบกลับ
                </h2>
                <div className="space-y-5 p-5">
                  <div className="grid min-w-0 gap-4 lg:grid-cols-2">
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
                  <p className="text-xs text-slate-500">
                    ขณะเปิดรอบ คำดักใช้เคาะราคา หลังปิดรอบ ผู้ชนะพิมพ์คำเดิมอีกครั้งเพื่อรับยอด
                  </p>
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
                    <div key={key} className="min-w-0 space-y-2">
                      <div className="flex items-center gap-3">
                        <LiveSwitch
                          checked={draft.settings[toggle]}
                          onChange={(value) =>
                            edit({ settings: { ...draft.settings, [toggle]: value } })
                          }
                          label={`เปิด ${label}`}
                          disabled={disabled}
                        />
                        <h3 className="text-sm font-semibold">{label}</h3>
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
                </div>
              </section>
            </div>
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50/50 p-4 text-center">
              <div className="text-sm text-slate-600">
                {base?.session?.ended_at
                  ? 'ไลฟ์นี้จบแล้ว เลือกไลฟ์ใหม่เพื่อเริ่มประมูล'
                  : base?.round?.status === 'active' && !base.preferencesOnly
                    ? `กำลังประมูล: ${base.round.item_name}`
                    : 'บันทึกเงื่อนไขและคำดักทั้งหมดพร้อมเปิดรอบในครั้งเดียว'}
              </div>
              <button
                type="submit"
                className={`${orange} min-h-14 w-full justify-center text-base font-bold shadow-md sm:max-w-md`}
                disabled={disabled || !draft.pageId || !draft.livePostId}
              >
                {busy ? 'กำลังบันทึก…' : 'บันทึกและเริ่มประมูล'}
              </button>
            </div>
          </div>
        </section>
      )}
    </form>
  )
}
