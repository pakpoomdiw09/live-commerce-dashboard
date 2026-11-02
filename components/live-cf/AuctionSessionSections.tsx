'use client'
import { useState, type ReactNode } from 'react'
import {
  sessionMoney,
  sessionCustomerStatus,
  type SessionSnapshot,
  type SessionTab,
} from '@/lib/features/commerce/live-session-types'
import { PaymentProEvidence } from '@/components/slips/PaymentProEvidence'
import { findBank } from '@/lib/features/banking/banks'
import { SessionDialog } from './SessionDialog'
import { button, field, sessionTime } from './session-ui'

const titles: Record<number, string> = {
  1: 'เริ่ม Session และสรุปตัวเลขรายไลฟ์',
  2: 'ผลประมูลแต่ละรอบ',
  3: 'ตั้งค่าอัตโนมัติและควบคุมประมูล',
  4: 'รายชื่อลูกค้า บิลสะสม และสลิป',
  5: 'จัดส่งพัสดุจากบิลที่ชำระครบ',
}
export function AuctionDashboardSection({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: ReactNode
}) {
  return (
    <section
      data-auction-section={number}
      className="min-w-0 space-y-5 rounded-2xl border border-slate-200 p-3 md:p-5"
      aria-label={`ส่วนที่ ${number} ${titles[number]}`}
    >
      <header className="flex items-center gap-3 border-b border-orange-100 pb-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-orange-500 font-bold text-white">
          {number}
        </span>
        <div>
          <h2 className="font-bold text-slate-900">{titles[number]}</h2>
          <p className="text-xs text-slate-500">{title}</p>
        </div>
      </header>
      {children}
    </section>
  )
}
export function SessionRequired() {
  return (
    <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
      เริ่มหรือเลือก Session ด้านบนเพื่อจัดการข้อมูลไลฟ์นี้
    </p>
  )
}
export function SessionEmptyFinance() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {['ต้นทุน (บาท)', 'ค่าแอด (บาท)', 'ค่าส่ง (บาท)'].map((label) => (
          <label className="text-sm font-medium" key={label}>
            {label}
            <input disabled className={field} value="0" readOnly aria-label={label} />
          </label>
        ))}
        <div className="rounded-xl bg-orange-50 p-3 text-sm">
          กำไรสุทธิ (บาท)<p className="mt-2 text-2xl font-bold">0.00</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {[
          'คอมเมนต์ทั้งหมด',
          'ตรงคำดัก / ตรงบิด',
          'คนคอมเมนต์',
          'สลิปที่ผ่าน',
          'ยอดโอนรวม',
          'ยอดที่ยังขาด',
        ].map((label) => (
          <div className="rounded-xl bg-slate-50 p-3" key={label}>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-bold">0</p>
          </div>
        ))}
      </div>
      <SessionRequired />
    </div>
  )
}
export function AuctionSessionEvidence({
  data,
  onProof,
}: {
  data: SessionSnapshot | null
  onProof: (tab: SessionTab) => void
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="font-bold">คนคอมเมนต์ล่าสุด</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                {[
                  'ชื่อ Facebook',
                  'คอมเมนต์',
                  'ชนะประมูล',
                  'บิลสะสม',
                  'ชำระเงิน',
                  'เวลาล่าสุด',
                ].map((label) => (
                  <th className="p-3" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.commenters ?? []).map((person) => {
                const tab = data?.tabs.find((item) => item.customerId === person.customerId)
                const wins =
                  data?.rounds.filter(
                    (round) =>
                      round.winnerId === person.fbId &&
                      round.status === 'closed' &&
                      round.orderStatus !== 'cancelled',
                  ).length ?? 0
                return (
                  <tr key={person.fbId} className="border-t">
                    <td className="break-words p-3">{person.name}</td>
                    <td className="p-3 tabular-nums">{person.comments}</td>
                    <td className="p-3 tabular-nums">{wins} รายการ</td>
                    <td className="p-3">
                      {tab ? (
                        <button
                          type="button"
                          className="font-bold tabular-nums text-orange-600 underline"
                          aria-label={`ดูบิลผู้คอมเมนต์ ${person.name}`}
                          onClick={() => onProof(tab)}
                        >
                          ฿{sessionMoney(tab.total)}
                        </button>
                      ) : (
                        <span className="text-slate-400">ยังไม่มีบิล</span>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {tab ? (
                        Number(tab.remaining) <= 0 ? (
                          <span className="text-emerald-700">โอนครบแล้ว</span>
                        ) : Number(tab.paid) <= 0 ? (
                          `ยังไม่โอน • ขาด ฿${sessionMoney(tab.remaining)}`
                        ) : (
                          `ยอดขาด ฿${sessionMoney(tab.remaining)}`
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap p-3 text-xs">{sessionTime(person.at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!data?.commenters?.length && (
            <p className="p-4 text-sm text-slate-500">ยังไม่มีคอมเมนต์ใน Session นี้</p>
          )}
        </div>
        {(data?.metrics.commenters ?? 0) > 500 && (
          <p className="text-xs text-slate-500">
            แสดงผู้คอมเมนต์ล่าสุด 500 คน จาก {data?.metrics.commenters} คน
          </p>
        )}
      </div>
    </div>
  )
}

export function AuctionSessionSlips({ data }: { data: SessionSnapshot | null }) {
  const [slipId, setSlipId] = useState('')
  return (
    <div className="min-w-0 space-y-4" data-session-slips>
      <div className="space-y-3">
        <h3 className="font-bold">สลิปที่ตรวจผ่านใน Session นี้</h3>
        <p className="text-xs text-slate-500">
          สลิป SlipOK ที่ตรวจผ่านและลงบัญชีในบิลสะสมของ Session นี้
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['เวลาที่โอน', 'ชื่อผู้โอน', 'ยอดเงิน (บาท)', 'ธนาคาร / เลขอ้างอิงสลิป'].map(
                  (label) => (
                    <th key={label} className="p-3">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(data?.slips ?? []).map((slip) => (
                <tr key={slip.id} className="border-t">
                  <td className="whitespace-nowrap p-3 text-xs">
                    <time dateTime={slip.at}>
                      {new Date(slip.at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })}
                      <span className="mt-1 block text-slate-500">
                        {new Date(slip.at).toLocaleDateString('th-TH', {
                          timeZone: 'Asia/Bangkok',
                        })}
                      </span>
                    </time>
                  </td>
                  <td className="p-3">
                    {slip.senderName || 'ไม่ระบุชื่อผู้โอน'}
                    <span className="mt-1 block text-xs text-slate-500">ลูกค้า: {slip.name}</span>
                  </td>
                  <td className="p-3 font-semibold tabular-nums">฿{sessionMoney(slip.amount)}</td>
                  <td className="break-all p-3 text-xs">
                    <span className="mb-1 block font-medium">
                      {findBank(slip.senderBank)?.name ?? slip.senderBank ?? 'ไม่ระบุธนาคาร'}
                    </span>
                    {slip.transRef || '—'}
                    <button
                      type="button"
                      className={`${button} mt-2`}
                      onClick={() => setSlipId(slip.id)}
                    >
                      ดูสลิป
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.slips?.length && (
            <p className="p-4 text-sm text-slate-500">ยังไม่มีสลิปที่ตรวจผ่านใน Session นี้</p>
          )}
        </div>
        {(data?.metrics.slips ?? 0) > 500 && (
          <p className="text-xs text-slate-500">
            แสดง 500 สลิปล่าสุด จาก {data?.metrics.slips} สลิป
          </p>
        )}
      </div>
      {slipId && (
        <SessionDialog title="หลักฐานสลิปที่ตรวจผ่าน" onClose={() => setSlipId('')}>
          <PaymentProEvidence key={slipId} slipId={slipId} />
        </SessionDialog>
      )}
    </div>
  )
}

export function SessionCustomerStatus({ data }: { data: SessionSnapshot | null }) {
  const status = sessionCustomerStatus(data?.tabs ?? [])
  return (
    <div
      data-customer-status-summary
      role="status"
      aria-label="สรุปสถานะลูกค้า Session"
      className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-medium text-slate-800"
    >
      <span>ตรงคำดัก {data?.metrics.matchedPeople ?? '—'} คน</span>
      <span aria-hidden="true">·</span>
      <span>โอนแล้ว {status.paid}</span>
      <span aria-hidden="true">·</span>
      <span>ยังไม่โอน {status.unpaid}</span>
      <span aria-hidden="true">|</span>
      <span className="text-emerald-700">ครบ {status.full} คน</span>
      <span aria-hidden="true">·</span>
      <span className="text-orange-700">ขาด {status.short} คน</span>
      <span aria-hidden="true">·</span>
      <span className="text-blue-700">เกิน {status.over} คน</span>
      <span className="tabular-nums">
        (ยอดรวม {sessionMoney(status.total)} ฿ / ได้รับแล้ว {sessionMoney(status.received)} ฿)
      </span>
    </div>
  )
}
