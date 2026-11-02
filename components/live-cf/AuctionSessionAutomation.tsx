'use client'
import { useRef, useState } from 'react'
import type { LiveSession } from '@/lib/features/commerce/live-session-types'
import {
  defaultSessionAutomation,
  displaySessionTemplate,
  normalizeBidKeyword,
  normalizeCloseKeyword,
  DEFAULT_AUCTION_CLOSE_KEYWORDS,
  QUICK_AUCTION_CLOSE_EMOJIS,
  validSessionAutomation,
  type SessionAutomation,
} from '@/lib/features/commerce/session-automation'
import { LiveSwitch, LiveTemplateEditor } from './LiveReplyControls'
import type { AuctionDashboardOptions } from './AuctionSessionStart'
import { field, orange } from './session-ui'

const variables = [
  { tag: '{ชื่อลูกค้า}', label: 'ชื่อลูกค้า', key: 'bidder_name' },
  { tag: '{รายการ}', label: 'รายการ', key: 'product_name' },
  { tag: '{ราคา}', label: 'ราคา', key: 'price' },
  { tag: '{ยอดรวมสะสม}', label: 'ยอดรวมสะสม', key: 'total' },
  { tag: '{เลขบัญชี}', label: 'เลขบัญชี', key: 'bank_account' },
]
const words = (text: string) =>
  text
    .split(/[,\n]+/)
    .map(normalizeBidKeyword)
    .filter(Boolean)
