import { AlertTriangle, CheckCircle2, Circle, Clock, XCircle, type LucideIcon } from 'lucide-react'
import type { Tone } from '@/lib/status'
import { cn } from '@/lib/utils'

const TONE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
}

/** Status never relies on color alone: each tone has its own icon too. */
const TONE_ICON: Record<Tone, LucideIcon> = {
  neutral: Circle,
  info: Clock,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
}

export function Badge({ tone = 'neutral', icon = true, className, children }: { tone?: Tone; icon?: boolean; className?: string; children: React.ReactNode }) {
  const Icon = TONE_ICON[tone]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset', TONE[tone], className)}>
      {icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  )
}

/** Plain label chip (customer tags): no status meaning. */
export function Tag({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`ลบแท็ก ${children}`} className="-mr-0.5 rounded text-slate-400 hover:text-slate-700">
          ×
        </button>
      )}
    </span>
  )
}
