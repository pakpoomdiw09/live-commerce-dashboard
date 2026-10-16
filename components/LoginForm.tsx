'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { FACEBOOK_LOGIN_SCOPES, facebookRedirectTo, rememberOAuthNext, oauthErrorMessage } from '@/lib/oauth'

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07" />
    </svg>
  )
}

export function LoginForm({ next, oauthError }: { next: string; oauthError?: boolean | string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(oauthError ? oauthErrorMessage(typeof oauthError === 'string' ? oauthError : 'oauth') : null)
  const [busy, setBusy] = useState(false)

  async function onFacebook() {
    setBusy(true)
    setError(null)
    try {
      rememberOAuthNext(next)
      const redirectTo = facebookRedirectTo(location.origin)
      const { error } = await supabaseBrowser().auth.signInWithOAuth({
        provider: 'facebook',
        options: { redirectTo, scopes: FACEBOOK_LOGIN_SCOPES },
      })
      if (error) throw error
      // สำเร็จ: browser จะถูกพาไปหน้า Facebook เอง ไม่ต้อง setBusy(false)
    } catch {
      setError('เชื่อมต่อเฟสบุ๊คไม่ได้ ตรวจว่าเปิด Facebook provider ใน Supabase แล้ว')
      setBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password })
      if (error) {
        setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
        return
      }
      router.replace(next)
      router.refresh() // ให้ server components อ่าน cookie ใหม่
    } catch {
      setError('เชื่อมต่อ Supabase ไม่ได้ ตรวจสอบค่าใน .env.local')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative w-full max-w-md rounded-3xl bg-white px-8 py-10 shadow-2xl shadow-rose-900/20">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-orange-400 text-2xl font-bold text-white shadow-lg shadow-rose-300">
          CB
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Chat<span className="bg-gradient-to-r from-pink-500 to-orange-400 bg-clip-text text-transparent">Bot</span>{' '}
          Dashboard
        </h1>
        <p className="mt-2 text-sm text-slate-500">จัดการแชท ตรวจสลิป และบอทของเพจคุณในที่เดียว</p>
      </div>

      <button
        type="button"
        onClick={onFacebook}
        disabled={busy}
        className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#1877F2] px-4 py-3 font-medium text-white shadow-md shadow-blue-200 transition hover:bg-[#166FE5] active:scale-[0.99] disabled:opacity-60"
      >
        <FacebookIcon className="h-5 w-5" />
        {busy ? 'กำลังเชื่อมต่อ…' : 'เริ่มต้นใช้งานด้วยเฟสบุ๊ค'}
      </button>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">{error}</p>}

      <details className="group mt-6">
        <summary className="flex cursor-pointer list-none items-center gap-3 text-xs text-slate-400 select-none">
          <span className="h-px flex-1 bg-slate-200" />
          หรือเข้าสู่ระบบด้วยอีเมล
          <span className="h-px flex-1 bg-slate-200" />
        </summary>
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="อีเมล"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="รหัสผ่าน"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </details>

      <p className="mt-8 text-center text-xs text-slate-400">
        การเข้าสู่ระบบถือว่าคุณยอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว
      </p>
    </div>
  )
}
