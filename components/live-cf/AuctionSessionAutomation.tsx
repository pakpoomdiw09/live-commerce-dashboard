'use client'
import { useRef, useState } from 'react'
import type { LiveSession } from '@/lib/features/commerce/live-session-types'
import {
  defaultSessionAutomation,
  normalizeBidKeyword,
  validSessionAutomation,
  type SessionAutomation,
} from '@/lib/features/commerce/session-automation'
import { LiveSwitch, LiveTemplateEditor, ReceivingBankPicker } from './LiveReplyControls'
import type { AuctionDashboardOptions } from './AuctionSessionStart'
import { field, orange } from './session-ui'

const variables = [
  { tag: '{name}', label: 'ชื่อลูกค้า', key: 'bidder_name' },
  { tag: '{item}', label: 'ชื่อรายการ', key: 'product_name' },
  { tag: '{price}', label: 'ราคาจบประมูล', key: 'price' },
  { tag: '{total}', label: 'ยอดรวมสะสม', key: 'total' },
  { tag: '{bank_account}', label: 'บัญชีรับเงิน', key: 'bank_account' },
  { tag: '{remaining}', label: 'ยอดค้างสุทธิ', key: 'remaining' },
  { tag: '{payment_link}', label: 'ลิงก์ชำระเงิน', key: 'payment_link' },
]
const friendly = (text: string) =>
  text.replaceAll('{bidder_name}', '{name}').replaceAll('{product_name}', '{item}')
