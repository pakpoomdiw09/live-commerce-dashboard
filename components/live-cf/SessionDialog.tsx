'use client'
import { useEffect, useId, useRef, type ReactNode } from 'react'

export function SessionDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    const overflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/50"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white p-5">
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        <button
          type="button"
          disabled={busy}
          aria-label="ปิดหน้าต่าง"
          onClick={onClose}
          className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
        >
          ✕
        </button>
      </header>
      <div className="space-y-5 p-5">{children}</div>
    </dialog>
  )
}
