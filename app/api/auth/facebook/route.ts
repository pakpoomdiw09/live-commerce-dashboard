import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { callbackUrl, dialogUrl, isFacebookConnectConfigured, STATE_COOKIE, STATE_COOKIE_PATH } from '@/lib/integrations/facebook/oauth'

export const runtime = 'nodejs'

/** GET: start "เชื่อมต่อเพจด้วย Facebook" for the signed-in user. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const actor = await getActor()
  if (!actor) return NextResponse.redirect(new URL('/login?next=/select-page', origin))
  if (!isFacebookConnectConfigured()) {
    return NextResponse.redirect(new URL(`/select-page?fb_error=${encodeURIComponent('ยังไม่ได้ตั้ง FB_APP_ID / FB_APP_SECRET')}`, origin))
  }

  const state = randomBytes(24).toString('hex')
  const res = NextResponse.redirect(dialogUrl(callbackUrl(origin), state))
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax', // sent on the top-level redirect back from facebook.com
    secure: process.env.NODE_ENV === 'production',
    path: STATE_COOKIE_PATH,
    maxAge: 600,
  })
  return res
}
