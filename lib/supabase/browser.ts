import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseEnv } from './env'

// createBrowserClient เป็น singleton ในฝั่ง browser อยู่แล้ว เรียกซ้ำได้ไม่เปลืองเพิ่ม
export const supabaseBrowser = () => {
  const { url, anonKey } = requireSupabaseEnv()
  return createBrowserClient(url, anonKey)
}
