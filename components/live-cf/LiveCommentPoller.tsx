'use client'

import { useEffect, useRef, useState } from 'react'

type PollState = 'running' | 'stopped' | 'unavailable'

/** Polls the selected session in the background while its dashboard is mounted. */
export function LiveCommentPoller({ pageId, sessionId }: { pageId: string; sessionId: string }) {
  const [state, setState] = useState<PollState>('running')
  const stopped = useRef(false)

  useEffect(() => {
    stopped.current = false
    setState('running')
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
          setState('stopped')
          stopped.current = true
          return
        }
        if (response.status === 429) {
          delay = 10_000
        } else {
          const data = await response.json().catch(() => null)
          if (data?.reason === 'VIDEO_NOT_ACCESSIBLE') {
            setState('unavailable')
            stopped.current = true
            return
          }
          if (data?.reason === 'SESSION_NOT_FOUND' || data?.reason === 'NO_ACTIVE_ROUND') {
            delay = 10_000
          } else if (!response.ok || !data) {
            delay = 5000
          } else {
            setState('running')
          }
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return
        delay = 5000
      }

      if (!stopped.current) timer = setTimeout(tick, delay)
    }

    void tick()
    return () => {
      stopped.current = true
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [pageId, sessionId])

  // Keep the poller mounted and observable to assistive technology without
  // showing comment bodies, counters, or per-poll status in the dashboard.
  return (
    <span
      className="sr-only"
      role="status"
      aria-live="polite"
      data-poller-state={state}
    >
      {state === 'running'
        ? 'Live comment polling is active.'
        : state === 'unavailable'
          ? 'The selected live video is unavailable.'
          : 'Live comment polling is stopped.'}
    </span>
  )
}
