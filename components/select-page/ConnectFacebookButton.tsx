'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import {
  FACEBOOK_SCOPES,
  facebookRedirectTo,
  rememberOAuthNext,
  oauthErrorCode,
  oauthErrorMessage,
} from '@/lib/oauth'

export { FACEBOOK_SCOPES } from '@/lib/oauth'

export function ConnectFacebookButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function connect() {
    setBusy(true)
    setError(null)
    try {
      rememberOAuthNext('/select-page')
      const { error } = await supabaseBrowser().auth.signInWithOAuth({
        provider: 'facebook',
        options: { scopes: FACEBOOK_SCOPES, redirectTo: facebookRedirectTo(location.origin) },
      })
      if (error) throw error
    } catch (cause) {
      const failure = cause as { code?: string; message?: string }
      setError(oauthErrorMessage(oauthErrorCode(failure.code, failure.message)))
      setBusy(false)
    }
  }
  return (
    <div className="h-full">
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="flex h-full min-h-48 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/60 text-white transition hover:bg-white/10 disabled:opacity-60"
      >
        <span className="grid h-14 w-14 place-items-center rounded-full bg-white/20">
          <Plus className="h-7 w-7" aria-hidden />
        </span>
        <span className="text-sm font-medium">
          {busy ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อเพจด้วย Facebook'}
        </span>
      </button>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-white p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  )
}
