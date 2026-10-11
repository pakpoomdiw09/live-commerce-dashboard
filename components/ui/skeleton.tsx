import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-slate-200/70', className)} />
}

/** Screen-reader text for a loading region; pair with aria-busy on the container. */
export function LoadingLabel({ children = 'กำลังโหลด...' }: { children?: string }) {
  return <span className="sr-only">{children}</span>
}