export function AuctionSessionAutomation({
  tenantId,
  session,
  options,
  onSaved,
}: {
  tenantId: string
  session: LiveSession
  options: AuctionDashboardOptions
  onSaved: () => void
}) {
  const initial = session.auction_settings ?? defaultSessionAutomation(options.bankAccounts[0]?.id)
  const [draft, setDraft] = useState<SessionAutomation>({
    ...initial,
    bidText: friendly(initial.bidText),
    privateText: friendly(initial.privateText),
    closeText: friendly(initial.closeText),
  })
  const [keyword, setKeyword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [baseRevision, setBaseRevision] = useState(session.automation_revision ?? 0)
  const request = useRef({ key: '', id: '' })
  const disabled = busy || !!session.ended_at
  const toggle = (
    key: 'publicReply' | 'privateReply' | 'countEnabled' | 'closeEnabled' | 'heartCloses',
    label: string,
  ) => (
    <div className="flex items-center gap-3">
      <LiveSwitch
        label={label}
        checked={draft[key]}
        disabled={disabled}
        onChange={(checked) => setDraft((previous) => ({ ...previous, [key]: checked }))}
      />
      <span className="text-sm font-medium">{label}</span>
    </div>
  )
  function add(value: string) {
    const k = normalizeBidKeyword(value)
    if (
      !k ||
      k.length > 40 ||
      /[\r\n{}]/u.test(k) ||
      draft.keywords.includes(k) ||
      draft.keywords.length >= 30
    )
      return
    setDraft((previous) => ({ ...previous, keywords: [...previous.keywords, k] }))
    setKeyword('')
  }
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        setNotice('')
        const key = JSON.stringify({ draft, baseRevision })
        if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() }
        try {
          const response = await fetch('/api/live-auction/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              sessionId: session.id,
              action: 'settings',
              revision: baseRevision,
              settings: draft,
              requestId: request.current.id,
            }),
            signal: AbortSignal.timeout(30000),
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'บันทึกค่าตั้งค่าไม่สำเร็จ')
          setBaseRevision(result.revision)
          request.current = { key: '', id: '' }
          setNotice('บันทึกแล้ว ใช้กับรอบที่กำลังเปิดและรอบใหม่ใน Session นี้')
          onSaved()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'บันทึกค่าตั้งค่าไม่สำเร็จ')
        } finally {
          setBusy(false)
        }
      }}
    >
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">คำดักเคาะบิด</legend>
        <div className="flex flex-wrap gap-2">
          {draft.keywords.map((k) => (
            <button
              type="button"
              key={k}
              aria-label={`ลบคำดัก ${k}`}
              className="rounded-full bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 ring-1 ring-orange-200 disabled:opacity-50"
              onClick={() =>
                setDraft((previous) => ({
                  ...previous,
                  keywords: previous.keywords.filter((v) => v !== k),
                }))
              }
            >
              {k} ×
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {['1', '11', '111', '11111', '+1', '+10']
            .filter((k) => !draft.keywords.includes(k))
            .map((k) => (
              <button
                type="button"
                key={k}
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={() => add(k)}
              >
                เพิ่ม {k}
              </button>
            ))}
        </div>
        <div className="flex max-w-lg gap-2">
          <input
            aria-label="เพิ่มคำดักบิด"
            maxLength={40}
            className={field}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add(keyword)
              }
            }}
            placeholder="คำดักใหม่"
          />
          <button
            type="button"
            className={`${orange} shrink-0 whitespace-nowrap`}
            disabled={!keyword.trim() || draft.keywords.length >= 30}
            onClick={() => add(keyword)}
          >
            เพิ่มคำดัก
          </button>
        </div>
        <p className="text-xs text-slate-500">
          ทุกคำดักเพิ่มหนึ่งสเต็ปต่อคอมเมนต์ รวมถึง +10 ส่วนตัวเลขอื่นเป็นราคาเสนอโดยตรง
        </p>
      </fieldset>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          {toggle('publicReply', 'ข้อความตอบกลับใต้คอมเมนต์')}
          <LiveTemplateEditor
            label="Template ตอบกลับใต้คอมเมนต์"
            value={draft.bidText}
            disabled={disabled || !draft.publicReply}
            variables={variables.filter((v) =>
              ['bidder_name', 'product_name', 'price'].includes(v.key),
            )}
            maxLength={600}
            onChange={(bidText) => setDraft((previous) => ({ ...previous, bidText }))}
          />
        </div>
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          {toggle('privateReply', 'ข้อความส่งเข้าแชท (Messenger)')}
          <LiveTemplateEditor
            label="Template ข้อความส่งเข้าแชท (Messenger)"
            value={draft.privateText}
            disabled={disabled || !draft.privateReply}
            variables={variables}
            onChange={(privateText) => setDraft((previous) => ({ ...previous, privateText }))}
          />
          <ReceivingBankPicker
            accounts={options.bankAccounts}
            value={draft.bankAccountId}
            required
            disabled={disabled}
            onChange={(bankAccountId) => setDraft((previous) => ({ ...previous, bankAccountId }))}
          />
          <p className="text-xs text-slate-500">
            {`{total}`} คือยอดรวมบิลสะสมล่าสุด และ {`{remaining}`} คือยอดที่ต้องโอนเพิ่ม
            เมื่อเปิดสวิตช์ ระบบส่งทันทีทุกครั้งที่ปิดรายการและมีผู้ชนะ
            พร้อมบัญชีรับเงินและลิงก์แนบสลิป บัญชีใหม่ใช้กับรอบใหม่ บิลเดิมคงบัญชีรับเงินเดิม
          </p>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-3">
        {toggle('countEnabled', 'รับคำสั่งนับ 3, 2, 1')}
        {toggle('closeEnabled', 'รับคำสั่งปิดรอบ ❌ / ปิด')}
        {toggle('heartCloses', 'ปิดรอบด้วยอิโมจิ ❤️')}
      </div>
      <p className="text-xs text-slate-500">
        เฉพาะเพจและผู้ช่วยคุมประมูลเท่านั้นที่สั่งนับหรือปิดได้ คำสั่งของลูกค้าไม่ปิดรอบ
      </p>
      {(session.automation_revision ?? 0) > baseRevision && (
        <p role="alert" className="text-sm text-amber-700">
          ค่าตั้งค่ามีฉบับใหม่แล้ว กรุณาโหลดค่าล่าสุดก่อนบันทึก{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              const next = session.auction_settings ?? initial
              setDraft({
                ...next,
                bidText: friendly(next.bidText),
                privateText: friendly(next.privateText),
                closeText: friendly(next.closeText),
              })
              setBaseRevision(session.automation_revision ?? 0)
            }}
          >
            โหลดค่าล่าสุด
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      <button
        className={orange}
        type="submit"
        disabled={
          disabled ||
          !validSessionAutomation(draft) ||
          (session.automation_revision ?? 0) > baseRevision
        }
      >
        {session.ended_at
          ? 'Session นี้จบแล้ว'
          : busy
            ? 'กำลังบันทึก…'
            : 'บันทึกค่าตั้งค่า Session'}
      </button>
    </form>
  )
}
