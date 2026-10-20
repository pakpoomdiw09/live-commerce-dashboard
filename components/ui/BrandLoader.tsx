'use client'

import { FallbackImg } from '@/components/ui/FallbackImg'
import { cn } from '@/lib/utils'

/**
 * Brand loading state with an animated 64x64 spinner and caption.
 * Falls back to a CSS spinner if the public GIF cannot load.
 */
export function BrandLoader({ label = 'กำลังโหลดข้อมูลระบบ...', className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex flex-col items-center justify-center gap-3 py-10', className)}>
      <FallbackImg
        src="/brand-loader.gif"
        size={64}
        className="h-16 w-16 object-contain"
        fallback={<span aria-hidden className="h-16 w-16 animate-spin rounded-full border-4 border-orange-200 border-t-orange-500" />}
      />
      <p className="text-sm font-medium text-orange-600">{label}</p>
    </div>
  )
}
