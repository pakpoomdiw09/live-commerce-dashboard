/** Join class names, skipping falsy values. */
export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const baht = (n: number | null | undefined) =>
  n == null ? '-' : Number(n).toLocaleString('th-TH', { style: 'currency', currency: 'THB' })

/** Compact amount for chart axes and tiles: ฿12.5K */
export const bahtShort = (n: number) =>
  '฿' + new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export const sameDay = (a: string | Date, b: string | Date) => new Date(a).toDateString() === new Date(b).toDateString()
export const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { timeStyle: 'short' })
export const listTime = (iso: string) =>
  sameDay(iso, new Date()) ? clock(iso) : new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
export const dayLabel = (iso: string) =>
  sameDay(iso, new Date()) ? 'วันนี้' : new Date(iso).toLocaleDateString('th-TH', { dateStyle: 'medium' })

export const customerName = (c: { display_name: string | null; platform_user_id: string }) =>
  c.display_name ?? `ผู้ใช้ ...${c.platform_user_id.slice(-4)}`

/** Error text from a failed fetch() to our own API routes. */
export async function apiError(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `HTTP ${res.status}`
}
