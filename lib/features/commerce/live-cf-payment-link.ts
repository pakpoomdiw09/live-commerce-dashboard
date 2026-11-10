import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function secret() {
  const value = process.env.LIVE_CF_PAYMENT_LINK_SECRET?.trim() ?? ''
  const facebookWebhookSecret = process.env.FB_APP_SECRET?.trim() ?? ''
  return value.length >= 32 && value !== facebookWebhookSecret ? value : null
}

function signature(payload: string, key: string) {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

function appOrigin() {
  const raw =
    process.env.LIVE_CF_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (!raw) return null
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') return null
    return url.origin
  } catch {
    return null
  }
}

export function liveCfPaymentLinksReady(): boolean {
  return !!secret() && !!appOrigin()
}

export function createLiveCfPaymentLink(orderId: string, now = Date.now()): string | null {
  const key = secret()
  const origin = appOrigin()
  if (!key || !origin || !ORDER_ID.test(orderId)) return null
  const expires = Math.floor(now / 1000) + 24 * 60 * 60
  const token = `${orderId}.${expires}`
  const signedPayload = `live-cf-pay.v1.${orderId}.${expires}`
  return `${origin}/pay/live/${token}.${signature(signedPayload, key)}`
}

export function verifyLiveCfPaymentToken(
  token: string,
  now = Date.now(),
): { orderId: string; expires: number } | null {
  const key = secret()
  if (!key) return null
  const [orderId, rawExpires, supplied, ...extra] = token.split('.')
  if (!/^\d{10}$/.test(rawExpires ?? '')) return null
  const expires = Number(rawExpires)
  if (extra.length || !ORDER_ID.test(orderId) || !Number.isSafeInteger(expires)) return null
  if (expires < Math.floor(now / 1000) || expires > Math.floor(now / 1000) + 25 * 60 * 60)
    return null
  const expected = Buffer.from(signature(`live-cf-pay.v1.${orderId}.${expires}`, key))
  const actual = Buffer.from(supplied ?? '')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  return { orderId, expires }
}
