const graph = (path: string) =>
  `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION ?? 'v24.0'}/${path}`

/** The Page a token belongs to (`page_id`), and the token saved for it, if any. */
export type PageTokenSource = { page_id: string | null; page_access_token: string | null }

/**
 * The Page access token for a tenant. Each tenant stores its own (tenants.page_access_token).
 * The shared FB_PAGE_TOKEN / PAGE_ACCESS_TOKEN from .env.local is a fallback for single-Page
 * setups, and is never used for a Page other than FB_PAGE_ID (PSIDs are scoped to one Page,
 * so another Page's token could only fail, or reach the wrong person).
 * null when no usable token exists.
 */
export function pageTokenFor(source: PageTokenSource | null): string | null {
  const own = source?.page_access_token?.trim()
  if (own) return own
  // `||` rather than `??` so an empty FB_PAGE_TOKEN= line still falls back to PAGE_ACCESS_TOKEN
  const shared = (process.env.FB_PAGE_TOKEN || process.env.PAGE_ACCESS_TOKEN || '').trim()
  if (!shared) return null
  const sharedPage = process.env.FB_PAGE_ID?.trim()
  if (source?.page_id && sharedPage && source.page_id !== sharedPage) return null
  return shared
}

export class MissingPageTokenError extends Error {
  constructor() {
    super('ร้านนี้ยังไม่ได้ตั้ง Page Access Token (ตั้งค่าร้านค้า > Facebook Page)')
  }
}

function requireToken(token: string | null): string {
  if (!token) throw new MissingPageTokenError()
  return token
}
const auth = (token: string | null) => ({ Authorization: `Bearer ${requireToken(token)}` })

