'use client'

import { useEffect, useState, useTransition } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'

export function BotToggle({ customerId, enabled }: { customerId: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled)
  const [pending, start] = useTransition()

  // follow changes made by another admin (arrive through Realtime)
  useEffect(() => setOn(enabled), [enabled])

  function toggle() {
    const next = !on
    setOn(next) // optimistic
    start(async () => {
      const { error } = await supabaseBrowser().from('customers').update({ bot_enabled: next }).eq('id', customerId)
      if (error) setOn(!next)
    })
  }

  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={toggle}
      disabled={pending}
      className="flex items-center gap-2 rounded text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
    >
      <span className={`h-5 w-9 rounded-full p-0.5 transition-colors ${on ? 'bg-emerald-600' : 'bg-slate-300'}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
      </span>
      {on ? 'บอทตอบอัตโนมัติ: เปิด' : 'บอทตอบอัตโนมัติ: ปิด'}
    </button>
  )
}
