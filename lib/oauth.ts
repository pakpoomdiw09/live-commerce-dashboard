/** Shared client/server OAuth routing and safe user-facing errors. No credentials here. */
export const FACEBOOK_SCOPES =
  'public_profile,email,pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata'
export const FACEBOOK_LOGIN_SCOPES = FACEBOOK_SCOPES
export const OAUTH_NEXT_COOKIE = 'auth_oauth_next'
export const OAUTH_COOKIE_PATH = '/auth/callback'

export function safeAuthNext(value?: string | null, fallback = '/overview') {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return fallback
  try {
    const parsed = new URL(value, 'https://local.invalid')
    return parsed.origin === 'https://local.invalid'
      ? parsed.pathname + parsed.search + parsed.hash
      : fallback
  } catch {
    return fallback
  }
}

export function facebookRedirectTo(origin: string) {
  return new URL('/auth/callback', origin).toString()
}

/** Routing hint only: keep the allowlisted callback URL independent of the destination. */
export function rememberOAuthNext(next: string) {
  document.cookie = `${OAUTH_NEXT_COOKIE}=${encodeURIComponent(safeAuthNext(next, '/select-page'))}; Path=${OAUTH_COOKIE_PATH}; Max-Age=600; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
}

const ERRORS: Record<string, string> = {
  oauth: 'เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ กรุณาลองเริ่มเข้าสู่ระบบใหม่',
  access_denied: 'ไม่ได้รับอนุญาตจาก Facebook กรุณาลองใหม่และอนุญาตสิทธิ์ที่จำเป็น',
  provider_disabled: 'ยังไม่ได้เปิด Facebook provider ใน Supabase กรุณาติดต่อผู้ดูแล',
  signup_disabled: 'ระบบไม่อนุญาตสร้างบัญชีใหม่ กรุณาติดต่อผู้ดูแล',
  oauth_email_missing:
    'Facebook ไม่ได้ส่งอีเมล กรุณาอนุญาตสิทธิ์อีเมล และตรวจว่าบัญชี Facebook มีอีเมลที่ยืนยันแล้ว',
  pkce_code_verifier_not_found:
    'ไม่พบข้อมูลยืนยันการเข้าสู่ระบบ กรุณาเริ่มใหม่จากเว็บและเบราว์เซอร์เดิม อย่าสลับระหว่าง localhost กับ 127.0.0.1',
  bad_code_verifier: 'ข้อมูลยืนยันการเข้าสู่ระบบไม่ตรงกัน กรุณากดเข้าสู่ระบบใหม่ในเบราว์เซอร์เดิม',
  flow_state_not_found: 'ลิงก์เข้าสู่ระบบนี้ถูกใช้แล้วหรือหมดอายุ กรุณากดเข้าสู่ระบบใหม่',
  flow_state_expired: 'ลิงก์เข้าสู่ระบบหมดอายุ กรุณากดเข้าสู่ระบบใหม่',
  missing_code:
    'ไม่ได้รับรหัสเข้าสู่ระบบ กรุณาตรวจ URL callback ใน Supabase แล้วเริ่มเข้าสู่ระบบใหม่',
  bad_oauth_callback:
    'Facebook callback ไม่ถูกต้อง กรุณาตรวจ URL redirect และการตั้งค่า Facebook provider',
  bad_oauth_state: 'ข้อมูล Facebook OAuth ไม่ถูกต้อง กรุณาเริ่มเข้าสู่ระบบใหม่',
  auth_connection: 'เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาตรวจการเชื่อมต่อและลองใหม่',
  oauth_configuration:
    'การตั้งค่า Facebook OAuth ไม่ครบ กรุณาตรวจ App ID, App Secret และ URL callback ใน Supabase',
}

export function oauthErrorCode(code?: string | null, description?: string | null) {
  // Supabase may use a generic provider error when Facebook cannot supply an email.
  if (
    description &&
    /(?:email.*(?:missing|not found|not returned)|(?:getting|obtain).*email|without.*email)/i.test(
      description,
    )
  )
    return 'oauth_email_missing'
  if (
    description &&
    /(?:provider.*(?:not enabled|disabled)|unsupported provider)/i.test(description)
  )
    return 'provider_disabled'
  return code && Object.hasOwn(ERRORS, code) ? code : 'oauth'
}

export function oauthErrorMessage(code?: string | null) {
  return ERRORS[oauthErrorCode(code)]
}
