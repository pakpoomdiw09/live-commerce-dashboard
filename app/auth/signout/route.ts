import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    await (await supabaseServer()).auth.signOut()
  } catch (e) {
    console.error('signout failed', e)
  }
  const response = NextResponse.redirect(new URL('/login', req.url), { status: 303 })
  response.cookies.set('snapbot_session_mode', '', { path: '/', maxAge: 0, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:' })
  return response
}
