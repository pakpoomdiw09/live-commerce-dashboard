import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500'

/** A labelled form control with an optional hint underneath. */
export function Field({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

/** Save result / error line under a form. */
export function Notice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg px-4 py-3 text-sm ring-1',
        tone === 'error' ? 'bg-rose-50 text-rose-700 ring-rose-100' : 'bg-emerald-50 text-emerald-700 ring-emerald-100',
      )}
    >
      {children}
    </p>
  )
}

/** Icon tile used in section headers: the brand gradient from the sidebar. */
export function IconTile({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-orange-100 to-pink-100 text-orange-600', className)}>{children}</span>
}
