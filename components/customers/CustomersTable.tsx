'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { MessagesSquare, Search, Users } from 'lucide-react'
import { Avatar } from '@/components/inbox/Avatar'
import { Badge, Tag } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/card'
import { ORDER_STATUS, ORDER_STATUSES } from '@/lib/status'
import type { CustomerRow, OrderStatus } from '@/lib/types'
import { baht, cn, customerName, listTime } from '@/lib/utils'

export type CustomerListRow = CustomerRow & { paidTotal: number; paidCount: number }

export function CustomersTable({ rows, tenantName }: { rows: CustomerListRow[]; tenantName: string | null }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [tag, setTag] = useState<string | null>(null)

  const allTags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].sort(), [rows])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (status === 'all' || r.order_status === status) &&
        (!tag || r.tags.includes(tag)) &&
        (!q || customerName(r).toLowerCase().includes(q) || (r.phone ?? '').includes(q) || (r.address ?? '').toLowerCase().includes(q)),
    )
  }, [rows, query, status, tag])

  const totalPaid = rows.reduce((s, r) => s + r.paidTotal, 0)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <PageHeader
        title="จัดการลูกค้า"
        description={`${rows.length.toLocaleString('th-TH')} รายชื่อ${tenantName ? ` ของ ${tenantName}` : ''} · ยอดชำระรวม ${baht(totalPaid)}`}
      />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <label className="relative w-full sm:w-72">
            <span className="sr-only">ค้นหาลูกค้า</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อลูกค้า..."
              className="w-full rounded-lg border border-slate-200 py-2 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
            />
          </label>
          <select
            aria-label="กรองตามสถานะออเดอร์"
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderStatus | 'all')}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">ทุกสถานะ</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS[s].label}
              </option>
            ))}
          </select>
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tag === t}
                  onClick={() => setTag(tag === t ? null : t)}
                  className={cn('rounded-md px-2 py-1 text-xs font-medium transition', tag === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-slate-50/80 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">ลูกค้า</th>
                <th className="px-4 py-3 font-medium">ติดต่อ</th>
                <th className="px-4 py-3 font-medium">แท็ก</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
                <th className="px-4 py-3 text-right font-medium">ยอดชำระสะสม</th>
                <th className="px-4 py-3 font-medium">ล่าสุด</th>
                <th className="px-4 py-3">
                  <span className="sr-only">เปิดแชท</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center text-slate-500">
                    <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" aria-hidden />
                    {rows.length === 0 ? (
                      <div className="space-y-2">
                        <p className="font-semibold text-slate-700">ยังไม่มีรายการลูกค้า</p>
                        <p className="text-sm text-slate-500">เมื่อมีลูกค้าทักแชทหรือสั่งซื้อสินค้า รายชื่อลูกค้าจะปรากฏที่นี่ให้อัตโนมัติ</p>
                      </div>
                    ) : 'ไม่พบลูกค้าที่ตรงเงื่อนไข'}
                  </td>
                </tr>
              )}
              {visible.map((c) => {
                const st = ORDER_STATUS[c.order_status] ?? ORDER_STATUS.new
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar c={c} className="h-9 w-9 text-sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{customerName(c)}</p>
                          <p className="text-[11px] text-slate-400">PSID ...{c.platform_user_id.slice(-6)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[16rem] px-4 py-3 text-xs text-slate-600">
                      <p>{c.phone ?? <span className="text-slate-400">ไม่มีเบอร์</span>}</p>
                      {c.address && <p className="truncate text-slate-400">{c.address}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-[14rem] flex-wrap gap-1">
                        {c.tags.length ? c.tags.map((t) => <Tag key={t}>{t}</Tag>) : <span className="text-xs text-slate-300">-</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <p className="font-medium">{baht(c.paidTotal)}</p>
                      <p className="text-[11px] text-slate-400">{c.paidCount} สลิป</p>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500" suppressHydrationWarning>
                      {c.last_message_at ? listTime(c.last_message_at) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/inbox?customer=${c.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
                        เปิดแชท
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
