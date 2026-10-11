import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// Facebook (ผ่าน Supabase) ส่งกลับมาที่นี่พร้อม ?code= แลกเป็น session cookie แล้วพาไปหน้าที่ต้องการ
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const nextParam = req.nextUrl.searchParams.get('next') ?? ''
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/overview'

  if (code) {
    try {
      const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code)
      if (!error) return NextResponse.redirect(new URL(next, req.url))
      console.error('oauth exchange failed', error)
    } catch (e) {
      console.error('oauth exchange failed', e)
    }
  }
  return NextResponse.redirect(new URL('/login?error=oauth', req.url))
}
