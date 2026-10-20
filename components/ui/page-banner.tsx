import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function PageBanner({ as: Container = 'header', compact = false, className, ...props }: HTMLAttributes<HTMLElement> & { as?: 'header' | 'div'; compact?: boolean }) {
  return (
    <Container
      {...props}
      data-page-banner=""
      className={cn(
        'min-w-0 bg-gradient-to-r from-orange-500 via-orange-600 to-rose-400 text-white',
        compact ? 'rounded-2xl p-3' : 'rounded-3xl p-5 sm:p-6',
        className,
      )}
    />
  )
}
