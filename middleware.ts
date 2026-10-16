import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request)
  } catch (e) {
    // middleware ต้องไม่ทำให้ทั้งแอปล่ม: หน้า public ผ่านได้ หน้าอื่นกลับไป /login
    console.error('[middleware] unexpected error', e)
    const { pathname } = request.nextUrl
    if (pathname === '/login' || pathname.startsWith('/auth') || pathname.startsWith('/p/')) return NextResponse.next({ request })
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }
}

export const config = {
  // ยกเว้น /api ทั้งหมด: webhook ของ Facebook และ /api/slips/verify (Bearer secret) ต้องไม่ถูก redirect
  // route เหล่านั้นตรวจสิทธิ์เองอยู่แล้ว
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
