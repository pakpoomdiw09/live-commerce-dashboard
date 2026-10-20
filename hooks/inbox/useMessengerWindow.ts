'use client'

import {useEffect, useState} from 'react'
import {messengerWindow} from '@/lib/features/inbox/inbox-v2'

export function useMessengerWindow(timestamp: string | null | undefined, serverNow?: string) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const serverTime = serverNow ? Date.parse(serverNow) : NaN
    const offset = Number.isFinite(serverTime) ? serverTime - Date.now() : 0
    const tick = () => setNow(Date.now() + offset)
    tick()
    const timer = setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [timestamp, serverNow])
  return messengerWindow(timestamp, now)
}
