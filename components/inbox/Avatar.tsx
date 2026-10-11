import { cn, customerName } from '@/lib/utils'

const COLORS = ['bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500']

/** Initials avatar: Messenger profile pictures need an extra Graph API call and their URLs expire. */
export function Avatar({ c, className = 'h-10 w-10 text-sm' }: { c: { id: string; display_name: string | null; platform_user_id: string }; className?: string }) {
  const hash = Array.from(c.id).reduce((h, ch) => h + ch.charCodeAt(0), 0)
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-full font-semibold text-white', COLORS[hash % COLORS.length], className)}>
      {Array.from(customerName(c))[0]}
    </span>
  )
}
