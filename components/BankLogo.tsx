import { Landmark } from 'lucide-react'
import { findBank } from '@/lib/banks'
import { cn } from '@/lib/utils'

/** Brand-colored bank mark. Unknown codes get a neutral bank icon. */
export function BankLogo({ code, size = 'md' }: { code: string | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const bank = findBank(code)
  const box = size === 'sm' ? 'h-6 w-6 text-[8px]' : size === 'lg' ? 'h-11 w-11 text-xs' : 'h-8 w-8 text-[10px]'
  if (!bank) {
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500', box)} title={code ?? undefined}>
        <Landmark className="h-1/2 w-1/2" aria-hidden />
      </span>
    )
  }
  return (
    <span
      title={bank.name}
      aria-label={bank.name}
      className={cn('grid shrink-0 place-items-center rounded-full font-bold tracking-tight text-white shadow-sm', box)}
      style={{ backgroundColor: bank.color }}
    >
      {bank.short}
    </span>
  )
}

export function bankName(code: string | null | undefined) {
  return findBank(code)?.name ?? code ?? 'ไม่ทราบธนาคาร'
}
