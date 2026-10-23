'use client'

import { useState } from 'react'
import { cn, customerName } from '@/lib/utils'

const COLORS = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
]

/** Keep initials visible when a profile picture is missing or expired. */
export function Avatar({
  c,
  className = 'h-10 w-10 text-sm',
}: {
  c: {
    id: string
    display_name: string | null
    platform_user_id: string
    avatar_url?: string | null
  }
  className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = typeof c.avatar_url === 'string' ? c.avatar_url.trim() : ''
  const picture = url.startsWith('https://') ? url : null
  const hash = Array.from(c.id).reduce((h, ch) => h + ch.charCodeAt(0), 0)
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white',
        COLORS[hash % COLORS.length],
        className,
      )}
    >
      {Array.from(customerName(c))[0]}
      {picture && failedUrl !== picture && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={picture}
          src={picture}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedUrl(picture)}
        />
      )}
    </span>
  )
}
