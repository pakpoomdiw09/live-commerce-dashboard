import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseEnv } from '@/lib/supabase/env'
import type {SupabaseClient} from '@supabase/supabase-js'

let browserClient:SupabaseClient|undefined

// createBrowserClient เป็น singleton ในฝั่ง browser อยู่แล้ว เรียกซ้ำได้ไม่เปลืองเพิ่ม
export const supabaseBrowser = () => {
  if(typeof window!=='undefined'&&browserClient)return browserClient
  const { url, anonKey } = requireSupabaseEnv()
  // Never share an SSR client across requests/users. Browser renders share one.
  if(typeof window==='undefined')return createBrowserClient(url,anonKey,{isSingleton:false})
  browserClient=createBrowserClient(url,anonKey,{isSingleton:true})
  return browserClient
}
