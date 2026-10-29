import type { MessageTag } from '@/lib/features/agents/chatbot'
import {
  createLogRequestId,
  logSafeEvent,
  maskErrorCode,
  type SafeEventType,
} from '@/lib/safe-logging'

export const graph = (path: string) =>
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
  if (source?.page_id && (!sharedPage || source.page_id !== sharedPage)) return null
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

/**
 * RESPONSE answers the customer's message; UPDATE is a message the Page starts itself
 * (reminders, broadcasts). Both only work within 24 h of the customer's last message.
 * `{ tag }` sends with messaging_type MESSAGE_TAG: allowed after the 24 h window, but only
 * for the kind of message the tag names (never promotions).
 */
export type MessagingType = 'RESPONSE' | 'UPDATE' | { tag: MessageTag }

const messagingFields = (t: MessagingType) =>
  typeof t === 'string' ? { messaging_type: t } : { messaging_type: 'MESSAGE_TAG', tag: t.tag }

/** A refused Send API call, with Meta's error code and subcode. */
export class SendApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly providerMessage: string | null = null,
    readonly responseData: string | null = null,
  ) {
    super(`Facebook message request failed (HTTP ${status})`)
  }
}

/** Preserve Meta's explanation without copying credentials or the outgoing message into diagnostics. */
function providerErrorMessage(
  value: unknown,
  token: string | null,
  psid: string,
  message: object,
): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let text = value
  const outgoingText = (message as { text?: unknown }).text
  const secrets = [
    token,
    psid,
    typeof outgoingText === 'string' ? outgoingText : null,
    ...Object.entries(process.env)
      .filter(([key]) => /TOKEN|SECRET|API_KEY|SERVICE_ROLE_KEY/i.test(key))
      .map(([, secret]) => secret),
  ].filter((secret): secret is string => typeof secret === 'string' && secret.length > 0)
  for (const secret of secrets.sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[REDACTED]')
    text = text.split(encodeURIComponent(secret)).join('[REDACTED]')
  }
  return text
    .replace(/Bearer\s+[^\s"'&,)]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:access_token|appsecret_proof|client_secret)\s*[=:]\s*)[^\s&"',)]+/gi,
      '$1[REDACTED]',
    )
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
}

/** Serialize diagnostics in full, redacting credentials and reflected customer content. */
function providerErrorDetails(
  value: unknown,
  token: string | null,
  recipientId: string,
  message: object,
): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return providerErrorMessage(value, token, recipientId, message)
    }
  }
  const serialized = JSON.stringify(value, (key, item) => {
    if (/token|secret|authorization|password|account|customer_name|recipient_id|psid/i.test(key))
      return '[REDACTED]'
    return typeof item === 'string' ? providerErrorMessage(item, token, recipientId, message) : item
  })
  return serialized ?? null
}

function logSendFailure(
  error: unknown,
  token: string | null,
  recipientId: string,
  message: object,
) {
  try {
    const failure = error as {
      message?: unknown
      response?: { status?: unknown; data?: unknown }
    } | null
    const responseData =
      error instanceof SendApiError
        ? error.responseData
        : providerErrorDetails(failure?.response?.data, token, recipientId, message)
    console.error(
      '[facebook/send] Graph API request failed ' +
        JSON.stringify({
          httpStatus: error instanceof SendApiError ? error.status : failure?.response?.status,
          errorCode: error instanceof SendApiError ? error.code : undefined,
          errorSubcode: error instanceof SendApiError ? error.subcode : undefined,
          message:
            error instanceof SendApiError
              ? (error.providerMessage ?? error.message)
              : providerErrorMessage(
                  typeof error === 'string' ? error : failure?.message,
                  token,
                  recipientId,
                  message,
                ),
          responseData,
        }),
    )
  } catch {
    // Diagnostics must not change delivery status or trigger a duplicate send.
  }
}

/**
 * Code 10 alone can mean missing permissions. Only known window subcodes or
 * Meta's explicit timing/tag explanation identify a window/tag rejection.
 */
export const isWindowOrTagError = (e: unknown) =>
  e instanceof SendApiError &&
  (e.subcode === 2018001 ||
    e.subcode === 2018278 ||
    (e.code === 10 &&
      /outside.*(?:24[ -]?hour|messaging window)|(?:24[ -]?hour|messaging) window.*(?:closed|expired)|message tag/i.test(
        e.providerMessage ?? '',
      )))