/** Send any message. Only works within 24 h of the customer's last message (Meta's standard window). */
async function sendMessage(token: string | null, psid: string, message: object) {
  const res = await fetch(graph('me/messages'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Send API ${res.status}: ${await res.text()}`)
}

export const sendText = (token: string | null, psid: string, text: string) => sendMessage(token, psid, { text })

export type PaymentCard = { title: string; subtitle: string; imageUrl?: string | null }

/**
 * Payment summary as a Messenger generic template (Messenger's counterpart of a LINE Flex card).
 * Meta limits title and subtitle to 80 characters each.
 */
export const sendPaymentCard = (token: string | null, psid: string, card: PaymentCard) =>
  sendMessage(token, psid, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [{ title: card.title.slice(0, 80), subtitle: card.subtitle.slice(0, 80), ...(card.imageUrl ? { image_url: card.imageUrl } : {}) }],
      },
    },
  })

/** Public reply under a comment. Needs the pages_manage_engagement permission. */
export async function replyToComment(token: string | null, commentId: string, text: string) {
  const res = await fetch(graph(`${commentId}/comments`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ message: text }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Comment reply ${res.status}: ${await res.text()}`)
}

export type OutgoingMessage = { text: string } | { attachment: { type: 'image'; payload: { url: string; is_reusable: boolean } } }

/**
 * Private reply: a Messenger message to a comment's author. Meta allows one per comment,
 * within 7 days of the comment; more can follow only after the person answers.
 */
export async function privateReply(token: string | null, commentId: string, message: OutgoingMessage) {
  const res = await fetch(graph('me/messages'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Private reply ${res.status}: ${await res.text()}`)
}

/** The customer's name, or null (no token, or Meta refused). Never throws. */
export async function getName(token: string | null, psid: string): Promise<string | null> {
  if (!token) return null
  try {
    const res = await fetch(graph(`${psid}?fields=name`), { headers: auth(token), signal: AbortSignal.timeout(10_000) })
    return res.ok ? ((await res.json()).name ?? null) : null
  } catch {
    return null
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** GET a Graph path. Never throws: status 0 = network error / timeout. Not cached (tokens change). */
async function graphGet(path: string, token: string): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(graph(path), { headers: auth(token), signal: AbortSignal.timeout(10_000), cache: 'no-store' })
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) }
  } catch {
    return { ok: false, status: 0, json: null }
  }
}

/** Meta's own error text, e.g. "(#190) Error validating access token ... (code 190/463)" */
const graphError = (json: any, status: number) => {
  const e = json?.error
  return e ? `${e.message ?? 'Graph API error'} (code ${e.code ?? '?'}${e.error_subcode ? `/${e.error_subcode}` : ''})` : `HTTP ${status}`
}

export type PageTokenCheck =
  /** token: the Page token to save (a User token is exchanged for its Page's token) */
  | { ok: true; pageId: string; token: string; warnings: string[] }
  | { ok: false; error: string }

const fail = (error: string): PageTokenCheck => ({ ok: false, error })

/**
 * Check a token before saving it, with /debug_token: it answers with the token's type, Page,
 * expiry and permissions, and needs no permission itself. (GET /me?fields=id,name would need
 * pages_read_engagement, which a messaging-only Page token doesn't have, so a perfectly good
 * token would be rejected.)
 *   - Page token: must belong to `pageId` (when given) and carry pages_messaging
 *   - User token: exchanged for the Page token of `pageId` through /me/accounts
 */
export async function inspectPageToken(token: string, pageId: string | null): Promise<PageTokenCheck> {
  const r = await graphGet(`debug_token?input_token=${encodeURIComponent(token)}`, token)
  if (r.status === 0) return fail('ติดต่อ Meta Graph API ไม่ได้ (เครือข่ายหรือ timeout) ลองบันทึกใหม่อีกครั้ง')
  if (!r.ok) return fail(`Meta ไม่ยอมรับ token นี้: ${graphError(r.json, r.status)}`)
  const d = r.json?.data
  if (!d?.is_valid) {
    return fail(`token ใช้ไม่ได้แล้ว (หมดอายุ ถูกเพิกถอน หรือเปลี่ยนรหัสผ่าน)${d?.error?.message ? `: ${d.error.message}` : ''}`)
  }
  if (d.type === 'USER') return exchangeUserToken(token, pageId)
  if (d.type !== 'PAGE' || !d.profile_id) return fail(`token นี้เป็นชนิด ${d.type ?? 'ไม่ทราบ'} ต้องใช้ Page Access Token`)

  const tokenPage = String(d.profile_id)
  if (pageId && tokenPage !== pageId) return fail(`token นี้เป็นของเพจ ${tokenPage} ไม่ใช่เพจ ${pageId} ที่กรอกไว้`)
  const scopes: string[] = Array.isArray(d.scopes) ? d.scopes : []
  if (!scopes.includes('pages_messaging')) {
    return fail(`token ของเพจ ${tokenPage} ไม่มีสิทธิ์ pages_messaging (ตอบแชทไม่ได้) สิทธิ์ที่มี: ${scopes.join(', ') || 'ไม่มี'}`)
  }
  const warnings: string[] = []
  if (!scopes.includes('pages_manage_engagement')) warnings.push('ไม่มีสิทธิ์ pages_manage_engagement: ตอบกลับใต้คอมเมนต์อัตโนมัติไม่ได้')
  if (!scopes.includes('pages_read_engagement')) warnings.push('ไม่มีสิทธิ์ pages_read_engagement: แสดงชื่อ/รูปเพจไม่ได้ และคอมเมนต์อาจไม่มีชื่อผู้เขียน (ตอบแชทได้ตามปกติ)')
  if (Number(d.expires_at) > 0) {
    const at = new Date(Number(d.expires_at) * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
    warnings.push(`token นี้หมดอายุ ${at}: ควรใช้ Page token ที่ได้จาก long-lived User token (ไม่มีวันหมดอายุ)`)
  }
  return { ok: true, pageId: tokenPage, token, warnings }
}

/** A User token was pasted: take the token of the Page this tenant uses from /me/accounts. */
async function exchangeUserToken(userToken: string, pageId: string | null): Promise<PageTokenCheck> {
  const r = await graphGet('me/accounts?fields=id,name,access_token&limit=100', userToken)
  if (!r.ok) {
    return fail(`นี่คือ User Access Token และแลกเป็น Page token ไม่ได้ (ต้องมีสิทธิ์ pages_show_list): ${r.status ? graphError(r.json, r.status) : 'ติดต่อ Meta ไม่ได้'}`)
  }
  const pages: { id: string; name: string; access_token?: string }[] = r.json?.data ?? []
  const page = pageId ? pages.find((p) => p.id === pageId) : pages.length === 1 ? pages[0] : undefined
  if (!page?.access_token) {
    const list = pages.map((p) => `${p.name} (${p.id})`).join(', ') || 'ไม่มี'
    return fail(
      pageId
        ? `บัญชีของ User token นี้ไม่ได้เป็นแอดมินของเพจ ${pageId} (เพจที่เข้าถึงได้: ${list})`
        : `User token นี้เข้าถึงได้หลายเพจ: กรอก Facebook Page ID ก่อน (เพจที่เข้าถึงได้: ${list})`,
    )
  }
  const check = await inspectPageToken(page.access_token, page.id)
  return check.ok ? { ...check, warnings: [`แปลง User token เป็น Page token ของ ${page.name} ให้แล้ว`, ...check.warnings] } : check
}

export type PageProfile = { id: string; name: string; picture: string | null }

/** The Page that owns this token (`me` = the Page itself for a Page token). null if missing or rejected. */
export async function getPageProfile(token: string | null): Promise<PageProfile | null> {
  if (!token) return null
  try {
    const res = await fetch(graph('me?fields=id,name,picture.type(large)'), {
      headers: auth(token),
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 300 },
    })
    if (!res.ok) return null
    const data = await res.json()
    return { id: String(data.id), name: data.name, picture: data.picture?.data?.url ?? null }
  } catch {
    return null
  }
}
