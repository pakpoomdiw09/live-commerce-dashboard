import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** KPI tile: label, one big number, a short footnote. Same look as the overview tiles. */
export function StatTile({
  icon: Icon,
  label,
  value,
  foot,
  href,
}: {
  icon: LucideIcon
  label: string
  value: string
  foot: string
  href?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{foot}</p>
    </>
  )
  const cls = 'block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
  return href ? (
    <Link href={href} className={cn(cls, 'transition hover:border-slate-300 hover:shadow-md')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
