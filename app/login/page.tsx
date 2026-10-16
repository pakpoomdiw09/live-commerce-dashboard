import { LoginForm } from '@/components/LoginForm'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { safeAuthNext } from '@/lib/oauth'

// รับเฉพาะ path ภายในเว็บ กัน open redirect (เช่น ?next=//evil.com)
const safeNext = safeAuthNext

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; error_code?: string }>
}) {
  const { next, error, error_code } = await searchParams

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-pink-500 via-rose-400 to-orange-400 p-4 text-slate-900">
      {/* วงกลมเบลอตกแต่งพื้นหลัง */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-white/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-orange-200/30 blur-3xl" />

      {isSupabaseConfigured() ? (
        <LoginForm next={safeNext(next)} oauthError={error_code ?? (error === 'oauth')} />
      ) : (
        <div className="relative max-w-md rounded-2xl bg-white p-6 text-sm shadow-xl">
          <h1 className="mb-2 font-semibold">ยังไม่ได้ตั้งค่า Supabase</h1>
          <p>
            สร้างไฟล์ <code>.env.local</code> ที่โฟลเดอร์รากของโปรเจกต์ แล้วใส่{' '}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> และ <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> จากนั้นหยุดและรัน{' '}
            <code>npm run dev</code> ใหม่
          </p>
        </div>
      )}
    </div>
  )
}
