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
  SHIPPING_PROVIDER_LABELS,
  SHIPPING_PROVIDERS,
  type ShippingProvider,
  type ShippingAddress,
  type ShippingShipment,
} from '@/lib/features/shipping/shipping-types'
import {
  decryptShippingCredentials,
  encryptShippingCredentials,
  type ShippingCredentials,
} from '@/lib/features/shipping/shipping-credentials'
import {
  shippingProviderAdapters,
  type ShippingProviderConfig,
} from '@/lib/features/shipping/shipping-provider'
import { deliverShippingTrackingNotifications } from '@/lib/features/shipping/shipping-notifications'
import { UUID } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await shippingScope(req, req.nextUrl.searchParams.get('tenantId'))
    const sessionId = req.nextUrl.searchParams.get('sessionId')
    if (sessionId && !UUID.test(sessionId)) throw new ShippingError('รหัส Session ไม่ถูกต้อง')
    const [shipments, settings, sessions, integrations] = await Promise.all([
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
      db
        .from('shipping_integrations')
        .select(
          'provider,api_endpoint,sender_info,tracking_url_template,weight_kg,is_active,is_default,last_tested_at,credentials_ciphertext',
        )
        .eq('tenant_id', tenantId),
    ])
    if (shipments.error || settings.error || sessions.error || integrations.error)
      throw shipments.error || settings.error || sessions.error || integrations.error
    return shippingReply({
      shipments: shipments.data,
      settings: settings.data,
      sessions: sessions.data,
      integrations: (integrations.data ?? []).map((integration) => ({
        provider: integration.provider,
        api_endpoint: integration.api_endpoint,
        sender_info: integration.sender_info,
        tracking_url_template: integration.tracking_url_template,
        weight_kg: Number(integration.weight_kg),
        is_active: integration.is_active,
        is_default: integration.is_default,
        last_tested_at: integration.last_tested_at,
        credentials_configured: Boolean(integration.credentials_ciphertext),
      })),
    })
  } catch (error) {
    return shippingFailure(error)
  }
}

type ValidIntegrationInput = {
  provider: ShippingProvider
  apiEndpoint: string
  credentials: ShippingCredentials
  senderInfo: { name: string; phone: string; address: string }
  trackingUrlTemplate: string
  weightKg: number
  isActive: boolean
  isDefault: boolean
}

function validateIntegrationInput(value: unknown): ValidIntegrationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ShippingError('ข้อมูลการเชื่อมต่อขนส่งไม่ถูกต้อง')
  const input = value as Record<string, unknown>
  const provider = input.provider
  const credentials = input.credentials
  const sender = input.senderInfo
  if (
    typeof provider !== 'string' ||
    !SHIPPING_PROVIDERS.includes(provider as ShippingProvider) ||
    typeof input.apiEndpoint !== 'string' ||
    input.apiEndpoint.length > 500 ||
    typeof input.trackingUrlTemplate !== 'string' ||
    input.trackingUrlTemplate.length > 1000 ||
    typeof input.weightKg !== 'number' ||
    !Number.isFinite(input.weightKg) ||
    input.weightKg <= 0 ||
    input.weightKg > 100 ||
    typeof input.isActive !== 'boolean' ||
    typeof input.isDefault !== 'boolean' ||
    !credentials ||
    typeof credentials !== 'object' ||
    Array.isArray(credentials) ||
    !sender ||
    typeof sender !== 'object' ||
    Array.isArray(sender)
  )
    throw new ShippingError('กรุณาตรวจสอบข้อมูลการเชื่อมต่อขนส่ง')
  let endpoint: URL
  try {
    endpoint = new URL(input.apiEndpoint)
  } catch {
    throw new ShippingError('API Base URL ไม่ถูกต้อง')
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new ShippingError('API Base URL ต้องเป็น HTTPS และไม่มี query/credential')
  if (provider === 'beemove' && endpoint.href !== 'https://client.beemove.co.th/')
    throw new ShippingError('Bee Move ต้องใช้ https://client.beemove.co.th')
  const supplied = credentials as Record<string, unknown>
  const cleanCredential = (key: string, max: number) => {
    const raw = supplied[key]
    if (raw === undefined || raw === '') return ''
    if (typeof raw !== 'string' || raw.length > max)
      throw new ShippingError('Credential มีรูปแบบไม่ถูกต้อง')
    return raw.trim()
  }
  const secret: ShippingCredentials = {
    apiKey: cleanCredential('apiKey', 1000),
    secretKey: cleanCredential('secretKey', 1000),
    token: cleanCredential('token', 2000),
    merchantId: cleanCredential('merchantId', 200),
  }
  const from = sender as Record<string, unknown>
  if (
    typeof from.name !== 'string' ||
    from.name.trim().length < 2 ||
    from.name.length > 200 ||
    typeof from.phone !== 'string' ||
    !normalizeThaiPhone(from.phone) ||
    typeof from.address !== 'string' ||
    from.address.trim().length < 10 ||
    from.address.length > 1200 ||
    !input.trackingUrlTemplate.includes('{tracking_number}')
  )
    throw new ShippingError('กรุณากรอกผู้ส่ง เบอร์โทร ที่อยู่ และ Tracking URL Template ให้ครบ')
  let trackingUrl: URL
  try {
    trackingUrl = new URL(input.trackingUrlTemplate.replace('{tracking_number}', 'TEST'))
  } catch {
    throw new ShippingError('Tracking URL Template ไม่ถูกต้อง')
  }
  if (trackingUrl.protocol !== 'https:') throw new ShippingError('Tracking URL ต้องใช้ HTTPS')
  return {
    provider: provider as ShippingProvider,
    apiEndpoint: endpoint.toString().replace(/\/$/, ''),
    credentials: secret,
    senderInfo: {
      name: from.name.trim(),
      phone: normalizeThaiPhone(from.phone)!,
      address: from.address.trim(),
    },
    trackingUrlTemplate: input.trackingUrlTemplate.trim(),
    weightKg: input.weightKg,
    isActive: input.isActive,
    isDefault: input.isDefault,
  }
}

