'use client'
import { useRef, useState } from 'react'
import { SessionDialog } from './SessionDialog'
import { LiveTemplateEditor } from './LiveReplyControls'
import {
  renderSessionFollowup,
  validSessionTemplate,
  SESSION_FOLLOWUP_TEMPLATE,
  SESSION_VARIABLES,
  sessionMoney as money,
  sumMoney,
  tabFormula,
  type SessionTab,
} from '@/lib/features/commerce/live-session-types'
import { button, orange, stateText, type Post } from './session-ui'
const followupLabels: Record<string, string> = {
  name: 'ชื่อลูกค้า',
  due: 'ยอดต้องโอน',
  paid: 'ยอดโอนแล้ว',
  short: 'ยอดค้างสุทธิ',
  items: 'รายการสินค้า',
}
const displayFollowup = (text: string) =>
  text.replace(/\{([^{}]+)\}/g, (match, key: string) =>
    followupLabels[key] ? `{${followupLabels[key]}}` : match,
  )
const storeFollowup = (text: string) =>
  text.replace(/\{([^{}]+)\}/g, (match, label: string) => {
    const key = Object.keys(followupLabels).find((key) => followupLabels[key] === label)
    return key ? `{${key}}` : match
  })

export function SessionFollowupModal({
  tabs,
  selected,
  post,
  onClose,
}: {
  tabs: SessionTab[]
  selected: string[]
  post: Post
  onClose: () => void
}) {
  const [scope, setScope] = useState<'all' | 'selected'>(selected.length ? 'selected' : 'all')
  const [template, setTemplate] = useState(displayFollowup(SESSION_FOLLOWUP_TEMPLATE)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [queued, setQueued] = useState<number | null>(null)
  const request = useRef(crypto.randomUUID())
  const targets = tabs.filter(
    (tab) => Number(tab.remaining) > 0 && (scope === 'all' || selected.includes(tab.id)),
  )
  return (
    <SessionDialog
      title="ตามยอด - แจ้งยอดลูกค้าที่ยังไม่โอน / โอนไม่ครบ"
      onClose={onClose}
      busy={busy}
    >
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-2 font-semibold">ส่งถึง</legend>
        {(
          [
            { value: 'all', label: 'ทุกคนที่ยังโอนไม่ครบในไลฟ์นี้' },
            { value: 'selected', label: `เฉพาะคนที่ติ๊กเลือก (${selected.length} คน)` },
          ] as const
        ).map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input
              type="radio"
              name="reminder-target"
              value={option.value}
              checked={scope === option.value}
              disabled={busy || queued !== null}
              onChange={() => {
                setScope(option.value)
                request.current = crypto.randomUUID()
              }}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <div>
        <p className="text-sm font-semibold">ข้อความทวงยอด</p>
        <LiveTemplateEditor
          label="ข้อความตามยอดค้างชำระ"
          value={template}
          variables={SESSION_VARIABLES.map((variable) => {
            const key = variable.tag.slice(1, -1)
            return { tag: `{${followupLabels[key]}}`, label: followupLabels[key] }
          })}
          disabled={busy || queued !== null}
          maxLength={1500}
          rows={6}
          onChange={(value) => {
            setTemplate(value)
            request.current = crypto.randomUUID()
          }}
        />
      </div>
      <p className="text-xs text-slate-500">
        {'{ยอดต้องโอน}'} แสดงยอดรวมพร้อมค่าส่งครั้งเดียว ระบบแนบเลขบัญชีและลิงก์ชำระเงิน
        และยอดที่ตรวจสอบจากบิลให้เสมอ โดยตรวจยอดใหม่ก่อนส่งจริง
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[740px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {['ลูกค้า', 'ยอดต้องโอน', 'โอนแล้ว', 'คงเหลือ', 'ช่องทาง', 'สถานะแจ้งล่าสุด'].map(
                (label) => (
                  <th key={label} className="p-3">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {targets.map((tab) => (
              <tr key={tab.id}>
                <td className="p-3 font-medium">{tab.name}</td>
                <td className="p-3 tabular-nums">฿{money(tab.total)}</td>
                <td className="p-3 tabular-nums">฿{money(tab.paid)}</td>
                <td className="p-3 font-semibold tabular-nums">฿{money(tab.remaining)}</td>
                <td className="p-3 text-xs">
                  แชท Messenger
                  {!tab.canMessage && (
                    <span className="block text-amber-700">ตรวจสิทธิ์ก่อนส่ง</span>
                  )}
                </td>
                <td className="p-3 text-xs">
                  {tab.lastReminder
                    ? stateText[tab.lastReminder.status] || tab.lastReminder.status
                    : 'ยังไม่แจ้ง'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!targets.length && (
          <p className="p-4 text-sm text-slate-500">ไม่มีลูกค้าที่ค้างชำระในตัวเลือกนี้</p>
        )}
      </div>
      <p className="text-sm font-semibold">
        รวม {targets.length} คน • ยอดค้างสุทธิ ฿
        {money(sumMoney(targets.map((tab) => Number(tab.remaining))))}
      </p>
      {targets.map((tab) => (
        <details key={tab.id} className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            พรีวิวข้อความ • {tab.name} • {tabFormula(tab)}
          </summary>
          <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-slate-600">
            {renderSessionFollowup(storeFollowup(template), tab)}
            {`\n\nบัญชีรับเงิน: ${tab.account || 'ตรวจสอบบัญชีรับเงินจากบิลจริง'}\nระบบแนบลิงก์ดูบิลและแนบสลิปจากบิลจริง`}
          </pre>
        </details>
      ))}
      {!validSessionTemplate(storeFollowup(template)) && (
        <p role="alert" className="text-sm text-red-700">
          ใช้ข้อความไม่เกิน 1,500 ตัวอักษร และกดเลือกตัวแปรจากปุ่มใต้ช่องข้อความ
        </p>
      )}
      <p className="text-xs text-slate-500">
        ส่งทีละคน ไม่เกิน 12 คนต่อนาทีต่อเพจ มีรายการรอส่งป้องกันส่งซ้ำ
        และพักรายการที่ส่งไม่ได้หรือไม่ทราบผลส่ง ข้อมูลยอดค้างจะส่งใน Messenger
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={button} disabled={busy} onClick={onClose}>
          ยกเลิก
        </button>
        <button
          type="button"
          className={orange}
          disabled={busy || queued !== null || !targets.length || !validSessionTemplate(storeFollowup(template))}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              const result = await post(
                {
                  action: 'remind',
                  tabIds: scope === 'all' ? null : targets.map((tab) => tab.id),
                  template: storeFollowup(template),
                },
                request.current,
              )
              if (!Number.isSafeInteger(result.queued) || (result.queued ?? 0) < 1) {
                throw new Error('ไม่มีรายการค้างที่เข้าเงื่อนไขส่ง ระบบยังไม่ได้เพิ่มรายการเข้าคิว')
              }
              setQueued(result.queued!)
              setError('')
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'ส่งแจ้งยอดไม่สำเร็จ')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'กำลังเข้าคิว…' : queued !== null ? `เข้าคิวแล้ว ${queued} รายการ` : 'ส่งแจ้งยอด'}
        </button>
      </div>
      {queued !== null && (
        <p role="status" className="text-sm text-emerald-700">
          เข้าคิวแจ้งยอดแล้ว {queued} รายการ ระบบจะตรวจสิทธิ์และส่งข้อความ คุณปิดหน้าต่างนี้ได้ และตรวจผลจากสถานะแจ้งยอด
        </p>
      )}
    </SessionDialog>
  )
}
