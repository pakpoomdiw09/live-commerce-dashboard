'use client'
import { useEffect, useRef, useState } from 'react'
import type { InboxMember } from '@/lib/features/inbox/inbox-types'
import { apiError, when } from '@/lib/utils'
type Data = {
  starred: boolean
  lastInboundAt: string | null
  notes: { id: string; body: string; actor_id: string | null; created_at: string }[]
}
export function WorkspaceTools({
  customerId,
  members,
}: {
  customerId: string
  members: InboxMember[]
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(0)
  const lock = useRef(false),
    pending = useRef<{ action: string; body: string; requestId: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    void fetch(`/api/inbox/conversations/${customerId}/workspace`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await apiError(res))
        const next = await res.json()
        if (!controller.signal.aborted) setData(next)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [customerId, tick])
  async function save(action: string) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    const body = text.trim()
    if (!pending.current || pending.current.action !== action || pending.current.body !== body)
      pending.current = { action, body, requestId: crypto.randomUUID() }
    try {
      const res = await fetch(`/api/inbox/conversations/${customerId}/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      if (!res.ok) throw new Error(await apiError(res))
      pending.current = null
      if (action !== 'note') window.dispatchEvent(new Event('inbox:stars'))
      setText('')
      setTick((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3 text-sm">
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
        โน้ตสำหรับทีมในร้านเท่านั้น ลูกค้าจะไม่เห็นข้อความนี้
      </p>
      {!data && !error && <p>กำลังโหลดโน้ต…</p>}
      {error && (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      )}
      <label className="block text-xs text-slate-500">
        เพิ่มโน้ตภายใน
        <textarea
          aria-label="โน้ตภายใน"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={3}
          className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm"
        />
      </label>
      <button
        disabled={!data || busy || !text.trim()}
        onClick={() => void save('note')}
        className="rounded-xl bg-orange-500 px-4 py-2 text-xs text-white disabled:opacity-50"
      >
        {busy ? 'กำลังบันทึก…' : 'บันทึกโน้ต'}
      </button>
      {data?.notes.length === 0 && <p className="text-xs text-slate-400">ยังไม่มีโน้ตภายใน</p>}
      {data?.notes.map((note) => (
        <article key={note.id} className="rounded-xl border border-slate-100 bg-white p-3">
          <p className="whitespace-pre-wrap break-words">{note.body}</p>
          <p className="mt-2 text-[11px] text-slate-400">
            {members.find((m) => m.id === note.actor_id)?.name || 'อดีตผู้ดูแล'} ·{' '}
            {when(note.created_at)}
          </p>
        </article>
      ))}
      {(data?.notes.length ?? 0) >= 50 && (
        <p className="text-xs text-slate-400">แสดงโน้ตล่าสุด 50 รายการ</p>
      )}
    </section>
  )
}
