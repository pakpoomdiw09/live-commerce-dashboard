import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_PAYMENT_PRO_FLAGS, type PaymentProFlags } from '@/lib/features/payments/payment-pro-core'
// Local development enables the full dashboard without changing production or tenant settings.
export function paymentProAvailable(){return (process.env.NODE_ENV==='development'||process.env.PAYMENT_PRO_ENABLED==='true')&&process.env.PAYMENT_PRO_KILL_SWITCH!=='true'}
/** UI rollback does not change verification, bank authorization or existing credits. */
export function paymentProUiEnabled(){return process.env.PAYMENT_PRO_UI_ENABLED!=='false'}
/** Backend-owned only. Never accepts flag/plan/credit overrides from a request. */
export async function paymentProConfig(db:SupabaseClient,tenantId:string):Promise<PaymentProFlags|null>{
  if(!paymentProAvailable())return null
  if(process.env.NODE_ENV==='development')return Object.fromEntries(Object.keys(DEFAULT_PAYMENT_PRO_FLAGS).map(key=>[key,true])) as PaymentProFlags
  const result=await db.from('payment_pro_settings').select('enabled,flags').eq('tenant_id',tenantId).maybeSingle()
  if(result.error)throw new Error('Payment Pro ไม่พร้อมใช้งาน กรุณาตรวจสอบ migration หรือปิด PAYMENT_PRO_ENABLED')
  if(!result.data?.enabled)return null
  const stored=result.data.flags
  return Object.fromEntries(Object.keys(DEFAULT_PAYMENT_PRO_FLAGS).map(key=>[key,stored?.[key]===true])) as PaymentProFlags
}
