import 'server-only'

export type ProviderQuota =
  | { ok: true; remaining: number; overQuota: number; checkedAt: string }
  | { ok: false; message: string }

/** https://slipok.com/api-documentation/check-slip-quota/ */
export async function getProviderQuota(): Promise<ProviderQuota> {
  const branch = process.env.SLIPOK_BRANCH_ID?.trim()
  const key = process.env.SLIPOK_API_KEY?.trim()
  if (!branch || !key) return { ok: false, message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ SlipOK' }
  try {
    const response = await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(branch)}/quota`, {
      headers: { 'x-authorization': key }, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    })
    const result = await response.json()
    if (!response.ok || result?.success !== true || typeof result?.data?.quota !== 'number'
      || !Number.isFinite(result.data.quota) || typeof result?.data?.overQuota !== 'number'
      || !Number.isFinite(result.data.overQuota)) {
      return { ok: false, message: 'อ่านโควตาจาก SlipOK ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่' }
    }
    return { ok: true, remaining: result.data.quota, overQuota: result.data.overQuota, checkedAt: new Date().toISOString() }
  } catch {
    return { ok: false, message: 'เชื่อมต่อ SlipOK ไม่สำเร็จ กรุณาลองใหม่ภายหลัง' }
  }
}
