import Link from 'next/link'
import { MessagesSquare, Search, Users } from 'lucide-react'
import { Avatar } from '@/components/inbox/Avatar'
import { Badge, Tag } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/card'
import { ORDER_STATUS, ORDER_STATUSES } from '@/lib/status'
import {
  customerDirectoryUrl,
  type CustomerDirectory,
  type CustomerFilters,
} from '@/lib/features/customers/customer-directory'
import { baht, cn, customerName, listTime } from '@/lib/utils'

export type { CustomerListRow } from '@/lib/features/customers/customer-directory'

export function CustomersTable({
  rows,
  tenantName,
  filters,
  total,
  totalPaid,
  page,
  pages,
  tags: allTags,
}: CustomerDirectory & {
  filters: CustomerFilters
  tenantName: string | null
}) {
  const { q: query, status, tag } = filters

  return (
    <div className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
      <PageHeader
        title="จัดการลูกค้า"
        description={`${total.toLocaleString('th-TH')} รายชื่อ${tenantName ? ` ของ ${tenantName}` : ''} · ยอดชำระรวม ${baht(totalPaid)}`}
      />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <form
          action="/customers"
          method="get"
          className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4"
        >
          {tag && <input type="hidden" name="tag" value={tag} />}
          <label className="relative w-full sm:w-72">
            <span className="sr-only">ค้นหาลูกค้า</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="ค้นหาชื่อลูกค้า..."
              className="w-full rounded-lg border border-slate-200 py-2 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
            />
          </label>
          <select
            aria-label="กรองตามสถานะออเดอร์"
            name="status"
            defaultValue={status}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">ทุกสถานะ</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS[s].label}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white">
            ค้นหา / กรอง
          </button>
          <Link href="/customers" className="text-sm text-slate-600">
            ล้างตัวกรอง
          </Link>
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {allTags.map((t) => (
                <Link
                  key={t}
                  href={customerDirectoryUrl(filters, { page: 1, tag: tag === t ? '' : t })}
                  aria-current={tag === t ? 'true' : undefined}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium transition',
                    tag === t
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  )}
                >
                  {t}
                </Link>
              ))}
            </div>
          )}
        </form>

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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center text-slate-500">
                    <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" aria-hidden />
                    {!query && status === 'all' && !tag ? (
                      <div className="space-y-2">
                        <p className="font-semibold text-slate-700">ยังไม่มีรายการลูกค้า</p>
                        <p className="text-sm text-slate-500">
                          เมื่อมีลูกค้าทักแชทหรือสั่งซื้อสินค้า
                          รายชื่อลูกค้าจะปรากฏที่นี่ให้อัตโนมัติ
                        </p>
                      </div>
                    ) : (
                      'ไม่พบลูกค้าที่ตรงเงื่อนไข'
                    )}
                  </td>
                </tr>
              )}
              {rows.map((c) => {
                const st = ORDER_STATUS[c.order_status] ?? ORDER_STATUS.new
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar c={c} className="h-9 w-9 text-sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{customerName(c)}</p>
                          <p className="text-[11px] text-slate-400">
                            PSID ...{c.platform_user_id.slice(-6)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[16rem] px-4 py-3 text-xs text-slate-600">
                      <p>{c.phone ?? <span className="text-slate-400">ไม่มีเบอร์</span>}</p>
                      {c.address && <p className="truncate text-slate-400">{c.address}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-[14rem] flex-wrap gap-1">
                        {c.tags.length ? (
                          c.tags.map((t) => <Tag key={t}>{t}</Tag>)
                        ) : (
                          <span className="text-xs text-slate-300">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <p className="font-medium">{baht(c.paidTotal)}</p>
                      <p className="text-[11px] text-slate-400">{c.paidCount} สลิป</p>
                    </td>
                    <td
                      className="px-4 py-3 text-xs whitespace-nowrap text-slate-500"
                      suppressHydrationWarning
                    >
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
        <nav
          aria-label="หน้ารายชื่อลูกค้า"
          className="flex items-center justify-between border-t border-slate-100 p-4 text-sm"
        >
          <span>
            หน้า {page} / {pages} · ทั้งหมด {total.toLocaleString('th-TH')} รายชื่อ
          </span>
          <div className="flex gap-4">
            {page > 1 && (
              <Link href={customerDirectoryUrl(filters, { page: page - 1 })}>ก่อนหน้า</Link>
            )}
            {page < pages && (
              <Link href={customerDirectoryUrl(filters, { page: page + 1 })}>ถัดไป</Link>
            )}
          </div>
        </nav>
      </div>
    </div>
  )
}
