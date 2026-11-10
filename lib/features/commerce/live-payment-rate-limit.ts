import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type LivePaymentRateLimit = 'allowed' | 'limited' | 'unavailable'
type Method = 'get' | 'post'

function bucket(scope: string, value: string) {
  const digest = createHash('sha256').update(value).digest('hex')
  return `live-pay:v1:${scope}:${digest}`
}

async function check(db: SupabaseClient, key: string, maximum: number): Promise<LivePaymentRateLimit> {
  try {
    const { data, error } = await db.rpc('commerce_rate_limit', {
      p_bucket: key,
      p_max: maximum,
    })
    if (error) return 'unavailable'
    return data === true ? 'allowed' : 'limited'
  } catch {
    return 'unavailable'
  }
}

/** Shared, database-backed limits so separate serverless instances use the same counters. */
export function limitLivePaymentIp(
  db: SupabaseClient,
  headers: Headers,
  method: Method,
): Promise<LivePaymentRateLimit> {
  // No proxy header is configured or verified as ingress-controlled in this repository.
  // Do not build an IP bucket from client-supplied forwarding headers. Keep the
  // per-order limit active until the deployment trust boundary is confirmed.
  void db
  void headers
  void method
  return Promise.resolve('allowed')
}

/** A valid signed link is additionally limited by order, even if its visitor changes IPs. */
export function limitLivePaymentOrder(
  db: SupabaseClient,
  orderId: string,
  method: Method,
): Promise<LivePaymentRateLimit> {
  return check(db, bucket(`${method}:order`, orderId), method === 'get' ? 20 : 5)
}
