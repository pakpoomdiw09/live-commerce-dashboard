import { AuthExperience } from '@/components/auth/AuthExperience'
import { safeAuthNext } from '@/lib/oauth'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; lang?: string }>
}) {
  const { next, lang } = await searchParams
  if (!isSupabaseConfigured()) {
    return <main className="grid min-h-screen place-items-center bg-[#fff9f5] p-6 text-slate-900"><p className="rounded-2xl bg-white p-6 shadow">{lang === 'en' ? 'Account service is not configured.' : 'ระบบบัญชีผู้ใช้ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ'}</p></main>
  }
  return <AuthExperience mode="register" next={safeAuthNext(next)} locale={lang === 'en' ? 'en' : 'th'}/>
}
