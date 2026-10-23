'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiError } from '@/lib/utils'

export type WorkspaceAction = 'note' | 'star' | 'unstar' | 'followup' | 'unfollowup'
export type InboxWorkspace = {
  starred: boolean
  followedUp: boolean
  followUpAvailable: boolean
  lastInboundAt: string | null
  humanAgentAvailable?: boolean
  serverNow?: string
  notes: { id: string; body: string; actor_id: string | null; created_at: string }[]
}

export function useInboxWorkspace(customerId: string | null, poll = true) {
  const [data, setData] = useState<InboxWorkspace | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const session = useRef<object | null>(null)
  const locked = useRef(false)
  const sequence = useRef(0)
  const pending = useRef<{ action: WorkspaceAction; body: string; requestId: string } | null>(null)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    session.current = {}
    locked.current = false
    pending.current = null
    setData(null)
    setError('')
    setBusy(false)
    return () => {
      session.current = null
    }
  }, [customerId])

  useEffect(() => {
    if (!customerId) return
    const controller = new AbortController()
    const request = ++sequence.current
    void (async () => {
      try {
        const response = await fetch(`/api/inbox/conversations/${customerId}/workspace`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(await apiError(response))
        const value = await response.json()
        if (!value || typeof value.starred !== 'boolean' || !Array.isArray(value.notes))
          throw new Error('ข้อมูลแชทไม่สมบูรณ์ กรุณาโหลดอีกครั้ง')
        if (!controller.signal.aborted && request === sequence.current && !locked.current) {
          setData({
            ...value,
            followedUp: value.followedUp === true,
            followUpAvailable: value.followUpAvailable === true,
          })
          setError('')
        }
      } catch (error) {
        if (!controller.signal.aborted && request === sequence.current)
          setError(error instanceof Error ? error.message : 'โหลดข้อมูลแชทไม่สำเร็จ')
      }
    })()
    return () => controller.abort()
  }, [customerId, revision])

  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<string>).detail === customerId) refresh()
    }
    window.addEventListener('inbox:workspace', update)
    const timer =
      poll && customerId
        ? setInterval(() => {
            if (document.visibilityState === 'visible') refresh()
          }, 120000)
        : null
    return () => {
      window.removeEventListener('inbox:workspace', update)
      if (timer) clearInterval(timer)
    }
  }, [customerId, poll, refresh])

  async function save(action: WorkspaceAction, body = '') {
    if (!customerId || !data || locked.current) return false
    if (action === 'note' && (!body.trim() || body.trim().length > 2000)) {
      setError('กรุณาใส่โน้ตไม่เกิน 2,000 ตัวอักษร')
      return false
    }
    const currentSession = session.current
    locked.current = true
    sequence.current++
    setBusy(true)
    setError('')
    const text = action === 'note' ? body.trim() : ''
    if (!pending.current || pending.current.action !== action || pending.current.body !== text)
      pending.current = { action, body: text, requestId: crypto.randomUUID() }
    try {
      const response = await fetch(`/api/inbox/conversations/${customerId}/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      if (!response.ok) {
        if (response.status < 500) pending.current = null
        throw new Error(await apiError(response))
      }
      if (session.current !== currentSession) return false
      pending.current = null
      setData(
        (previous) =>
          previous && {
            ...previous,
            starred: action === 'star' ? true : action === 'unstar' ? false : previous.starred,
            followedUp:
              action === 'followup' ? true : action === 'unfollowup' ? false : previous.followedUp,
          },
      )
      if (action === 'star' || action === 'unstar') window.dispatchEvent(new Event('inbox:stars'))
      if (action === 'followup' || action === 'unfollowup')
        window.dispatchEvent(new Event('inbox:follow-ups'))
      window.dispatchEvent(new CustomEvent('inbox:workspace', { detail: customerId }))
      return true
    } catch (error) {
      if (session.current === currentSession)
        setError(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง')
      return false
    } finally {
      if (session.current === currentSession) {
        locked.current = false
        setBusy(false)
      }
    }
  }
  return { data, error, busy, refresh, save }
}
