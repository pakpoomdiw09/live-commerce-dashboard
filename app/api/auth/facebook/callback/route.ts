import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { callbackUrl, exchangeCode, listPages, verifiedAdminPages, STATE_COOKIE, STATE_COOKIE_PATH, subscribePage } from '@/lib/facebook-oauth'
import { supabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * GET ?code=&state=: Facebook sends the user back here.
 * Only Graph-verified Page administrators are synchronized. New Pages create a tenant;
 * existing Pages add the verified user as another owner without duplicating the shop.
 */
export async function GET(req: NextRequest) {
  // redirect back to whichever host served this request (localhost:3000 locally, the deployment otherwise)
  const origin = req.nextUrl.origin
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(new URL(`/select-page?${new URLSearchParams(params)}`, origin))
    res.cookies.delete({ name: STATE_COOKIE, path: STATE_COOKIE_PATH })
    return res
  }
  const fail = (message: string) => done({ fb_error: message })

  const q = req.nextUrl.searchParams
  if (q.get('error')) return fail(q.get('error_reason') === 'user_denied' ? 'ยกเลิกการเชื่อมต่อเพจ' : (q.get('error_description') ?? 'Facebook ปฏิเสธการเชื่อมต่อ'))
  const code = q.get('code')
  const state = q.get('state')
  if (!code || !state || state !== req.cookies.get(STATE_COOKIE)?.value) return fail('ลิงก์เชื่อมต่อหมดอายุหรือไม่ถูกต้อง ลองกดเชื่อมต่อใหม่')

  const actor = await getActor()
  if (!actor || actor.kind !== 'user') return NextResponse.redirect(new URL('/login?next=/select-page', origin))

  let pages
  try {
    pages = await verifiedAdminPages(await listPages(await exchangeCode(code, callbackUrl(origin))))
  } catch (e) {
    console.error('[fb-connect] token exchange failed', e)
    return fail(`แลก token กับ Facebook ไม่สำเร็จ: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  if (pages.length === 0) return fail('ไม่พบเพจ: ตอนเชื่อมต่อต้องเลือกอย่างน้อย 1 เพจ และบัญชีต้องเป็นแอดมินของเพจนั้น')

  const db = supabaseAdmin()
  const { error: saveError } = await db.from('facebook_pages').upsert(
    pages.map((p) => ({ user_id: actor.id, page_id: p.id, name: p.name, picture: p.picture, access_token: p.accessToken, connected_at: new Date().toISOString() })),
  )
  if (saveError) {
    console.error('[fb-connect] save failed', saveError)
    return fail(`บันทึกเพจไม่สำเร็จ (รัน supabase/facebook-connect.sql แล้วหรือยัง): ${saveError.message}`)
  }

  // The service-only transaction creates a new tenant or joins the existing Page tenant.
  const { data: updated, error: syncError } = await db.rpc('sync_facebook_tenants', {
    p_user_id: actor.id,
    p_pages: pages.map(page => ({ page_id: page.id, page_name: page.name, page_access_token: page.accessToken })),
  })
  if (syncError) {
    console.error('[fb-connect] tenant synchronization failed', { code: syncError.code })
    return fail('เชื่อมต่อร้านค้าไม่สำเร็จ กรุณาตรวจสอบการติดตั้ง facebook-tenants.sql เวอร์ชันล่าสุด')
  }
  for (const page of pages) {
    const subError = await subscribePage(page.id, page.accessToken)
    if (subError) console.error('[fb-connect] webhook subscribe failed', page.id, subError)
  }

  return done({ fb: 'connected', pages: String(pages.length), updated: String(updated ?? 0) })
}
