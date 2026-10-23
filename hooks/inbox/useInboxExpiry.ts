'use client'

import { useEffect, useRef, useState } from 'react'
import { apiError } from '@/lib/utils'

export function useInboxExpiry(
  customerId: string | null,
  expired: boolean,
  inboundAt: string | null | undefined,
  onChange: () => Promise<void>,
) {
  const [error, setError] = useState('')
  const change = useRef(onChange)
  useEffect(() => {
    change.current = onChange
  }, [onChange])
  useEffect(() => {
    setError('')
    if (!customerId || !expired) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    async function sync() {
      try {
        const response = await fetch(`/api/inbox/conversations/${customerId}/expiry`, {
          method: 'POST',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(await apiError(response))
        if (controller.signal.aborted) return
        setError('')
        await change.current()
        // A successful idempotent expiry needs no further writes for this inbound.
        return
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'ยังบันทึกสถานะปิด AI ไม่ได้ ระบบจะลองใหม่',
          )
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void sync(), Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)))
    }
    void sync()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [customerId, expired, inboundAt])
  return error
}
