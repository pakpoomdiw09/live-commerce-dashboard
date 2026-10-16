import 'server-only'
import { graph, getPageTokenStatus } from '@/lib/facebook'

/**
 * "เชื่อมต่อเพจด้วย Facebook": the Meta app that owns the Page webhook asks the user for their
 * Pages. Not a sign-in: the user is already signed in to the dashboard.
 *
 * Business-type Meta apps use Facebook Login for Business, which ignores `scope` and takes the
 * permissions from a configuration (FB_LOGIN_CONFIG_ID). Other app types use SCOPES.
 */
// Login and Page permissions requested by the dashboard.
export const SCOPES = ['public_profile', 'pages_show_list', 'pages_messaging']

const appId = () => (process.env.FB_APP_ID || process.env.NEXT_PUBLIC_FB_APP_ID || '').trim()
const appSecret = () => (process.env.FB_APP_SECRET ?? '').trim()

export const isFacebookConnectConfigured = () => !!appId() && !!appSecret()

/** CSRF cookie: the callback only accepts the state this browser was given. */
export const STATE_COOKIE = 'fb_oauth_state'
export const STATE_COOKIE_PATH = '/api/auth/facebook'
/** Where Facebook sends the user back. Add it to "Valid OAuth Redirect URIs" in the Meta app. */
export const callbackUrl = (origin: string) => new URL('/api/auth/facebook/callback', origin).toString()

/** The Login dialog the browser is sent to. */
export function dialogUrl(redirectUri: string, state: string) {
  const version = process.env.FB_GRAPH_VERSION ?? 'v24.0'
  const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`)
  url.searchParams.set('client_id', appId())
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  const configId = process.env.FB_LOGIN_CONFIG_ID?.trim()
  if (configId) url.searchParams.set('config_id', configId)
  else url.searchParams.set('scope', SCOPES.join(','))
  return url.toString()
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const e = json?.error
    throw new Error(e ? `${e.message ?? 'Graph API error'} (code ${e.code ?? '?'})` : `HTTP ${res.status}`)
  }
  return json
}

/**
 * Code from the dialog -> long-lived User token. Page tokens read with a long-lived User token
 * don't expire, so the shop doesn't have to reconnect every hour.
 * `redirectUri` must be exactly the one the dialog was opened with.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const q = new URLSearchParams({ client_id: appId(), client_secret: appSecret(), redirect_uri: redirectUri, code })
  const short = await getJson(graph(`oauth/access_token?${q}`))
  const l = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId(), client_secret: appSecret(), fb_exchange_token: short.access_token })
  const long = await getJson(graph(`oauth/access_token?${l}`))
  return long.access_token
}

export type ConnectedPage = { id: string; name: string; picture: string | null; accessToken: string; tasks?: string[] }

/** Only server-fetched /me/accounts results may enter this flow; never accept browser tokens. */
export async function verifiedAdminPages(pages: ConnectedPage[]): Promise<ConnectedPage[]> {
  const verified: ConnectedPage[] = []
  for (const page of pages) {
    if (!page.tasks?.includes('MANAGE')) {
      console.warn('[facebook-sync] Page skipped: missing MANAGE task', { pageId: page.id })
      continue
    }
    const status = await getPageTokenStatus(page.accessToken, page.id)
    if (status !== 'verified') {
      console.warn('[facebook-sync] Page skipped: token not verified', { pageId: page.id, status })
      continue
    }
    verified.push(page)
  }
  return verified
}

/** Every Page the user granted, with its Page token (first 100). */
export async function listPages(userToken: string, version = process.env.FB_GRAPH_VERSION ?? 'v24.0'): Promise<ConnectedPage[]> {
  const pages = new Map<string, ConnectedPage>()
  const cursors = new Set<string>()
  const q = new URLSearchParams({ fields: 'id,name,access_token,category,tasks,picture.type(large)', limit: '100' })
  while (true) {
    const res = await fetch(`https://graph.facebook.com/${version}/me/accounts?${q}`, {
      headers: { Authorization: `Bearer ${userToken}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    })
    const json = await res.json()
    if (process.env.FB_DEBUG === 'true') console.log('[facebook/accounts] Graph response', {
      status: res.status, data: Array.isArray(json?.data) ? json.data.map((p: { id?: string; name?: string; access_token?: string; picture?: { data?: { url?: string } } }) => ({
        id: p.id, name: p.name, picture: { data: { url: p.picture?.data?.url ?? null } },
        page_access_token: p.access_token ? `[REDACTED: ${p.access_token.length} characters]` : null,
      })) : null, hasNextPage: !!json?.paging?.next, errorCode: json?.error?.code ?? null,
    })
    if ((!res.ok || json.error) && [10, 100, 200].includes(Number(json?.error?.code)) && q.get('fields')?.includes('picture')) {
      // Photo permissions must not prevent login/Page synchronization from succeeding.
      q.set('fields', 'id,name,access_token,category,tasks')
      if (process.env.FB_DEBUG === 'true') console.log('[facebook/accounts] retry without optional picture field')
      continue
    }
    if (!res.ok || json.error || !Array.isArray(json.data)) throw new Error('Facebook Page lookup failed')
    for (const p of json.data) {
      if (!p.id || !p.access_token) throw new Error('Facebook did not return a Page access token')
      const image = p.picture?.data?.url
      let picture: string | null = null
      try { if (typeof image === 'string' && ['https:', 'http:'].includes(new URL(image).protocol)) picture = image } catch { /* Missing/invalid picture is not a failed Page connection. */ }
      pages.set(String(p.id), { id: String(p.id), name: String(p.name ?? p.id), picture, accessToken: String(p.access_token), tasks: Array.isArray(p.tasks) ? p.tasks.filter((task: unknown) => typeof task === 'string') : [] })
    }
    if (!json.paging?.next) break
    const after = json.paging?.cursors?.after
    if (!after || cursors.has(after)) throw new Error('Invalid Facebook pagination')
    cursors.add(after)
    q.set('after', after)
  }
  return [...pages.values()]
}

/**
 * Subscribe our app to the Page's webhook (messages, comments), so the shop doesn't have to do
 * it in the Meta dashboard. Needs pages_manage_metadata. Returns Meta's error text, or null.
 */
export async function subscribePage(pageId: string, pageToken: string): Promise<string | null> {
  try {
    const res = await fetch(graph(`${pageId}/subscribed_apps`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${pageToken}` },
      body: new URLSearchParams({ subscribed_fields: 'messages,feed' }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return null
    const e = (await res.json().catch(() => null))?.error
    return e?.message ?? `HTTP ${res.status}`
  } catch (e) {
    return e instanceof Error ? e.message : 'network error'
  }
}