export const WINDOW_OR_TAG_ERROR =
  'เกินระยะเวลาที่ระบบ Facebook อนุญาต หรือหมวดหมู่ข้อความไม่ตรงกับเนื้อหา'

/** Never propagate a fetch/JSON exception carrying a URL, response body or nested cause. */
async function facebookOperation<T>(
  eventType: SafeEventType,
  work: () => Promise<T>,
  onError?: (error: unknown) => void,
): Promise<T> {
  const requestId = createLogRequestId(),
    startedAt = Date.now()
  try {
    const result = await work()
    logSafeEvent({ requestId, eventType, status: 'succeeded', durationMs: Date.now() - startedAt })
    return result
  } catch (error) {
    onError?.(error)
    const known = error instanceof SendApiError || error instanceof MissingPageTokenError
    logSafeEvent({
      requestId,
      eventType,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      errorCode:
        error instanceof SendApiError
          ? maskErrorCode(error.code)
          : error instanceof MissingPageTokenError
            ? 'AUTH_***'
            : 'NETWORK_***',
    })
    if (known) throw error
    throw new Error('Facebook request could not be completed')
  }
}

/** Send any message. Without a tag, only works within 24 h of the customer's last message (Meta's standard window). */
export async function sendMessageWithReceipt(
  token: string | null,
  psid: string,
  message: object,
  messagingType: MessagingType = 'RESPONSE',
): Promise<string> {
  return facebookOperation(
    'facebook.send_message',
    async () => {
      const num = (value: unknown) =>
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 2_147_483_647
          ? value
          : null
      const res = await fetch(graph('me/messages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(token) },
        body: JSON.stringify({
          ...messagingFields(messagingType),
          recipient: { id: psid },
          message,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const body = await res.text()
        let err: { message?: unknown; code?: unknown; error_subcode?: unknown } | undefined
        try {
          err = JSON.parse(body)?.error
        } catch {}
        throw new SendApiError(
          res.status,
          num(err?.code),
          num(err?.error_subcode),
          providerErrorMessage(err?.message, token, psid, message),
          providerErrorDetails(body, token, psid, message),
        )
      }
      const receipt = await res.json()
      if (receipt?.error)
        throw new SendApiError(
          res.status,
          num(receipt.error.code),
          num(receipt.error.error_subcode),
          providerErrorMessage(receipt.error.message, token, psid, message),
          providerErrorDetails(receipt, token, psid, message),
        )
      if (typeof receipt?.message_id !== 'string' || !receipt.message_id.trim())
        throw new Error('Messenger did not return a message receipt')
      return receipt.message_id
    },
    (error) => logSendFailure(error, token, psid, message),
  )
}

export async function sendMessage(
  token: string | null,
  psid: string,
  message: object,
  messagingType: MessagingType = 'RESPONSE',
): Promise<void> {
  await sendMessageWithReceipt(token, psid, message, messagingType)
}

export const sendText = (
  token: string | null,
  psid: string,
  text: string,
  messagingType: MessagingType = 'RESPONSE',
) => sendMessage(token, psid, { text }, messagingType)

/** Quick reply buttons under a message: tapping one sends its title back as the customer's text. */
export const quickReplies = (titles: string[]) => {
  const labels = titles.map((title) => title.trim()).filter(Boolean)
  return labels.length
    ? {
        quick_replies: labels
          .slice(0, 13)
          .map((t) => ({ content_type: 'text', title: t.slice(0, 20), payload: t.slice(0, 1000) })),
      }
    : {}
}

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
        elements: [
          {
            title: card.title.slice(0, 80),
            subtitle: card.subtitle.slice(0, 80),
            ...(card.imageUrl ? { image_url: card.imageUrl } : {}),
          },
        ],
      },
    },
  })

