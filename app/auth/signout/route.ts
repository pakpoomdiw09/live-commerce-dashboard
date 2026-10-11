import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    await (await supabaseServer()).auth.signOut()
  } catch (e) {
    console.error('signout failed', e)
  }
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 })
}
