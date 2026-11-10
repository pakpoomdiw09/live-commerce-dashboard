import 'server-only'
import { timingSafeEqual } from 'node:crypto'

/** Require the configured CRON_SECRET; unset or blank configuration always denies. */
export function verifyCronAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) return false

  const authorization = request.headers.get('authorization')
  if (authorization === null) return false

  const expected = Buffer.from(`Bearer ${secret}`, 'utf8')
  const supplied = Buffer.from(authorization, 'utf8')
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}