function draftFrom(session: LiveSession, bankId?: string): SessionAutomation {
  const initial = session.auction_settings ?? defaultSessionAutomation(bankId)
  return {
    ...initial,
    closeKeywords: initial.closeKeywords ?? [...DEFAULT_AUCTION_CLOSE_KEYWORDS],
    countEnabled: false,
    heartCloses: false,
    bidText: displaySessionTemplate(initial.closeKeywords ? initial.bidText : initial.closeText),
    privateText: displaySessionTemplate(initial.privateText),
  }
}
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
  const initial = draftFrom(session, options.bankAccounts[0]?.id)
  const [draft, setDraft] = useState(initial),
    [keywordText, setKeywordText] = useState(initial.keywords.join(', ')),
    [closeKeywords, setCloseKeywords] = useState(initial.closeKeywords!),
    [closeInput, setCloseInput] = useState('')
  const [baseRevision, setBaseRevision] = useState(session.automation_revision ?? 0)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const request = useRef({ key: '', id: '' })
  const disabled = busy || !!session.ended_at
  const settings = {
    ...draft,
    keywords: words(keywordText),
    closeKeywords,
    closeText: draft.bidText,
  }
  function addCloseKeyword(text: string) {
    const word = normalizeCloseKeyword(text)
    if (!word) return
    if (word.length > 40 || /[\r\n{}]/u.test(word)) {
      setError('คำปิดรอบต้องยาวไม่เกิน 40 ตัวอักษร และไม่มีวงเล็บปีกกาหรือการขึ้นบรรทัดใหม่')
      return
    }
    if (closeKeywords.includes(word)) {
      setCloseInput('')
      return
    }
    if (closeKeywords.length >= 30) {
      setError('เพิ่มคำปิดรอบได้ไม่เกิน 30 คำ กรุณาลบบางคำก่อน')
      return
    }
    setCloseKeywords((previous) => [...previous, word])
    setCloseInput('')
    setError('')
    setNotice('')
  }
  return (
    <form
      data-auction-automation
      className="space-y-5 rounded-xl border border-slate-200 p-4"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!validSessionAutomation(settings)) return
        setBusy(true)
        setError('')
        setNotice('')
        const key = JSON.stringify({ settings, baseRevision })
        if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() }
        try {
          const response = await fetch('/api/live-auction/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              sessionId: session.id,
              action: 'settings',
              settings,
              revision: baseRevision,
              requestId: request.current.id,
            }),
            signal: AbortSignal.timeout(30000),
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'บันทึกคำดักไม่สำเร็จ')
          setBaseRevision(result.revision)
          request.current = { key: '', id: '' }
          setNotice('บันทึกแล้ว คำดักและข้อความนี้ใช้กับรอบปัจจุบันและรอบใหม่ในไลฟ์นี้')
          onSaved()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ')
        } finally {
          setBusy(false)
        }
      }}
    >
      <h3 className="font-bold text-slate-900">ตั้งค่าคำดักและคำสั่งปิดรอบ</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-semibold">
          คีย์เวิร์ดการดักคำ
          <input
            aria-label="คีย์เวิร์ดการดักคำ"
            className={field}
            maxLength={1200}
            value={keywordText}
            disabled={disabled}
            onChange={(e) => setKeywordText(e.target.value)}
            placeholder="เช่น 1"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            กำหนดคำที่ต้องการให้ลูกค้าพิมพ์ในคอมเมนต์เพื่อเคาะประมูล เช่น พิมพ์ 1
            เมื่อชนะยอดจะส่งเข้า Messenger ทันที
          </span>
          <span className="mt-1 block text-xs font-normal text-slate-500">
            ถ้ามีหลายคำให้คั่นด้วยเครื่องหมายจุลภาค เช่น 1, เคาะ · ค่าที่แก้มีผลเมื่อกดบันทึก
          </span>
        </label>
        <div className="space-y-2 text-sm font-semibold">
          <label htmlFor="auction-close-keyword">คีย์เวิร์ดการปิดการประมูล</label>
          <div className="flex flex-wrap gap-1.5" aria-label="คำปิดรอบที่เลือก">
            {closeKeywords.map((word) => (
              <span key={word} className="inline-flex max-w-full items-center gap-1 break-all rounded-full bg-orange-50 py-1 pl-3 pr-1 text-orange-800">
                {word}
                <button type="button" disabled={disabled}
                  aria-label={`ลบคำปิดรอบ ${word}`}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-orange-100 disabled:opacity-40"
                  onClick={() => { setCloseKeywords((previous) => previous.filter((value) => value !== word)); setNotice('') }}>
                  <span aria-hidden="true">×</span>
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input id="auction-close-keyword"
              aria-label="คีย์เวิร์ดการปิดการประมูล" className={`${field} !mt-0`}
              maxLength={40} value={closeInput} disabled={disabled}
              onChange={(e) => setCloseInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addCloseKeyword(closeInput) } }}
              placeholder="พิมพ์คำหรือวางอีโมจิ แล้วกด +"
            />
            <button type="button" aria-label="เพิ่มคำปิดรอบ" className={orange}
              disabled={disabled || !closeInput.trim()} onClick={() => addCloseKeyword(closeInput)}>+</button>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="เพิ่มอีโมจิปิดรอบด่วน">
            {QUICK_AUCTION_CLOSE_EMOJIS.map((emoji) => (
              <button key={emoji} type="button" aria-label={`เพิ่มอีโมจิ ${emoji}`}
                disabled={disabled || closeKeywords.includes(emoji)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg hover:border-orange-400 hover:bg-orange-50 disabled:opacity-40"
                onClick={() => addCloseKeyword(emoji)}>{emoji}</button>
            ))}
          </div>
          <p className="text-xs font-normal text-slate-500">
            เมื่อคอมเมนต์ของเพจหรือผู้ดูแลมีคำหรืออีโมจิที่เลือกอยู่ในข้อความ เช่น ปิด ❌ หรือ 321 🛑 ระบบจะปิดรอบและตัดสินผู้ชนะทันที คำสั่งของลูกค้าจะไม่ปิดรอบ
          </p>
          <p className="text-xs font-normal text-slate-500">
            กด × เพื่อลบ กดอีโมจิเพื่อเพิ่ม หรือพิมพ์คำแล้วกด + ได้สูงสุด 30 คำ · รองรับ x และ X · มีผลเมื่อกดบันทึก
          </p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <LiveSwitch
              checked={draft.publicReply}
              disabled={disabled}
              label="เปิดข้อความตอบกลับใต้คอมเมนต์"
              onChange={(publicReply) => setDraft((previous) => ({ ...previous, publicReply }))}
            />
            <h4 className="text-sm font-semibold">ข้อความตอบกลับใต้คอมเมนต์</h4>
          </div>
          <LiveTemplateEditor
            label="ข้อความตอบกลับใต้คอมเมนต์"
            value={draft.bidText}
            disabled={disabled || !draft.publicReply}
            variables={variables.slice(0, 3)}
            maxLength={600}
            onChange={(bidText) => setDraft((previous) => ({ ...previous, bidText }))}
          />
          <p className="text-xs text-slate-500">
            ข้อความที่จะแท็กตอบกลับใต้คอมเมนต์ของผู้ชนะหน้าไลฟ์สด
            ระหว่างเคาะประมูลระบบจะจำผู้ขึ้นนำให้เงียบ ๆ
          </p>
        </div>
        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <LiveSwitch
              checked={draft.privateReply}
              disabled={disabled}
              label="เปิดข้อความแจ้งยอดเข้าแชทส่วนตัว"
              onChange={(privateReply) => setDraft((previous) => ({ ...previous, privateReply }))}
            />
            <h4 className="text-sm font-semibold">ข้อความแจ้งยอดเข้าแชทส่วนตัว (Messenger)</h4>
          </div>
          <LiveTemplateEditor
            label="ข้อความแจ้งยอดเข้าแชทส่วนตัว (Messenger)"
            value={draft.privateText}
            disabled={disabled || !draft.privateReply}
            variables={variables}
            onChange={(privateText) => setDraft((previous) => ({ ...previous, privateText }))}
          />
          <p className="text-xs text-slate-500">
            ส่งสรุปยอดสะสมและเลขบัญชีให้ผู้ชนะทันทีทาง Messenger รองรับตัวแปร{' '}
            {'{ชื่อลูกค้า}, {รายการ}, {ราคา}, {ยอดรวมสะสม}, {เลขบัญชี}'}{' '}
            ระบบแนบยอดค้างและลิงก์ชำระเงินให้ด้วย
          </p>
        </div>
      </div>
      {(session.automation_revision ?? 0) > baseRevision && (
        <p role="alert" className="text-sm text-amber-700">
          มีคนแก้ไขคำดักแล้ว{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              const next = draftFrom(session, options.bankAccounts[0]?.id)
              setDraft(next)
              setKeywordText(next.keywords.join(', '))
              setCloseKeywords(next.closeKeywords!)
              setCloseInput('')
              setBaseRevision(session.automation_revision ?? 0)
            }}
          >
            ใช้ข้อมูลล่าสุด
          </button>
        </p>
      )}
      {!validSessionAutomation(settings) && !disabled && (
        <p className="text-xs text-orange-700">
          กรอกคำดักและคำปิดอย่างน้อยช่องละหนึ่งคำ คำต้องไม่ซ้ำกัน และใช้ตัวแปรที่กำหนดในข้อความ
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
        type="submit"
        className={orange}
        disabled={
          disabled ||
          !validSessionAutomation(settings) ||
          (session.automation_revision ?? 0) > baseRevision
        }
      >
        {session.ended_at ? 'ไลฟ์นี้จบแล้ว' : busy ? 'กำลังบันทึก…' : 'บันทึกคำดักและข้อความ'}
      </button>
    </form>
  )
}