async function credentialsFor(credentials: ShippingCredentials, ciphertext?: string) {
  const saved = ciphertext ? decryptShippingCredentials(ciphertext) : {}
  const merged: ShippingCredentials = {
    apiKey: credentials.apiKey || saved.apiKey,
    secretKey: credentials.secretKey || saved.secretKey,
    token: credentials.token || saved.token,
    merchantId: credentials.merchantId || saved.merchantId,
  }
  if (!merged.apiKey && !merged.secretKey && !merged.token)
    throw new ShippingError('กรุณากรอก API Key, Secret Key หรือ Token')
  return merged
}

function providerConfig(
  integration: ValidIntegrationInput,
  credentials: ShippingCredentials = integration.credentials,
): ShippingProviderConfig {
  return {
    provider: integration.provider,
    apiEndpoint: integration.apiEndpoint,
    credentials,
    trackingUrlTemplate: integration.trackingUrlTemplate,
  }
}

async function createShippingParcels({
  db,
  tenantId,
  actorId,
  requestId,
  ids,
  provider,
}: {
  db: ReturnType<typeof import('@/lib/supabase/server').supabaseAdmin>
  tenantId: string
  actorId: string
  requestId: string
  ids: string[]
  provider: ShippingProvider
}) {
  const [integrationResult, snapshotResult] = await Promise.all([
    db
      .from('shipping_integrations')
      .select(
        'provider,api_endpoint,credentials_ciphertext,sender_info,tracking_url_template,weight_kg,is_active',
      )
      .eq('tenant_id', tenantId)
      .eq('provider', provider)
      .maybeSingle(),
    db.rpc('shipping_snapshot', { p_tenant: tenantId, p_ids: ids, p_session: null }),
  ])
  if (integrationResult.error || snapshotResult.error)
    throw integrationResult.error || snapshotResult.error
  const integration = integrationResult.data
  if (!integration?.is_active) throw new ShippingError('ค่ายขนส่งนี้ยังไม่ได้เปิดใช้งาน')
  const config: ShippingProviderConfig = {
    provider,
    apiEndpoint: integration.api_endpoint,
    credentials: decryptShippingCredentials(integration.credentials_ciphertext),
    trackingUrlTemplate: integration.tracking_url_template,
  }
  const adapter = shippingProviderAdapters[provider]
  const shipments = snapshotResult.data as ShippingShipment[]
  if (!Array.isArray(shipments) || shipments.length !== ids.length)
    throw new ShippingError('ไม่พบรายการจัดส่งที่เลือกจากร้านนี้', 404)
  const results: {
    shipmentId: string
    status: 'shipped' | 'failed' | 'in_progress' | 'uncertain'
    trackingNumber?: string
    trackingUrl?: string
    labelPdfUrl?: string
    notification?: 'sent' | 'pending' | 'requires_review'
    error?: string
  }[] = []
  for (const shipment of shipments) {
    const started = await db.rpc('begin_shipping_provider_job', {
      p_tenant: tenantId,
      p_actor: actorId,
      p_request: requestId,
      p_shipment: shipment.id,
      p_provider: provider,
    })
    if (started.error) throw started.error
    const job = started.data
    if (!job?.jobId) throw new Error('SHIPPING_PROVIDER_JOB_INVALID')
    if (job.status === 'created') {
      results.push({
        shipmentId: shipment.id,
        status: 'shipped',
        trackingNumber: job.trackingNumber,
        trackingUrl: job.trackingUrl,
        labelPdfUrl: job.labelPdfUrl,
        notification: job.notificationStatus === 'sent' ? 'sent' : 'pending',
      })
      continue
    }
    if (job.status !== 'creating' || !job.claimed) {
      results.push({
        shipmentId: shipment.id,
        status:
          job.status === 'uncertain'
            ? 'uncertain'
            : job.status === 'failed'
              ? 'failed'
              : 'in_progress',
      })
      continue
    }
    let requested = false
    try {
      if (!shipment.payment_ready || shipment.fulfillment_status !== 'ready_to_ship')
        throw new ShippingError('รายการยังไม่พร้อมจัดส่ง')
      const orderIds = shipment.items.map((item) => item.order_id)
      requested = true
      const created = await adapter.createParcel(config, {
        orderId: orderIds.length === 1 ? orderIds[0] : shipment.customer_tab_id || shipment.id,
        shipmentId: shipment.id,
        recipient: {
          name: shipment.recipient_name,
          phone: shipment.phone_number,
          address: [
            shipment.shipping_address,
            shipment.subdistrict,
            shipment.district,
            shipment.province,
            shipment.zipcode,
          ]
            .filter(Boolean)
            .join(' '),
        },
        sender: integration.sender_info,
        weight: Number(integration.weight_kg),
        courierCode: provider,
        idempotencyKey: job.idempotencyKey,
      })
      const completed = await db.rpc('complete_shipping_provider_job', {
        p_job: job.jobId,
        p_tracking: created.trackingNumber,
        p_courier: SHIPPING_PROVIDER_LABELS[provider],
        p_tracking_url: created.trackingUrl,
        p_label_url: created.labelPdfUrl,
      })
      if (completed.error) throw completed.error
      // The transaction also enqueues tracking. Delivery failure must never undo or repeat parcel creation.
      results.push({
        shipmentId: shipment.id,
        status: 'shipped',
        ...created,
        notification: 'pending',
      })
    } catch (error) {
      const failure = error instanceof Error ? error.message : 'SHIPPING_PROVIDER_FAILED'
      const definiteRejection =
        /^SHIPPING_PROVIDER_HTTP_4\d\d$/.test(failure) && !/HTTP_(408|409|429)$/.test(failure)
      const beforeRequest = [
        'SHIPPING_PROVIDER_ENDPOINT_INVALID',
        'SHIPPING_PROVIDER_CREDENTIALS_REQUIRED',
      ].includes(failure)
      const uncertain = requested && !definiteRejection && !beforeRequest
      const saved = await db.rpc('finish_shipping_provider_job', {
        p_job: job.jobId,
        p_status: uncertain ? 'uncertain' : 'failed',
        p_error: failure.replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'SHIPPING_FAILED',
      })
      if (saved.error) throw saved.error
      results.push({
        shipmentId: shipment.id,
        status: uncertain ? 'uncertain' : 'failed',
        error: uncertain
          ? 'ผลสร้างพัสดุไม่ชัดเจน กรุณาตรวจสอบกับขนส่งก่อนลองอีกครั้ง'
          : 'ไม่สามารถสร้างพัสดุกับขนส่งได้',
      })
    }
  }
  try {
    const notifications = await deliverShippingTrackingNotifications(db, {
      tenantId,
      shipmentIds: ids,
    })
    for (const result of results) {
      const notified = notifications.find((item) => item.shipmentId === result.shipmentId)
      if (result.status === 'shipped' && notified) result.notification = notified.status
    }
  } catch {
    console.warn('[shipping/tracking] outbox pending; recovery worker will retry')
  }
  return { ok: true, results }
}
export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    if (!input || typeof input !== 'object' || !UUID.test(input.requestId ?? ''))
      throw new ShippingError('ข้อมูลคำขอไม่ถูกต้อง')
    const privilegedAction = ['settings', 'save_integration', 'test_integration'].includes(
      input.action,
    )
    const { db, actor, tenantId } = await shippingScope(req, input.tenantId, true, privilegedAction)
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
    } else if (input.action === 'save_integration' || input.action === 'test_integration') {
      payload = {
        action: input.action,
        integration: validateIntegrationInput(input.integration),
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
      } else if (input.action === 'create_parcels') {
        if (!SHIPPING_PROVIDERS.includes(input.provider))
          throw new ShippingError('เลือกค่ายขนส่งที่ถูกต้อง')
        payload.provider = input.provider
      } else if (!['cancel', 'restore', 'dispatch'].includes(input.action))
        throw new ShippingError('คำสั่งไม่ถูกต้อง')
    }
    const rate = await db.rpc('commerce_rate_limit', {
      p_bucket: `shipping:${actor.id}:${tenantId}`,
      p_max: 30,
    })
    if (rate.error) throw rate.error
    if (!rate.data) return shippingReply({ error: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่' }, 429)
    if (payload.action === 'test_integration') {
      const integration = payload.integration as ValidIntegrationInput
      const current = await db
        .from('shipping_integrations')
        .select('credentials_ciphertext')
        .eq('tenant_id', tenantId)
        .eq('provider', integration.provider)
        .maybeSingle()
      if (current.error) throw current.error
      const config = providerConfig(
        integration,
        await credentialsFor(integration.credentials, current.data?.credentials_ciphertext),
      )
      await shippingProviderAdapters[integration.provider].testConnection(config)
      const saved = await db
        .from('shipping_integrations')
        .update({ last_tested_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('provider', integration.provider)
      if (saved.error) throw saved.error
      return shippingReply({ ok: true })
    }
    if (payload.action === 'save_integration') {
      const integration = payload.integration as ValidIntegrationInput
      const existing = await db
        .from('shipping_integrations')
        .select('credentials_ciphertext')
        .eq('tenant_id', tenantId)
        .eq('provider', integration.provider)
        .maybeSingle()
      if (existing.error) throw existing.error
      const mergedCredentials = await credentialsFor(
        integration.credentials,
        existing.data?.credentials_ciphertext,
      )
      if (integration.provider === 'beemove' && !mergedCredentials.apiKey)
        throw new ShippingError('กรุณากรอก API Key ของ Bee Move')
      const nextCredentials = encryptShippingCredentials(mergedCredentials)
      const result = await db.rpc('save_shipping_integration', {
        p_tenant: tenantId,
        p_provider: integration.provider,
        p_endpoint: integration.apiEndpoint,
        p_credentials: nextCredentials,
        p_sender: integration.senderInfo,
        p_tracking_template: integration.trackingUrlTemplate,
        p_weight: integration.weightKg,
        p_active: integration.isActive,
        p_default: integration.isDefault,
      })
      if (result.error) throw result.error
      return shippingReply({ ok: true })
    }
    if (payload.action === 'create_parcels')
      return shippingReply(
        await createShippingParcels({
          db,
          tenantId,
          actorId: actor.id,
          requestId: input.requestId,
          ids: payload.ids as string[],
          provider: payload.provider as ShippingProvider,
        }),
      )
    const result = await db.rpc('manage_shipping', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_request: input.requestId,
      p_input: payload,
    })
    if (result.error) throw result.error
    if (payload.action === 'dispatch') {
      try {
        const notifications = await deliverShippingTrackingNotifications(db, {
          tenantId,
          shipmentIds: payload.ids as string[],
        })
        return shippingReply({ ...result.data, notifications })
      } catch {
        console.warn('[shipping/tracking] manual dispatch saved; outbox pending')
        return shippingReply({ ...result.data, notificationsPending: true })
      }
    }
    return shippingReply(result.data)
  } catch (error) {
    return shippingFailure(error)
  }
}
