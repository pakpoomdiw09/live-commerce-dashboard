/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SLIP_COLUMNS, type SlipDetail, type SlipRow } from '@/lib/types'

const party = (p: any, bank: unknown) => ({
  name: p?.displayName || p?.name || null,
  bank: bank != null && bank !== '' ? String(bank) : null,
  account: p?.account?.value || p?.proxy?.value || null,
})

/** SlipOK sends transDate as yyyyMMdd and transTime as HH:mm:ss (Bangkok time). */
function transferredAt(d: any): string | null {
  const date = String(d?.transDate ?? '')
  const time = String(d?.transTime ?? '')
  if (!/^\d{8}$/.test(date)) return null
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${/^\d{2}:\d{2}(:\d{2})?$/.test(time) ? time : '00:00:00'}+07:00`
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString()
}

/** One slip with what SlipOK read off it, plus a signed URL for the private image. Service-role client only. */
export async function loadSlipDetail(db: SupabaseClient, id: string, tenantId?: string | null): Promise<SlipDetail | null> {
  let query = db
    .from('slips')
    .select(`${SLIP_COLUMNS}, image_path, raw, tenants(name), customers(display_name)`)
    .eq('id', id)
  if (tenantId !== undefined) query = tenantId === null ? query.is('tenant_id', null) : query.eq('tenant_id', tenantId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`slip lookup failed: ${error.message}`)
  if (!data) return null

  const { image_path, raw, tenants, customers, ...row } = data as any
  // 1012 (duplicate) and 1014 put the slip data in raw.data; a success puts it in raw.data too
  const d = raw?.data ?? {}
  let imageUrl: string | null = null
  if (image_path) {
    const signed = await db.storage.from('slips').createSignedUrl(image_path, 60 * 10)
    imageUrl = signed.data?.signedUrl ?? null
  }
  return {
    ...(row as SlipRow),
    imageUrl,
    transferredAt: transferredAt(d),
    sender: party(d.sender, d.sendingBank),
    receiver: party(d.receiver, d.receivingBank),
    tenantName: tenants?.name ?? null,
    customerName: customers?.display_name ?? null,
  }
}
