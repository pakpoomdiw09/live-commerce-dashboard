import 'server-only'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import type { ShippingCredentials } from './shipping-credentials'
import type { ShippingProvider } from './shipping-types'

export type ShippingParcelData = {
  orderId: string
  shipmentId: string
  recipient: { name: string; phone: string; address: string }
  sender: { name: string; phone: string; address: string }
  weight: number
  courierCode: string
  idempotencyKey: string
}

export type ShippingParcelResult = {
  trackingNumber: string
  labelPdfUrl: string
  trackingUrl: string
}

export type ShippingProviderConfig = {
  provider: ShippingProvider
  apiEndpoint: string
  credentials: ShippingCredentials
  trackingUrlTemplate: string
}

export interface ShippingProviderAdapter {
  testConnection(config: ShippingProviderConfig): Promise<void>
  createParcel(
    config: ShippingProviderConfig,
    parcel: ShippingParcelData,
  ): Promise<ShippingParcelResult>
  getTrackingUrl(config: ShippingProviderConfig, trackingNumber: string): string
}

function isPublicIpv4(address: string) {
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false
  const [a, b, c] = octets
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

function isPublicAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family !== 6) return false
  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) return isPublicIpv4(normalized.slice(7))
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16)
  return (first & 0xe000) === 0x2000 && !normalized.startsWith('2001:db8:')
}

async function endpoint(config: ShippingProviderConfig, path: string) {
  let url: URL
  try {
    url = new URL(config.apiEndpoint)
  } catch {
    throw new Error('SHIPPING_PROVIDER_ENDPOINT_INVALID')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost')
  )
    throw new Error('SHIPPING_PROVIDER_ENDPOINT_INVALID')
  const records = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true })
  if (!records.length || records.some((record) => !isPublicAddress(record.address)))
    throw new Error('SHIPPING_PROVIDER_ENDPOINT_INVALID')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`
  return url
}

function headers(config: ShippingProviderConfig) {
  const authorization =
    config.credentials.token || config.credentials.apiKey || config.credentials.secretKey
  if (!authorization) throw new Error('SHIPPING_PROVIDER_CREDENTIALS_REQUIRED')
  return {
    Authorization: `Bearer ${authorization}`,
    ...(config.credentials.secretKey ? { 'X-API-Secret': config.credentials.secretKey } : {}),
    ...(config.credentials.merchantId ? { 'X-Merchant-Id': config.credentials.merchantId } : {}),
  }
}

async function request(config: ShippingProviderConfig, path: string, init: RequestInit = {}) {
  const url = await endpoint(config, path)
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...headers(config), ...init.headers },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new Error('SHIPPING_PROVIDER_REQUEST_FAILED')
  }
  if (!response.ok) throw new Error(`SHIPPING_PROVIDER_HTTP_${response.status}`)
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error('SHIPPING_PROVIDER_RESPONSE_INVALID')
  }
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('SHIPPING_PROVIDER_RESPONSE_INVALID')
  return result as Record<string, unknown>
}

function trackingUrl(config: ShippingProviderConfig, trackingNumber: string) {
  if (!config.trackingUrlTemplate.includes('{tracking_number}'))
    throw new Error('SHIPPING_TRACKING_TEMPLATE_INVALID')
  const raw = config.trackingUrlTemplate.replace(
    '{tracking_number}',
    encodeURIComponent(trackingNumber),
  )
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('SHIPPING_TRACKING_TEMPLATE_INVALID')
  }
  if (url.protocol !== 'https:') throw new Error('SHIPPING_TRACKING_TEMPLATE_INVALID')
  return url.toString()
}

/** Generic DMove-compatible adapter; direct-carrier adapters can implement this contract later. */
export const dmoveShippingAdapter: ShippingProviderAdapter = {
  async testConnection(config) {
    const result = await request(config, 'health')
    if (result.success === false) throw new Error('SHIPPING_PROVIDER_CONNECTION_REJECTED')
  },
  async createParcel(config, parcel) {
    const result = await request(config, 'parcels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': parcel.idempotencyKey,
      },
      body: JSON.stringify({
        order_id: parcel.orderId,
        shipment_id: parcel.shipmentId,
        recipient: {
          name: parcel.recipient.name,
          phone: parcel.recipient.phone,
          address: parcel.recipient.address,
        },
        sender: {
          name: parcel.sender.name,
          phone: parcel.sender.phone,
          address: parcel.sender.address,
        },
        weight: parcel.weight,
        courier_code: parcel.courierCode,
      }),
    })
    if (
      result.success !== true ||
      typeof result.tracking_number !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{3,99}$/.test(result.tracking_number) ||
      typeof result.label_url !== 'string'
    )
      throw new Error('SHIPPING_PROVIDER_RESPONSE_INVALID')
    let labelUrl: URL
    try {
      labelUrl = new URL(result.label_url)
    } catch {
      throw new Error('SHIPPING_PROVIDER_LABEL_URL_INVALID')
    }
    if (labelUrl.protocol !== 'https:') throw new Error('SHIPPING_PROVIDER_LABEL_URL_INVALID')
    return {
      trackingNumber: result.tracking_number,
      labelPdfUrl: labelUrl.toString(),
      trackingUrl: this.getTrackingUrl(config, result.tracking_number),
    }
  },
  getTrackingUrl(config, trackingNumber) {
    return trackingUrl(config, trackingNumber)
  },
}

export const shippingProviderAdapters: Record<ShippingProvider, ShippingProviderAdapter> = {
  dmove: dmoveShippingAdapter,
  flash_express: dmoveShippingAdapter,
  jnt: dmoveShippingAdapter,
  thailand_post: dmoveShippingAdapter,
}
