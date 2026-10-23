'use client'
import { PageBanner } from '@/components/ui/page-banner'
import { useRef } from 'react'
import Link from 'next/link'
import { BarChart3, HelpCircle, Settings2, Users, Bot, MessagesSquare } from 'lucide-react'
import type { InboxState } from '@/lib/features/inbox/inbox-types'
export const INBOX_VIEWS = [
  ['all', 'ทั้งหมด'],
  ['unread', 'ยังไม่ได้อ่าน'],
  ['tracked', 'ผลติดตามดาว'],
  ['paid', 'ชำระเงินแล้ว'],
  ['resolved', 'เสร็จสิ้น'],
] as const
export type InboxView =
  | 'all'
  | 'waiting'
  | 'ai'
  | 'mine'
  | 'team'
  | 'overview'
  | 'reports'
  | 'customers'
  | 'security'
  | 'unread'
  | 'progress'
  | 'payment'
  | 'resolved'
  | 'starred'
  | 'tracked'
  | 'paid'
  | 'closed'
  | 'unassigned'
  | 'bot'
export function InboxProCenter({
  inbox,
  view,
  onView,
  assignee,
  onAssignee,
  counts,
  autoReply,
  onBulk,
  compact = false,
}: {
  tenantId: string
  inbox: InboxState | null
  view: InboxView
  onView: (view: InboxView) => void
  assignee: string
  onAssignee: (value: string) => void
  counts: Partial<Record<InboxView, number>>
  autoReply: boolean
  onBulk: () => void
  compact?: boolean
}) {
  const guide = useRef<HTMLDialogElement>(null)
  return (
    <header className="shrink-0 space-y-1 border-b border-slate-200 bg-white px-3 py-1.5">
      <PageBanner as="div" compact className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white">
            <MessagesSquare className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base font-semibold text-white">
              รวมแชท{' '}
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                ศูนย์ดูแลลูกค้า
              </span>
            </h1>
            <p className="truncate text-xs leading-4 text-white">
              {inbox?.pageName || 'พื้นที่ดูแลลูกค้าของร้าน'}
              {inbox && (
                <>
                  {' '}
                  · ยังไม่อ่าน {inbox.conversations.reduce(
                    (sum, c) => sum + c.unread_count,
                    0,
                  )}{' '}
                  ข้อความ
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 text-[11px] text-slate-600 lg:inline-flex">
            <span
              className={
                autoReply
                  ? 'h-1.5 w-1.5 rounded-full bg-emerald-500'
                  : 'h-1.5 w-1.5 rounded-full bg-slate-400'
              }
            />
            ตอบอัตโนมัติ{autoReply ? 'เปิดอยู่' : 'ปิดอยู่'}
          </span>
          <Link
            href="/inbox/reports"
            title="ภาพรวมและรายงานทีม"
            aria-label="ภาพรวมและรายงานทีม"
            className="rounded-xl p-2 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <BarChart3 className="h-4 w-4" />
          </Link>
          <button
            type="button"
            title="คู่มือการใช้งาน"
            aria-label="คู่มือการใช้งาน"
            className="rounded-xl p-2 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={() => guide.current?.showModal()}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <Link
            href="/chatbot/conversations"
            aria-label="ตั้งค่า ผู้ช่วยอัจฉริยะ"
            title="ตั้งค่า ผู้ช่วยอัจฉริยะ"
            className="rounded-xl p-2 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Settings2 className="h-4 w-4" />
          </Link>
        </div>
      </PageBanner>
      <div
        className={
          compact
            ? 'hidden md:flex md:flex-wrap md:items-center md:gap-x-3 md:gap-y-1'
            : 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1'
        }
      >
        <nav
          aria-label="ส่วนการทำงานของกล่องข้อความ"
          className="flex min-w-0 max-w-full flex-1 basis-full gap-1 lg:basis-96 overflow-x-auto pb-0.5"
        >
          {INBOX_VIEWS.map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-current={view === key ? 'page' : undefined}
              onClick={() => onView(key)}
              className={
                view === key
                  ? 'flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800'
                  : 'flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50'
              }
            >
              {label}
              <span className="rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] tabular-nums">
                {counts[key] ?? '—'}
              </span>
            </button>
          ))}
        </nav>
        <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <select
            aria-label="ช่องทางแชท"
            className="h-9 min-w-0 rounded-lg md:h-8 md:max-w-28 border border-slate-200 bg-white px-3 text-xs text-slate-600"
          >
            <option value="all">ทุกช่องทาง</option>
            <option value="facebook">แชทผ่านเฟซบุ๊ก</option>
          </select>
          <select
            aria-label="กรองผู้รับผิดชอบ"
            value={assignee}
            onChange={(e) => onAssignee(e.target.value)}
            className="h-9 min-w-0 rounded-lg md:h-8 md:max-w-28 border border-slate-200 bg-white px-3 text-xs text-slate-600"
          >
            <option value="all">ผู้ดูแลทั้งหมด</option>
            <option value="unassigned">ยังไม่มอบหมาย</option>
            {inbox?.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            aria-label="กรองตามสถานะ"
            value={view}
            onChange={(e) => onView(e.target.value as InboxView)}
            className="h-9 min-w-0 rounded-lg md:h-8 md:max-w-28 border border-slate-200 bg-white px-3 text-xs text-slate-600"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="unread">ยังไม่ได้อ่าน</option>
            <option value="tracked">ผลติดตามดาว</option>
            <option value="waiting">รอตอบ</option>
            <option value="progress">กำลังดูแล</option>
            <option value="paid">ชำระเงินแล้ว</option>
            <option value="resolved">เสร็จสิ้น</option>
            <option value="starred">ติดดาว</option>
            <option value="mine">ของฉัน</option>
            <option value="ai">ระบบอัตโนมัติดูแล</option>
            <option value="closed">ปิดแล้ว</option>
          </select>
          {inbox?.proEnabled && (
            <button
              type="button"
              onClick={onBulk}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg md:h-8 border border-orange-200 bg-orange-50 px-3 text-xs font-medium text-orange-700"
            >
              <Users className="h-4 w-4" />
              มอบหมายแชท
            </button>
          )}
        </div>
      </div>
      <p className="sr-only">
        <Bot />
        ผู้ช่วยร่างข้อความ{inbox?.aiAllowed ? 'อยู่ในแพ็กเกจนี้' : 'ยังไม่อยู่ในแพ็กเกจนี้'}{' '}
        การสรุปแชทและแนะนำสินค้ายังไม่เชื่อมต่อ
      </p>
      <dialog
        ref={guide}
        aria-labelledby="inbox-guide-title"
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-900/40"
      >
        <h2 id="inbox-guide-title" className="font-semibold">
          คู่มือดูแลแชท
        </h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7">
          <li>เลือกกลุ่มแชทและเลือกลูกค้าที่ต้องการดูแล</li>
          <li>ระบบอัตโนมัติจะหยุดทำงานทันทีเมื่อแอดมินกดรับช่วงดูแลแชท</li>
          <li>
            ใช้ไอคอนใต้ช่องพิมพ์เพื่อแนบไฟล์ เลือกคำตอบที่บันทึกไว้ หรือให้ผู้ช่วยร่างข้อความ
            แล้วตรวจทานก่อนส่ง
          </li>
          <li>ดูข้อมูลลูกค้า ออเดอร์ และสลิปในรายละเอียดด้านขวา ส่วนสถิติอยู่ที่หน้ารายงานทีม</li>
        </ol>
        <button
          type="button"
          className="mt-5 rounded-xl bg-orange-500 px-4 py-2.5 text-sm text-white"
          onClick={() => guide.current?.close()}
        >
          ปิดคู่มือ
        </button>
      </dialog>
    </header>
  )
}
