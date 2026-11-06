import 'server-only'
import type {
  ShippingProviderAdapter,
  ShippingProviderConfig,
} from '@/lib/features/shipping/shipping-provider'

export const BEEMOVE_BASE_URL = 'https://client.beemove.co.th'
// Provisional contract explicitly requested by the owner; NOT a verified Bee Move API specification.
export const BEEMOVE_CREATE_ORDER_PATH = '/api/v1/orders/create'
export const BEEMOVE_TRACKING_URL_TEMPLATE = `${BEEMOVE_BASE_URL}/tracking/{tracking_number}`

function apiKey(config: ShippingProviderConfig) {
  const base = new URL(config.apiEndpoint)
  if (base.href !== `${BEEMOVE_BASE_URL}/` && base.href !== BEEMOVE_BASE_URL)
    throw new Error('SHIPPING_PROVIDER_ENDPOINT_INVALID')
  const key = config.credentials.apiKey?.trim()
  if (!key || /[\r\n]/.test(key)) throw new Error('SHIPPING_PROVIDER_CREDENTIALS_REQUIRED')
  return key
}

function httpsUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('SHIPPING_PROVIDER_RESPONSE_INVALID')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('SHIPPING_PROVIDER_RESPONSE_INVALID')
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('SHIPPING_PROVIDER_RESPONSE_INVALID')
  return url.toString()
}

/** Real HTTP transport against the owner's provisional endpoint; tests mock fetch, never tracking values. */
export const beemoveShippingAdapter: ShippingProviderAdapter = {
  async testConnection(config) {
    apiKey(config)
    // A public HTML page cannot prove API-key validity. Do not create a parcel to test credentials.
    throw new Error('BEEMOVE_CONNECTION_TEST_UNAVAILABLE')
  },
  async createParcel(config, parcel) {
    const key = apiKey(config)
    let response: Response
    try {
      response = await fetch(`${BEEMOVE_BASE_URL}${BEEMOVE_CREATE_ORDER_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': parcel.idempotencyKey,
        },
        body: JSON.stringify({
          order_id: parcel.orderId,
          shipment_id: parcel.shipmentId,
          recipient: parcel.recipient,
          sender: parcel.sender,
          weight: parcel.weight,
          courier_code: parcel.courierCode,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new Error('SHIPPING_PROVIDER_REQUEST_FAILED')
    }
    if (!response.ok) throw new Error(`SHIPPING_PROVIDER_HTTP_${response.status}`)
    let result: Record<string, unknown>
    try {
      result = await response.json()
    } catch {
      throw new Error('SHIPPING_PROVIDER_RESPONSE_INVALID')
    }
    if (
      !result ||
      typeof result !== 'object' ||
      result.success === false ||
      typeof result.tracking_number !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{3,99}$/.test(result.tracking_number)
    )
      throw new Error('SHIPPING_PROVIDER_RESPONSE_INVALID')
    return {
      trackingNumber: result.tracking_number,
      labelPdfUrl: httpsUrl(result.label_url),
      trackingUrl:
        result.tracking_url === undefined
          ? this.getTrackingUrl(config, result.tracking_number)
          : httpsUrl(result.tracking_url),
    }
  },
  getTrackingUrl(config, trackingNumber) {
    const template = config.trackingUrlTemplate || BEEMOVE_TRACKING_URL_TEMPLATE
    if (!template.includes('{tracking_number}'))
      throw new Error('SHIPPING_TRACKING_TEMPLATE_INVALID')
    return httpsUrl(template.replace('{tracking_number}', encodeURIComponent(trackingNumber)))
  },
}