/** Public reply under a comment. Needs the pages_manage_engagement permission. */
export async function replyToComment(token: string | null, commentId: string, text: string) {
  return facebookOperation('facebook.comment_reply', async () => {
    const res = await fetch(graph(`${commentId}/comments`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error('Facebook comment reply failed')
  })
}

export type OutgoingMessage =
  | { text: string }
  | { attachment: { type: 'image'; payload: { url: string; is_reusable: boolean } } }

/**
 * Private reply: a Messenger message to a comment's author. Meta allows one per comment,
 * within 7 days of the comment; more can follow only after the person answers.
 */
export async function privateReply(
  token: string | null,
  commentId: string,
  message: OutgoingMessage,
) {
  return facebookOperation(
    'facebook.private_reply',
    async () => {
      const res = await fetch(graph('me/messages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(token) },
        body: JSON.stringify({ recipient: { comment_id: commentId }, message }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        throw Object.assign(new Error('Facebook private reply failed'), {
          response: { status: res.status, data: await res.text() },
        })
      }
    },
    (error) => logSendFailure(error, token, commentId, message),
  )
}

/** The customer's name, or null (no token, or Meta refused). Never throws. */
export async function getName(token: string | null, psid: string): Promise<string | null> {
  if (!token) return null
  try {
    const res = await fetch(graph(`${psid}?fields=name`), {
      headers: auth(token),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok ? ((await res.json()).name ?? null) : null
  } catch {
    return null
  }
}

/** Best-effort Messenger profile lookup. Never exposes tokens or interrupts delivery. */
export async function getCustomerProfile(
  token: string | null,
  psid: string,
): Promise<{ display_name?: string; avatar_url?: string }> {
  const requestId = createLogRequestId(),
    startedAt = Date.now()
  const record = (
    status: 'succeeded' | 'failed' | 'skipped',
    errorCode?: Parameters<typeof logSafeEvent>[0]['errorCode'],
  ) =>
    logSafeEvent({
      requestId,
      eventType: 'facebook.customer_profile',
      status,
      durationMs: Date.now() - startedAt,
      ...(errorCode ? { errorCode } : {}),
    })
  if (!token || !/^\d+$/.test(psid)) {
    record('skipped', !token ? 'AUTH_***' : 'INPUT_***')
    return {}
  }
  const url = graph(`${encodeURIComponent(psid)}?fields=first_name,last_name,name,profile_pic`)
  try {
    const res = await fetch(url, {
      headers: auth(token),
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    })
    const data = await res.json()
    if (!res.ok || !data || data.error) {
      record('failed', maskErrorCode(data?.error?.code))
      return {}
    }
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const name =
      text(data.name) || [text(data.first_name), text(data.last_name)].filter(Boolean).join(' ')
    const picture = text(data.profile_pic)
    let avatar: string | undefined
    try {
      const url = new URL(picture)
      if (url.protocol === 'https:') avatar = url.href
    } catch {}
    record('succeeded')
    return { ...(name ? { display_name: name } : {}), ...(avatar ? { avatar_url: avatar } : {}) }
  } catch {
    record('failed', 'NETWORK_***')
    return {}
  }
}

/** GET a Graph path. Never throws: status 0 = network error / timeout. Not cached (tokens change). */
async function graphGet(
  path: string,
  token: string,
): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(graph(path), {
      headers: auth(token),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) }
  } catch {
    return { ok: false, status: 0, json: null }
  }
}

export type PageTokenStatus = 'verified' | 'limited' | 'invalid' | 'unverified'

/**
 * Read-only connection check, independent of permission to read the Page's name/picture.
 * A failed debug request cannot establish that its input token is invalid: Meta may instead
 * reject the app credential used to authorize the check. Only a successful debug response
 * establishes token validity, Page ownership, expiry and messaging permission.
 */
export async function getPageTokenStatus(token: string, pageId: string): Promise<PageTokenStatus> {
  if (!token.trim() || !pageId.trim()) return 'invalid'
  const appId = (process.env.FB_APP_ID || process.env.NEXT_PUBLIC_FB_APP_ID || '').trim()
  const appSecret = (process.env.FB_APP_SECRET ?? '').trim()
  const debugAuthorization = appId && appSecret ? `${appId}|${appSecret}` : token
  const startedAt = Date.now()
  const result = await graphGet(
    `debug_token?input_token=${encodeURIComponent(token)}`,
    debugAuthorization,
  )
  if (process.env.FB_DEBUG === 'true')
    logSafeEvent({
      requestId: createLogRequestId(),
      eventType: 'facebook.page_token',
      status: result.status || 'failed',
      durationMs: Date.now() - startedAt,
      ...(result.json?.error ? { errorCode: maskErrorCode(result.json.error.code) } : {}),
    })
  if (!result.ok || result.json?.error) return 'unverified'
  const data = result.json?.data
  if (!data || typeof data !== 'object' || typeof data.is_valid !== 'boolean') return 'unverified'
  if (!data.is_valid) return 'invalid'
  if (typeof data.type !== 'string') return 'unverified'
  if (data.type !== 'PAGE') return 'invalid'
  if (!['string', 'number'].includes(typeof data.profile_id) || !String(data.profile_id).trim())
    return 'unverified'
  if (String(data.profile_id) !== pageId) return 'invalid'
  for (const value of [data.expires_at, data.data_access_expires_at]) {
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'unverified'
    if (value > 0 && value <= Date.now() / 1000) return 'invalid'
  }
  if (
    !Array.isArray(data.scopes) ||
    data.scopes.some((scope: unknown) => typeof scope !== 'string')
  )
    return 'unverified'
  return data.scopes.includes('pages_messaging') ? 'verified' : 'limited'
}

/** Provider text may echo credentials; return only a fixed masked category. */
const graphError = (json: any, status: number) => {
  return `HTTP ${status} (${maskErrorCode(json?.error?.code)})`
}

export type PageTokenCheck =
  /** token: the Page token to save (a User token is exchanged for its Page's token) */
  { ok: true; pageId: string; token: string; warnings: string[] } | { ok: false; error: string }

const fail = (error: string): PageTokenCheck => ({ ok: false, error })

/**
 * Check a token before saving it, with /debug_token: it answers with the token's type, Page,
 * expiry and permissions, and needs no permission itself. (GET /me?fields=id,name would need
 * pages_read_engagement, which a messaging-only Page token doesn't have, so a perfectly good
 * token would be rejected.)
 *   - Page token: must belong to `pageId` (when given) and carry pages_messaging
 *   - User token: exchanged for the Page token of `pageId` through /me/accounts
 */
export async function inspectPageToken(
  token: string,
  pageId: string | null,
): Promise<PageTokenCheck> {
  const r = await graphGet(`debug_token?input_token=${encodeURIComponent(token)}`, token)
  if (r.status === 0)
    return fail('ติดต่อ Meta Graph API ไม่ได้ (เครือข่ายหรือ timeout) ลองบันทึกใหม่อีกครั้ง')
  if (!r.ok) return fail(`Meta ไม่ยอมรับ token นี้: ${graphError(r.json, r.status)}`)
  const d = r.json?.data
  if (!d?.is_valid) {
    return fail('token ใช้ไม่ได้แล้ว (หมดอายุ ถูกเพิกถอน หรือเปลี่ยนรหัสผ่าน)')
  }
  if (d.type === 'USER') return exchangeUserToken(token, pageId)
  if (d.type !== 'PAGE' || !d.profile_id)
    return fail(`token นี้เป็นชนิด ${d.type ?? 'ไม่ทราบ'} ต้องใช้ Page Access Token`)

  const tokenPage = String(d.profile_id)
  if (pageId && tokenPage !== pageId)
    return fail(`token นี้เป็นของเพจ ${tokenPage} ไม่ใช่เพจ ${pageId} ที่กรอกไว้`)
  const scopes: string[] = Array.isArray(d.scopes) ? d.scopes : []
  if (!scopes.includes('pages_messaging')) {
    return fail(
      `token ของเพจ ${tokenPage} ไม่มีสิทธิ์ pages_messaging (ตอบแชทไม่ได้) สิทธิ์ที่มี: ${scopes.join(', ') || 'ไม่มี'}`,
    )
  }
  const warnings: string[] = []
  if (!scopes.includes('pages_manage_engagement'))
    warnings.push('ไม่มีสิทธิ์ pages_manage_engagement: ตอบกลับใต้คอมเมนต์อัตโนมัติไม่ได้')
  if (!scopes.includes('pages_read_engagement'))
    warnings.push(
      'ไม่มีสิทธิ์ pages_read_engagement: แสดงชื่อ/รูปเพจไม่ได้ และคอมเมนต์อาจไม่มีชื่อผู้เขียน (ตอบแชทได้ตามปกติ)',
    )
  if (Number(d.expires_at) > 0) {
    const at = new Date(Number(d.expires_at) * 1000).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
    })
    warnings.push(
      `token นี้หมดอายุ ${at}: ควรใช้ Page token ที่ได้จาก long-lived User token (ไม่มีวันหมดอายุ)`,
    )
  }
  return { ok: true, pageId: tokenPage, token, warnings }
}

/** A User token was pasted: take the token of the Page this tenant uses from /me/accounts. */
async function exchangeUserToken(
  userToken: string,
  pageId: string | null,
): Promise<PageTokenCheck> {
  const r = await graphGet('me/accounts?fields=id,name,access_token&limit=100', userToken)
  if (!r.ok) {
    return fail(
      `นี่คือ User Access Token และแลกเป็น Page token ไม่ได้ (ต้องมีสิทธิ์ pages_show_list): ${r.status ? graphError(r.json, r.status) : 'ติดต่อ Meta ไม่ได้'}`,
    )
  }
  const pages: { id: string; name: string; access_token?: string }[] = r.json?.data ?? []
  const page = pageId
    ? pages.find((p) => p.id === pageId)
    : pages.length === 1
      ? pages[0]
      : undefined
  if (!page?.access_token) {
    const list = pages.map((p) => `${p.name} (${p.id})`).join(', ') || 'ไม่มี'
    return fail(
      pageId
        ? `บัญชีของ User token นี้ไม่ได้เป็นแอดมินของเพจ ${pageId} (เพจที่เข้าถึงได้: ${list})`
        : `User token นี้เข้าถึงได้หลายเพจ: กรอก Facebook Page ID ก่อน (เพจที่เข้าถึงได้: ${list})`,
    )
  }
  const check = await inspectPageToken(page.access_token, page.id)
  return check.ok
    ? {
        ...check,
        warnings: [`แปลง User token เป็น Page token ของ ${page.name} ให้แล้ว`, ...check.warnings],
      }
    : check
}

export type PageProfile = { id: string; name: string; picture: string | null }

/** The picture endpoint can work even when Page metadata permission is unavailable. */
export async function getPagePicture(pageId: string, token: string | null): Promise<string | null> {
  if (!token || !/^\d+$/.test(pageId)) return null
  const requestId = createLogRequestId(),
    startedAt = Date.now()
  try {
    const response = await fetch(graph(`${pageId}/picture?type=large&redirect=false`), {
      headers: auth(token),
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 300 },
    })
    const data = await response.json()
    if (process.env.FB_DEBUG === 'true')
      logSafeEvent({
        requestId,
        eventType: 'facebook.page_picture',
        status: response.status,
        durationMs: Date.now() - startedAt,
        ...(data?.error ? { errorCode: maskErrorCode(data.error.code) } : {}),
      })
    if (!response.ok || data?.error || typeof data?.data?.url !== 'string') return null
    const url = new URL(data.data.url)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    if (process.env.FB_DEBUG === 'true')
      logSafeEvent({
        requestId,
        eventType: 'facebook.page_picture',
        status: 'failed',
        durationMs: Date.now() - startedAt,
        errorCode: 'NETWORK_***',
      })
    return null
  }
}

/** The Page that owns this token (`me` = the Page itself for a Page token). null if missing or rejected. */
export async function getPageProfile(token: string | null): Promise<PageProfile | null> {
  const debug = process.env.FB_DEBUG === 'true'
  const requestId = createLogRequestId(),
    startedAt = Date.now()
  if (!token) {
    if (debug)
      logSafeEvent({
        requestId,
        eventType: 'facebook.page_profile',
        status: 'skipped',
        durationMs: Date.now() - startedAt,
        errorCode: 'AUTH_***',
      })
    return null
  }
  try {
    const res = await fetch(graph('me?fields=id,name,picture.type(large)'), {
      headers: auth(token),
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 300 },
    })
    const data = await res.json()
    if (debug)
      logSafeEvent({
        requestId,
        eventType: 'facebook.page_profile',
        status: res.status,
        durationMs: Date.now() - startedAt,
        ...(data?.error ? { errorCode: maskErrorCode(data.error.code) } : {}),
      })
    if (!res.ok || data?.error || !data?.id || typeof data.name !== 'string' || !data.name.trim())
      return null
    const url = data.picture?.data?.url
    let picture: string | null = null
    if (typeof url === 'string') {
      try {
        const parsed = new URL(url)
        if (['https:', 'http:'].includes(parsed.protocol)) picture = parsed.toString()
      } catch {
        /* invalid image URL: use the Facebook fallback */
      }
    }
    return { id: String(data.id), name: data.name.trim(), picture }
  } catch {
    if (debug)
      logSafeEvent({
        requestId,
        eventType: 'facebook.page_profile',
        status: 'failed',
        durationMs: Date.now() - startedAt,
        errorCode: 'NETWORK_***',
      })
    return null
  }
}
