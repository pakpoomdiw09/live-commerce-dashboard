import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server'
import { listPages, verifiedAdminPages } from '@/lib/facebook-oauth'
import { OAUTH_NEXT_COOKIE, OAUTH_COOKIE_PATH, safeAuthNext, oauthErrorCode } from '@/lib/oauth'

export const runtime = 'nodejs'

function databaseErrorMessage(error: { code: string; message: string }) {
  const suffix = ` (${error.code || 'unknown'})`
  if (error.code === '42501') {
    return 'ฟังก์ชันบันทึกเพจไม่มีสิทธิ์เข้าถึงฐานข้อมูล กรุณารัน supabase/facebook-tenants.sql เวอร์ชันล่าสุดใน SQL Editor' + suffix
  }
  if (['PGRST202', 'PGRST204', '42883', '42703', '42P01'].includes(error.code)) {
    return 'ยังไม่มีฟังก์ชันหรือคอลัมน์สำหรับบันทึกเพจ กรุณารัน supabase/facebook-tenants.sql ให้ครบ' + suffix
  }
  if (['23502', '42P10', '23505'].includes(error.code)) {
    return 'โครงสร้างหรือข้อกำหนดของตาราง tenants ไม่รองรับข้อมูลเพจ กรุณาตรวจสอบ supabase/facebook-tenants.sql' + suffix
  }
  return 'บันทึกเพจไม่สำเร็จ กรุณาให้ผู้ดูแลตรวจสอบฐานข้อมูล' + suffix
}

export async function GET(req: NextRequest) {
  let rememberedNext: string | undefined
  try { rememberedNext = decodeURIComponent(req.cookies.get(OAUTH_NEXT_COOKIE)?.value ?? '') } catch { /* Ignore malformed routing cookies. */ }
  const next = safeAuthNext(req.nextUrl.searchParams.get('next') || rememberedNext, '/select-page')
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, req.url))
    response.cookies.set(OAUTH_NEXT_COOKIE, '', { path: OAUTH_COOKIE_PATH, maxAge: 0, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:' })
    return response
  }
  const done = (params: Record<string, string>) =>
    redirect(`/select-page?${new URLSearchParams(params)}`)
  const fail = (code: string) => redirect(`/login?${new URLSearchParams({ error: 'oauth', error_code: code, next })}`)
  if (req.nextUrl.searchParams.has('error')) {
    const code = oauthErrorCode(req.nextUrl.searchParams.get('error_code') || req.nextUrl.searchParams.get('error'), req.nextUrl.searchParams.get('error_description'))
    console.error('[auth/callback] provider rejected OAuth', { code })
    return fail(code)
  }
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return fail('missing_code')
  let session
  try {
    // Newer auth-js supports concurrent PKCE flows; choose the verifier for this callback.
    const flowId = req.nextUrl.searchParams.get('sb_flow_id')
    const { data, error } = await (await supabaseServer()).auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined)
    if (error || !data.session) {
      const reason = error?.status === 0 || error?.name === 'AuthRetryableFetchError' ? 'auth_connection' : oauthErrorCode(error?.code, error?.message)
      console.error('[auth/callback] code exchange failed', { code: reason, status: error?.status })
      return fail(reason)
    }
    session = data.session
  } catch {
    console.error('[auth/callback] cannot connect to Auth')
    return fail('auth_connection')
  }
  if (!session.provider_token) return redirect(next)
  let pages
  try {
    pages = await verifiedAdminPages(await listPages(session.provider_token))
  } catch {
    return done({ fb_error: 'ดึงข้อมูลเพจจาก Facebook ไม่สำเร็จ กรุณาตรวจสอบสิทธิ์แล้วเชื่อมต่อใหม่' })
  }
  if (!pages.length) return done({ fb_error: 'ไม่พบเพจ กรุณาเลือกเพจและอนุญาตการเข้าถึงใน Facebook' })
  try {
    const { data, error } = await supabaseAdmin().rpc('sync_facebook_tenants', {
      p_user_id: session.user.id,
      p_pages: pages.map((page) => ({ page_id: page.id, page_name: page.name, page_access_token: page.accessToken })),
    })
    if (error) {
      console.error('[facebook-sync] database failed', error.code)
      return done({ fb_error: databaseErrorMessage(error) })
    }
    return next === '/select-page' ? done({ fb: 'connected', pages: String(pages.length), updated: String(data ?? 0) }) : redirect(next)
  } catch {
    return done({ fb_error: 'เชื่อมต่อฐานข้อมูลเพื่อบันทึกเพจไม่สำเร็จ กรุณาตรวจสอบการตั้งค่า Supabase ฝั่งเซิร์ฟเวอร์' })
  }
}
