import { NextRequest } from 'next/server'
import {
  shippingScope,
  shippingReply,
  shippingFailure,
  ShippingError,
} from '@/lib/features/shipping/shipping-server'
import {
  normalizeThaiPhone,
  validShippingAddress,
  SHIPPING_FIELDS,
  type ShippingAddress,
} from '@/lib/features/shipping/shipping-types'
import { UUID } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await shippingScope(req, req.nextUrl.searchParams.get('tenantId'))
    const sessionId = req.nextUrl.searchParams.get('sessionId')
    if (sessionId && !UUID.test(sessionId)) throw new ShippingError('รหัส Session ไม่ถูกต้อง')
    const [shipments, settings, sessions] = await Promise.all([
      db.rpc('shipping_snapshot', { p_tenant: tenantId, p_session: sessionId || null }),
      db
        .from('shipping_settings')
        .select('sender_name,sender_phone,sender_address,default_courier')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      db
        .from('live_sessions')
        .select('id,live_post_id,created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    if (shipments.error || settings.error || sessions.error)
      throw shipments.error || settings.error || sessions.error
    return shippingReply({
      shipments: shipments.data,
      settings: settings.data,
      sessions: sessions.data,
    })
  } catch (error) {
    return shippingFailure(error)
  }
}
export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    if (!input || typeof input !== 'object' || !UUID.test(input.requestId ?? ''))
      throw new ShippingError('ข้อมูลคำขอไม่ถูกต้อง')
    const { db, actor, tenantId } = await shippingScope(
      req,
      input.tenantId,
      true,
      input.action === 'settings',
    )
    let payload: Record<string, unknown>
    if (input.action === 'settings') {
      const settings = input.settings
      if (
        !settings ||
        typeof settings.sender_name !== 'string' ||
        settings.sender_name.trim().length < 2 ||
        settings.sender_name.length > 200 ||
        typeof settings.sender_phone !== 'string' ||
        !normalizeThaiPhone(settings.sender_phone) ||
        typeof settings.sender_address !== 'string' ||
        settings.sender_address.trim().length < 10 ||
        settings.sender_address.length > 1200 ||
        typeof settings.default_courier !== 'string' ||
        !settings.default_courier.trim() ||
        settings.default_courier.length > 80
      )
        throw new ShippingError('กรุณากรอกชื่อ เบอร์โทร และที่อยู่ผู้ส่งให้ครบ')
      payload = {
        action: 'settings',
        settings: {
          sender_name: settings.sender_name.trim(),
          sender_phone: normalizeThaiPhone(settings.sender_phone),
          sender_address: settings.sender_address.trim(),
          default_courier: settings.default_courier.trim(),
        },
      }
    } else if (input.action === 'mark_print') {
      if (!UUID.test(input.batchId ?? '')) throw new ShippingError('รหัสชุดใบปะหน้าไม่ถูกต้อง')
      payload = { action: 'mark_print', batchId: input.batchId }
    } else {
      if (
        !Array.isArray(input.ids) ||
        !input.ids.length ||
        input.ids.length > 100 ||
        input.ids.some((id: unknown) => typeof id !== 'string' || !UUID.test(id)) ||
        new Set(input.ids).size !== input.ids.length
      )
        throw new ShippingError('กรุณาเลือก 1–100 รายการจากร้านนี้')
      payload = { action: input.action, ids: [...input.ids].sort() }
      if (input.action === 'edit') {
        const address = Object.fromEntries(
          SHIPPING_FIELDS.map(({ key }) => [
            key,
            typeof input.address?.[key] === 'string' ? input.address[key].trim() : '',
          ]),
        ) as ShippingAddress
        address.phone_number = normalizeThaiPhone(address.phone_number) ?? ''
        if (
          input.ids.length !== 1 ||
          !validShippingAddress(address) ||
          !Number.isSafeInteger(input.revision) ||
          input.revision < 0 ||
          typeof input.confirmed !== 'boolean' ||
          typeof input.tracking !== 'string' ||
          !/^(?:[A-Za-z0-9][A-Za-z0-9._/-]{3,99})?$/.test(input.tracking.trim()) ||
          typeof input.courier !== 'string' ||
          !input.courier.trim() ||
          input.courier.length > 80 ||
          typeof input.note !== 'string' ||
          input.note.length > 500
        )
          throw new ShippingError('กรุณาตรวจชื่อ เบอร์โทร ที่อยู่ และเลขพัสดุให้ถูกต้อง')
        payload = {
          ...payload,
          address,
          revision: input.revision,
          confirmed: input.confirmed,
          tracking: input.tracking.trim(),
          courier: input.courier.trim(),
          note: input.note,
        }
      } else if (input.action === 'prepare_print') {
        if (!['thermal', 'a4'].includes(input.format))
          throw new ShippingError('ขนาดกระดาษไม่ถูกต้อง')
        payload.format = input.format
      } else if (!['cancel', 'restore', 'dispatch'].includes(input.action))
        throw new ShippingError('คำสั่งไม่ถูกต้อง')
    }
    const rate = await db.rpc('commerce_rate_limit', {
      p_bucket: `shipping:${actor.id}:${tenantId}`,
      p_max: 30,
    })
    if (rate.error) throw rate.error
    if (!rate.data) return shippingReply({ error: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่' }, 429)
    const result = await db.rpc('manage_shipping', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_request: input.requestId,
      p_input: payload,
    })
    if (result.error) throw result.error
    return shippingReply(result.data)
  } catch (error) {
    return shippingFailure(error)
  }
}
