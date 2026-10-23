'use client'

import { PageBanner } from '@/components/ui/page-banner'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import type { CommentRule } from '@/lib/features/comments/comment-rules'
import type { PageProfile } from '@/lib/integrations/facebook/client'
import { ICONS, Icon } from '@/components/ui/Icon'
import { Switch } from '@/components/ui/Switch'

export type RuleRow = CommentRule & { comments: { count: number }[] }

const th = 'px-4 py-3 font-semibold whitespace-nowrap'
const off = <span className="text-xs text-slate-400">ปิด</span>

export function RulesTable({ initial, pages }: { initial: RuleRow[]; pages: PageProfile[] }) {
  const db = useMemo(() => supabaseBrowser(), [])
  const [rows, setRows] = useState(initial)
  const [query, setQuery] = useState('')
  const [pageFilter, setPageFilter] = useState('all')

  const pageName = (id: string) => pages.find((p) => p.id === id)?.name ?? `เพจ ${id}`
  const q = query.trim().toLowerCase()
  const visible = rows.filter(
    (r) =>
      (pageFilter === 'all' || r.page_ids.includes(pageFilter)) &&
      (!q ||
        [r.name, ...r.keywords, ...r.page_ids.map(pageName)].some((s) =>
          s.toLowerCase().includes(q),
        )),
  )

  async function setActive(rule: RuleRow, next: boolean) {
    setRows((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: next } : r))) // optimistic
    const { error } = await db.from('comment_rules').update({ is_active: next }).eq('id', rule.id)
    if (error) {
      setRows((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: !next } : r)))
      alert(`เปลี่ยนสถานะไม่สำเร็จ: ${error.message}`)
    }
  }

  async function remove(rule: RuleRow) {
    if (!confirm(`ลบกฎ "${rule.name}" ใช่ไหม?`)) return
    const { error } = await db.from('comment_rules').delete().eq('id', rule.id)
    if (error) return alert(`ลบไม่สำเร็จ: ${error.message}`)
    setRows((prev) => prev.filter((r) => r.id !== rule.id))
  }

  return (
    <div className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
      <PageBanner className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ตอบกลับคอมเมนต์</h1>
          <p className="mt-1 text-sm leading-6 text-white">
            ตั้งกฎให้ระบบตอบใต้คอมเมนต์ และส่งข้อความเข้าอินบ็อกซ์ของลูกค้าอัตโนมัติ
          </p>
        </div>
        <Link
          href="/comment-replies/new"
          className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-orange-700 shadow-sm transition hover:bg-orange-50 active:scale-95"
        >
          <Icon d={ICONS.plus} className="h-4 w-4" />
          เพิ่มใหม่
        </Link>
      </PageBanner>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">ค้นหากฎ</span>
          <Icon
            d={ICONS.search}
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาจากชื่อกฎ คีย์เวิร์ด หรือชื่อเพจ"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-500/20 focus:outline-none"
          />
        </label>
        <select
          value={pageFilter}
          onChange={(e) => setPageFilter(e.target.value)}
          aria-label="กรองตามเพจ"
          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-red-400 focus:ring-2 focus:ring-red-500/20 focus:outline-none"
        >
          <option value="all">ทุกเพจ</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          {visible.length} จาก {rows.length} กฎ
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className={th}>ชื่อข้อความตอบกลับคอมเมนต์</th>
                <th className={th}>ช่องทาง</th>
                <th className={th}>ข้อความจากลูกค้า</th>
                <th className={th}>ข้อความตอบกลับคอมเมนต์</th>
                <th className={th}>ข้อความส่งเข้าอินบ็อกซ์</th>
                <th className={`${th} text-center`}>เปิดใช้งาน</th>
                <th className={`${th} text-right`}>
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center">
                    <p className="text-sm text-slate-500">
                      {rows.length ? 'ไม่พบกฎที่ค้นหา' : 'ยังไม่มีกฎตอบกลับคอมเมนต์'}
                    </p>
                    {!rows.length && (
                      <Link
                        href="/comment-replies/new"
                        className="mt-3 inline-block text-sm font-semibold text-red-600 hover:underline"
                      >
                        + สร้างกฎแรก
                      </Link>
                    )}
                  </td>
                </tr>
              )}
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className={`align-top transition-colors hover:bg-slate-50/70 ${r.is_active ? '' : 'opacity-60'}`}
                >
                  <td className="max-w-56 px-4 py-4">
                    <p className="font-medium text-slate-900">{r.name}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      ตอบไปแล้ว {r.comments[0]?.count ?? 0} ครั้ง
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {r.page_ids.map((id) => (
                        <span
                          key={id}
                          className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-100"
                        >
                          {pageName(id)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="max-w-60 px-4 py-4">
                    <p className="mb-1 text-[11px] font-medium text-slate-400">
                      {r.match_type === 'exact' ? 'ตรงทั้งประโยค' : 'มีคีย์เวิร์ด'}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {r.keywords.slice(0, 4).map((k) => (
                        <span
                          key={k}
                          className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                        >
                          {k}
                        </span>
                      ))}
                      {r.keywords.length > 4 && (
                        <span className="px-1 text-xs text-slate-400">
                          +{r.keywords.length - 4}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-64 px-4 py-4">
                    {r.reply_enabled ? (
                      <p className="line-clamp-2 text-slate-700">{r.reply_text}</p>
                    ) : (
                      off
                    )}
                  </td>
                  <td className="max-w-64 px-4 py-4">
                    {!r.inbox_enabled ? (
                      off
                    ) : r.inbox_type === 'image' && r.inbox_image_url ? (
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.inbox_image_url}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover ring-1 ring-slate-200"
                        />
                        <span className="text-xs text-slate-500">รูปภาพ</span>
                      </div>
                    ) : (
                      <p className="line-clamp-2 text-slate-700">{r.inbox_text}</p>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <Switch
                      checked={r.is_active}
                      onChange={(next) => setActive(r, next)}
                      label={`เปิดใช้งานกฎ ${r.name}`}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-1">
                      <Link
                        href={`/comment-replies/${r.id}`}
                        aria-label={`แก้ไข ${r.name}`}
                        title="แก้ไข"
                        className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        <Icon d={ICONS.edit} className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        aria-label={`ลบ ${r.name}`}
                        title="ลบ"
                        className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Icon d={ICONS.trash} className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
