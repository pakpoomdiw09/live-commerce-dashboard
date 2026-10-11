// ใช้ได้ทั้งฝั่ง server, browser และ middleware (ห้ามใส่ 'server-only' ในไฟล์นี้)

// ล้างช่องว่าง และเครื่องหมายคำพูดที่เผลอใส่ใน .env (เช่น KEY="abc" หรือมีเว้นวรรคท้ายบรรทัด)
const clean = (v: string | undefined) => (v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim()

export type SupabaseEnv = { url: string; anonKey: string }

/**
 * คืนค่า URL + anon key ที่ถูกต้อง หรือ null ถ้ายังไม่ได้ตั้งค่า / ตั้งผิดรูปแบบ
 *
 * สำคัญ: ต้องเขียน process.env.NEXT_PUBLIC_XXX ตรงๆ ทีละตัวแบบนี้เท่านั้น
 * Next.js จะแทนที่ค่าตอน build เฉพาะการเขียนตรงๆ — process.env[name] หรือการ
 * destructure `const { NEXT_PUBLIC_X } = process.env` จะได้ undefined ในฝั่ง browser
 */
export function getSupabaseEnv(): SupabaseEnv | null {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const anonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  if (!url || !anonKey) return null
  try {
    const { protocol } = new URL(url) // ดักกรณีมี [ ] หรือไม่มี https://
    if (protocol !== 'https:' && protocol !== 'http:') return null
  } catch {
    return null
  }
  return { url, anonKey }
}

export const isSupabaseConfigured = () => getSupabaseEnv() !== null

/** ใช้ในจุดที่ขาดค่าไม่ได้จริงๆ: โยน error ที่บอกวิธีแก้ชัดเจน แทนข้อความของ Supabase */
export function requireSupabaseEnv(): SupabaseEnv {
  const env = getSupabaseEnv()
  if (!env) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า Supabase: ตรวจ .env.local ว่ามี NEXT_PUBLIC_SUPABASE_URL (เช่น https://xxxx.supabase.co) ' +
        'และ NEXT_PUBLIC_SUPABASE_ANON_KEY แล้วรีสตาร์ท npm run dev',
    )
  }
  return env
}
