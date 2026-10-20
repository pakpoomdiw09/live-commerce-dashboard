'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/shared/ErrorState'

export default function ConversationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[chatbot/conversations] page render failed', error)
  }, [error])

  return <ErrorState title="โหลดหน้าจัดการบทสนทนาไม่สำเร็จ" error={error} reset={reset} />
}
