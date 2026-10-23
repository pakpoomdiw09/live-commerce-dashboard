'use client'
import { useEffect } from 'react'
import { ErrorState } from '@/components/shared/ErrorState'

export default function ImagesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[chatbot/images] render failed', { name: error.name, digest: error.digest })
  }, [error])
  return <ErrorState title="ไม่สามารถแสดงหน้าผู้ช่วยตอบรูปภาพได้" error={error} reset={reset} />
}
