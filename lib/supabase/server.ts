import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireSupabaseEnv } from './env'

/** Service role: bypasses RLS. Webhooks and trusted API routes only. */
export const supabaseAdmin = () => {
  const { url } = requireSupabaseEnv()
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!serviceKey) throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY ใน .env.local')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  })
}

/** The signed-in staff member's session (cookie based), for server components and routes. */
export async function supabaseServer() {
  const { url, anonKey } = requireSupabaseEnv()
  const store = await cookies()
  return createServerClient(url, anonKey, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch {
          // called from a server component: cookies are read-only there, safe to ignore
          // (middleware.ts refreshes the session instead)
        }
      },
    },
  })
}
