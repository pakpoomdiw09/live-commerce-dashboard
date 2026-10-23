import { AuthExperience } from '@/components/auth/AuthExperience'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { safeAuthNext } from '@/lib/oauth'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string
    error?: string
    error_code?: string
    lang?: string
    registered?: string
    password_reset?: string
  }>
}) {
  const { next, error, error_code, lang, registered, password_reset } = await searchParams
  const locale = lang === 'en' ? 'en' : 'th'

  if (!isSupabaseConfigured()) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fff9f5] p-6 text-slate-900">
        <section className="max-w-lg rounded-3xl border border-orange-100 bg-white p-8 shadow-xl shadow-orange-900/5">
          <h1 className="text-xl font-bold">
            {locale === 'en'
              ? 'Authentication is not configured'
              : 'ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {locale === 'en'
              ? 'Please ask your administrator to configure the existing Supabase connection.'
              : 'กรุณาติดต่อผู้ดูแลระบบเพื่อตรวจสอบการเชื่อมต่อระบบบัญชีผู้ใช้'}
          </p>
        </section>
      </main>
    )
  }

  return (
    <AuthExperience
      mode="login"
      next={safeAuthNext(next)}
      locale={locale}
      oauthError={error_code ?? (error === 'oauth' ? 'oauth' : undefined)}
      notice={
        registered === '1' ? 'registered' : password_reset === '1' ? 'password_reset' : undefined
      }
    />
  )
}
