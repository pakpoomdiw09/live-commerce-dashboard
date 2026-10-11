import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseEnv } from './env'

// หน้าที่เข้าได้โดยไม่ต้องล็อกอิน
const PUBLIC_PATHS = ['/login', '/auth']
const isPublic = (p: string) => PUBLIC_PATHS.some((x) => p === x || p.startsWith(x + '/'))

export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  const redirectToLogin = (withNext: boolean) => {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    if (withNext) url.searchParams.set('next', pathname + search)
    return NextResponse.redirect(url)
  }

  // 1) ยังไม่ได้ตั้งค่า env: ห้ามสร้าง client (จะเกิด error ที่ถามมา)
  //    ปล่อยหน้า /login ซึ่งจะแสดงคำอธิบาย ส่วนหน้าอื่นเด้งไปที่นั่น
  const env = getSupabaseEnv()
  if (!env) {
    if (!isPublic(pathname)) console.warn('[middleware] Supabase env ยังไม่ครบ: ตรวจ .env.local')
    return isPublic(pathname) ? NextResponse.next({ request }) : redirectToLogin(false)
  }

  // 2) รีเฟรช session ผ่าน cookie ตามแพตเทิร์นของ @supabase/ssr
  let response = NextResponse.next({ request })
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // 3) เช็คสิทธิ์ด้วย getUser() (ตรวจกับ Supabase จริง) ไม่ใช้ getSession() ที่เชื่อ cookie อย่างเดียว
  //    ไม่มี session / cookie เสีย / เครือข่ายล่ม => ถือว่ายังไม่ล็อกอิน ไม่ให้ throw
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (e) {
    console.error('[middleware] getUser failed', e)
  }

  if (!user && !isPublic(pathname)) {
    const redirect = redirectToLogin(true)
    // เอา cookie ที่ Supabase เพิ่งอัปเดต (เช่น ล้าง token เสีย) ไปด้วย
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
    return redirect
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/overview'
    url.search = ''
    const redirect = NextResponse.redirect(url)
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
    return redirect
  }

  return response
}
