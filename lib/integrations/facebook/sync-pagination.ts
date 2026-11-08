import 'server-only'
import { graph } from '@/lib/integrations/facebook/client'
import { InboxError } from '@/lib/features/inbox/inbox-server'

export type GraphPaging = { next?: unknown; cursors?: { after?: unknown } }
export type GraphPage<T> = { data: T[]; paging?: GraphPaging }

const resource = (url: URL) => url.pathname.replace(/^\/v\d+\.\d+(?=\/)/, '').replace(/\/$/, '')

/** Follow only the same Graph edge. Never forward Page credentials to paging hosts or redirects. */
export function nextGraphPage(paging: GraphPaging | undefined, base: URL): URL | null {
  // Graph supplies an `after` cursor even on the last page: `next` is the continuation signal.
  if (paging?.next == null || paging.next === '') return null
  const trusted = new URL(base)
  let url: URL
  try {
    if (typeof paging.next !== 'string') throw new Error('Invalid paging URL')
    url = new URL(paging.next, trusted)
    // Meta may expand `me` to the Page ID (or use `me` in the continuation).
    if (/^\/\d+\/conversations$/.test(resource(trusted)) && resource(url) === '/me/conversations')
      url.pathname = url.pathname.replace('/me/conversations', resource(trusted))
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'graph.facebook.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      resource(url) !== resource(trusted)
    )
      throw new Error('Invalid paging URL')
  } catch {
    // A valid cursor lets us reconstruct the trusted edge without using a malformed next URL.
    if (typeof paging?.cursors?.after !== 'string' || !paging.cursors.after.trim())
      throw new InboxError('Facebook ส่งลิงก์หน้าถัดไปไม่ถูกต้อง', 502, 'FACEBOOK_PAGING_INVALID')
    url = trusted
    url.searchParams.delete('before')
    url.searchParams.set('after', paging.cursors.after)
  }
  url.searchParams.delete('access_token')
  url.searchParams.delete('appsecret_proof')
  for (const key of ['fields', 'limit', 'platform']) {
    const value = trusted.searchParams.get(key)
    if (!url.searchParams.has(key) && value !== null) url.searchParams.set(key, value)
  }
  url.searchParams.sort()
  return url
}

export function createFacebookSyncPager(token: string) {
  const seen = new Set<string>()
  const warnings: string[] = []
  const deadline = Date.now() + 40_000
  let requests = 0
  return {
    warnings,
    partial: false,
    hasTime() {
      return Date.now() < deadline
    },
    warn(error: unknown, phase: 'conversations' | 'messages') {
      this.partial = true
      const code = error instanceof InboxError ? error.code : 'FACEBOOK_SYNC_FAILED'
      if (!warnings.includes(code)) warnings.push(code)
      // Provider errors and next URLs can contain credentials. Log only fixed categories.
      console.warn('[inbox/sync] returning partial history', { phase, code })
    },
    url(path: string, fields: string) {
      const url = new URL(graph(path))
      url.searchParams.set('fields', fields)
      url.searchParams.set('limit', '100')
      return url
    },
    async read<T>(input: URL): Promise<GraphPage<T>> {
      const url = new URL(input)
      url.searchParams.delete('access_token')
      url.searchParams.delete('appsecret_proof')
      url.searchParams.sort()
      if (requests >= 50 || Date.now() >= deadline)
        throw new InboxError(
          'ซิงค์ถึงขีดจำกัดรอบนี้ กรุณาซิงค์ต่ออีกครั้ง',
          409,
          'FACEBOOK_SYNC_LIMIT',
        )
      if (seen.has(url.href))
        throw new InboxError('Facebook ส่งหน้าซ้ำ', 502, 'FACEBOOK_PAGING_REPEATED')
      seen.add(url.href)
      requests++
      let response: Response
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now()))),
        })
      } catch {
        throw new InboxError(
          'เชื่อมต่อ Facebook ไม่สำเร็จ กรุณาลองอีกครั้ง',
          502,
          'FACEBOOK_UNAVAILABLE',
        )
      }
      const result = await response.json().catch(() => null)
      if (result?.error?.code === 190)
        throw new InboxError(
          'Page Access Token ใช้ไม่ได้หรือหมดอายุ กรุณาเชื่อมต่อเพจใหม่',
          409,
          'FACEBOOK_TOKEN_INVALID',
        )
      if ([10, 200].includes(result?.error?.code))
        throw new InboxError(
          'Facebook ไม่อนุญาตให้อ่านข้อความ กรุณาตรวจ pages_messaging และเชื่อมต่อเพจใหม่',
          403,
          'FACEBOOK_PERMISSION_DENIED',
        )
      if (!response.ok || result?.error || !Array.isArray(result?.data))
        throw new InboxError('Facebook ไม่สามารถส่งประวัติข้อความได้', 502, 'FACEBOOK_SYNC_FAILED')
      return result as GraphPage<T>
    },
  }
}
