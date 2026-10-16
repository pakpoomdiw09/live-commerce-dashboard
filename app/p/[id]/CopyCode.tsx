'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** The order code, tap to copy before switching to Messenger. */
export function CopyCode({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {})
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 font-mono font-semibold text-slate-900 ring-1 ring-slate-200"
      aria-label={`คัดลอก ${text}`}
    >
      {text}
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
    </button>
  )
}
