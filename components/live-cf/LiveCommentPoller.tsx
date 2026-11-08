'use client'

import { useEffect, useRef } from 'react'

/** Polls the selected session in the background while its dashboard is mounted. */
export function LiveCommentPoller({
  pageId,
  sessionId,
  onVideoUnavailable,
}: {
  pageId: string
  sessionId: string
  onVideoUnavailable?: () => void
}) {
  const unavailable = useRef(onVideoUnavailable)
  unavailable.current = onVideoUnavailable
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    const tick = async () => {
      let delay = 2500
      try {
        const response = await fetch('/api/live-cf/auction/poll-comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_id: pageId, session_id: sessionId }),
          signal: controller.signal,
          cache: 'no-store',
        })

        if ([401, 403, 404].includes(response.status)) {
          stopped = true
          return
        }
        if (response.status === 429) {
          delay = 10_000
        } else {
          const data = await response.json().catch(() => null)
          if (data?.reason === 'VIDEO_NOT_ACCESSIBLE') {
            stopped = true
            if (!controller.signal.aborted) unavailable.current?.()
            return
          }
          if (data?.reason === 'SESSION_NOT_FOUND' || data?.reason === 'NO_ACTIVE_ROUND') {
            delay = 10_000
          } else if (!response.ok || !data) {
            delay = 5000
          }
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return
        delay = 5000
      }

      if (!stopped && !controller.signal.aborted) timer = setTimeout(tick, delay)
    }

    void tick()
    return () => {
      stopped = true
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [pageId, sessionId])

  return null
}
