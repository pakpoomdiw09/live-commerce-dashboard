'use client'

import './globals.css'
import { ErrorState } from '@/components/shared/ErrorState'

/** Last resort: the root layout itself failed. Must render its own <html>. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="th">
      <body className="flex min-h-dvh bg-slate-50">
        <ErrorState title="แอปโหลดไม่สำเร็จ" error={error} reset={reset} />
      </body>
    </html>
  )
}
