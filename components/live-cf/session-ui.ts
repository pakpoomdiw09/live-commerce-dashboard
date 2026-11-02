export const field =
  'mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100 disabled:text-slate-500'
export const button =
  'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
export const orange =
  'rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50'
export const sessionTime = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false })
    : 'ไม่มีเวลาที่ตรวจสอบได้'
export const stateText: Record<string, string> = {
  pending: 'รอส่ง',
  processing: 'กำลังส่ง',
  sent: 'ส่งแล้ว',
  cancelled: 'ยกเลิกแล้ว',
  blocked: 'รอสิทธิ์ส่งข้อความ',
  requires_review: 'รอตรวจสอบผลส่ง',
}
export type Post = (
  input: Record<string, unknown>,
  requestId: string,
) => Promise<{ queued?: number; message?: string }>
export async function read(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'โหลดข้อมูลไม่สำเร็จ')
  return result
}
