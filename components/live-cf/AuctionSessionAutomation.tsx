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
import { orange } from './session-ui'
import { AuctionKeywordEditor } from './AuctionKeywordEditor'

const variables = [
  { tag: '{ชื่อลูกค้า}', label: 'ชื่อลูกค้า', key: 'bidder_name' },
  { tag: '{รายการ}', label: 'รายการ', key: 'product_name' },
  { tag: '{ราคา}', label: 'ราคา', key: 'price' },
  { tag: '{ยอดรวมสะสม}', label: 'ยอดรวมสะสม', key: 'total' },
  { tag: '{เลขบัญชี}', label: 'เลขบัญชี', key: 'bank_account' },
]
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
    [bidKeywords, setBidKeywords] = useState(initial.keywords),
    [closeKeywords, setCloseKeywords] = useState(initial.closeKeywords!)
  const [baseRevision, setBaseRevision] = useState(session.automation_revision ?? 0)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const request = useRef({ key: '', id: '' })
  const disabled = busy || !!session.ended_at
  const settings = {
    ...draft,
    keywords: bidKeywords,
    closeKeywords,
    closeText: draft.bidText,
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
        <div className="min-w-0 space-y-2">
          <AuctionKeywordEditor
            key={'bid-' + baseRevision}
            label="คีย์เวิร์ดการดักคำ"
            kind="bid"
            keywords={bidKeywords}
            onChange={setBidKeywords}
            normalize={normalizeBidKeyword}
            disabled={disabled}
            onEdited={() => setNotice('')}
          />
          <p className="text-xs text-slate-500">
            ระหว่างเปิดรอบ คำนี้ใช้เคาะราคา เช่น 1 หลังปิดรอบ
            ผู้ชนะรอบล่าสุดพิมพ์คำนี้อีกครั้งเพื่อรับยอด · มีผลเมื่อกดบันทึก
          </p>
        </div>
        <div className="min-w-0 space-y-2">
          <AuctionKeywordEditor
            key={'close-' + baseRevision}
            label="คีย์เวิร์ดการปิดการประมูล"
            kind="close"
            keywords={closeKeywords}
            onChange={setCloseKeywords}
            normalize={normalizeCloseKeyword}
            emojiKeys={QUICK_AUCTION_CLOSE_EMOJIS}
            disabled={disabled}
            onEdited={() => setNotice('')}
          />
          <p className="text-xs text-slate-500">
            เมื่อคอมเมนต์ของเพจหรือผู้ดูแลมีคำหรืออีโมจิที่เลือก เช่น ปิด ❌ หรือ 321 🛑
            ระบบจะปิดรอบและตัดสินผู้ชนะทันที คำสั่งของลูกค้าจะไม่ปิดรอบ · มีผลเมื่อกดบันทึก
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
            ข้อความตอบกลับใต้คอมเมนต์ยืนยันของผู้ชนะรอบล่าสุดหน้าไลฟ์สด
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
            เมื่อผู้ชนะรอบล่าสุดพิมพ์คีย์เวิร์ดยืนยัน จะส่งสรุปยอดสะสมและเลขบัญชีทาง Messenger
            รองรับตัวแปร {'{ชื่อลูกค้า}, {รายการ}, {ราคา}, {ยอดรวมสะสม}, {เลขบัญชี}'}{' '}
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
              setBidKeywords(next.keywords)
              setCloseKeywords(next.closeKeywords!)
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
