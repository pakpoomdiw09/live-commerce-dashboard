import 'server-only'
import { graph } from './client'

export type FacebookLiveVideo = {
  /** Video post ID, used by live_post_id when matching comment webhooks. */
  id: string
  title: string
  thumbnail: string | null
  createdAt: string | null
  isLive: boolean
}

export class LiveVideosError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly graphCode: number | null = null,
  ) {
    super(message)
  }
}

/** Keep the raw JSON structure for diagnostics, while removing credentials anywhere in it. */
function redact(value: unknown, credentials: string[]) {
  const secrets = [
    ...credentials,
    ...Object.entries(process.env)
      .filter(([key]) => /TOKEN|SECRET|API_KEY|SERVICE_ROLE_KEY/i.test(key))
      .map(([, secret]) => secret),
  ]
    .filter((secret): secret is string => typeof secret === 'string' && !!secret)
    .flatMap((secret) => [secret, encodeURIComponent(secret)])
    .sort((a, b) => b.length - a.length)
  return JSON.parse(
    JSON.stringify(value ?? null, (key, item) => {
      if (/token|secret|proof|authorization|stream_url|ingest_url|session_key/i.test(key))
        return '[REDACTED]'
      if (typeof item !== 'string') return item
      let safe = item
      for (const secret of secrets) safe = safe.split(secret).join('[REDACTED]')
      return safe
        .replace(/Bearer\s+[^\s"'&,)]+/gi, 'Bearer [REDACTED]')
        .replace(
          /((?:access_token|input_token|appsecret_proof|client_secret)\s*[=:]\s*)[^\s&"',)]+/gi,
          '$1[REDACTED]',
        )
    }),
  )
}

function providerFailure(payload: any, status: number, credentials: string[]) {
  const code = Number.isSafeInteger(Number(payload?.error?.code))
    ? Number(payload.error.code)
    : null
  const details =
    typeof payload?.error?.message === 'string'
      ? String(redact(payload.error.message, credentials))
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .slice(0, 600)
      : ''
  const reason =
    (payload?.error?.type === 'OAuthException' ? 'OAuthException' : 'Meta') +
    (code === null ? '' : ' #' + code) +
    (details ? ': ' + details : '')
  if (code === 190 || code === 102)
    return new LiveVideosError(
      'การเชื่อมต่อ Facebook ใช้ไม่ได้หรือหมดอายุ กรุณาเชื่อมต่อเพจใหม่ (' + reason + ')',
      409,
      code,
    )
  if ([4, 17, 32, 613].includes(code ?? -1) || status === 429)
    return new LiveVideosError(
      'Facebook จำกัดการเรียกข้อมูลชั่วคราว กรุณารอสักครู่ (' + reason + ')',
      429,
      code,
    )
  if (
    payload?.error?.type === 'OAuthException' ||
    [10, 200, 294].includes(code ?? -1) ||
    status === 403
  )
    return new LiveVideosError(
      'Facebook ปฏิเสธคำขอ กรุณาตรวจสอบสิทธิ์เพจหรือเชื่อมต่อใหม่ (' + reason + ')',
      403,
      code,
    )
  return new LiveVideosError('โหลดข้อมูลจาก Facebook ไม่สำเร็จ (' + reason + ')', 502, code)
}

async function readGraph(
  edge: string,
  params: URLSearchParams,
  token: string,
  signal: AbortSignal,
  authorization = token,
): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(graph(edge + '?' + params), {
        headers: { Authorization: 'Bearer ' + authorization },
        cache: 'no-store',
        signal,
      })
      const payload = await response.json().catch(() => null)
      try {
        console.log('[facebook/live-videos] Graph response', {
          edge,
          status: response.status,
          raw: redact(payload, [token, authorization]),
        })
      } catch {
        /* Diagnostics must not interrupt the picker. */
      }
      if (response.status >= 500 && attempt === 0 && !signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        continue
      }
      if (!response.ok || payload?.error)
        throw providerFailure(payload, response.status, [token, authorization])
      if (signal.aborted)
        throw new LiveVideosError('เชื่อมต่อ Facebook นานเกินไป กรุณาลองใหม่', 503)
      return payload
    } catch (error) {
      if (error instanceof LiveVideosError) throw error
      if (signal.aborted || attempt === 1)
        throw new LiveVideosError('เชื่อมต่อ Facebook ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 503)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new LiveVideosError('เชื่อมต่อ Facebook ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 503)
}

/** Read-only verification: do not silently exchange a stored User token or change credentials. */
export async function verifyLiveVideoPageToken(
  pageId: string,
  token: string,
  requestSignal?: AbortSignal,
) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(8_000),
    ...(requestSignal ? [requestSignal] : []),
  ])
  const appId = (process.env.FB_APP_ID || process.env.NEXT_PUBLIC_FB_APP_ID || '').trim()
  const appSecret = (process.env.FB_APP_SECRET ?? '').trim()
  const authorization = appId && appSecret ? appId + '|' + appSecret : token
  const payload = await readGraph(
    'debug_token',
    new URLSearchParams({ input_token: token }),
    token,
    signal,
    authorization,
  )
  const info = payload?.data
  if (typeof info?.is_valid !== 'boolean')
    throw new LiveVideosError(
      'ตรวจสอบชนิดโทเคน Facebook ไม่สำเร็จ กรุณาเชื่อมต่อเพจใหม่หรือติดต่อผู้ดูแล',
      503,
    )
  if (!info.is_valid)
    throw new LiveVideosError('โทเคน Facebook หมดอายุหรือถูกเพิกถอน กรุณาเชื่อมต่อเพจใหม่', 409)
  if (typeof info.type !== 'string')
    throw new LiveVideosError(
      'ตรวจสอบชนิดโทเคน Facebook ไม่สำเร็จ กรุณาเชื่อมต่อเพจใหม่หรือติดต่อผู้ดูแล',
      503,
    )
  if (info.type !== 'PAGE')
    throw new LiveVideosError(
      'โทเคนที่บันทึก' +
        (info.type === 'USER' ? 'เป็น User Access Token' : 'ไม่ใช่ Page Access Token') +
        ' ต้องใช้ Page Access Token ของเพจนี้ กรุณาเชื่อมต่อเพจใหม่',
      409,
    )
  if (!/^\d{1,40}$/.test(String(info.profile_id ?? '')))
    throw new LiveVideosError('ตรวจสอบเพจของโทเคน Facebook ไม่สำเร็จ กรุณาเชื่อมต่อเพจใหม่', 503)
  if (String(info.profile_id) !== pageId)
    throw new LiveVideosError(
      'Page Access Token ที่บันทึกเป็นของเพจอื่น กรุณาเชื่อมต่อเพจนี้ใหม่',
      409,
    )
  for (const key of ['expires_at', 'data_access_expires_at']) {
    if (Number(info[key]) > 0 && Number(info[key]) <= Date.now() / 1000)
      throw new LiveVideosError(
        'โทเคนหรือสิทธิ์เข้าถึง Facebook หมดอายุ กรุณาเชื่อมต่อเพจใหม่',
        409,
      )
  }
  if (Array.isArray(info.scopes) && !info.scopes.includes('pages_read_engagement'))
    throw new LiveVideosError(
      'Page Access Token ขาดสิทธิ์ pages_read_engagement สำหรับอ่านวิดีโอ กรุณาเชื่อมต่อเพจใหม่และอนุญาตสิทธิ์นี้',
      403,
    )
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if ([...url.searchParams.keys()].some((key) => /token|secret|proof/i.test(key))) return null
    return url.href
  } catch {
    return null
  }
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function active(row: any, recent = false): boolean {
  const raw = recent ? row?.live_status : row?.status
  const status = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (status) return ['LIVE', 'LIVE_NOW'].includes(status)
  // A known stopped/archived status above always wins over an old view count.
  const views = row?.live_views
  return (
    !recent &&
    (typeof views === 'number' || typeof views === 'string') &&
    Number.isFinite(Number(views)) &&
    Number(views) > 0
  )
}

function videoOption(row: any, recent = false): FacebookLiveVideo | null {
  const id =
    !recent && typeof row?.video?.id === 'string' && /^\d{1,40}$/.test(row.video.id)
      ? row.video.id
      : row?.id
  if (typeof id !== 'string' || !/^\d{1,40}$/.test(id)) return null
  const title = [row.title, row.description].find(
    (value) => typeof value === 'string' && value.trim(),
  )
  return {
    id,
    title: title ? title.trim().slice(0, 200) : recent ? 'วิดีโอล่าสุดของเพจ' : 'ไลฟ์สดของเพจ',
    thumbnail: imageUrl(recent ? row.picture : row.video?.picture),
    createdAt:
      timestamp(row.broadcast_start_time) ?? timestamp(row.creation_time ?? row.created_time),
    isLive: active(row, recent),
  }
}

const basicFields = 'id,title,description,creation_time,status,video{id,picture}'
const sortNewest = (a: FacebookLiveVideo, b: FacebookLiveVideo) =>
  (b.createdAt ?? '').localeCompare(a.createdAt ?? '')

/** Try filtered broadcasts, then unfiltered broadcasts, then three latest Page videos. */
export async function fetchPageLiveVideos(
  pageId: string,
  token: string,
  requestSignal?: AbortSignal,
): Promise<{ videos: FacebookLiveVideo[]; fallback: boolean }> {
  if (!/^\d{1,40}$/.test(pageId) || !token.trim())
    throw new LiveVideosError('การเชื่อมต่อเพจไม่ถูกต้อง กรุณาเชื่อมต่อ Facebook ใหม่', 409)
  const signal = AbortSignal.any([
    AbortSignal.timeout(15_000),
    ...(requestSignal ? [requestSignal] : []),
  ])
  async function broadcasts(filtered: boolean, minimal = false) {
    const videos = new Map<string, FacebookLiveVideo>()
    const cursors = new Set<string>()
    let after: string | null = null
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        fields: basicFields + (minimal ? '' : ',live_views,broadcast_start_time'),
        limit: '10',
      })
      if (filtered) params.set('broadcast_status', JSON.stringify(['LIVE']))
      if (after) params.set('after', after)
      const payload = await readGraph(pageId + '/live_videos', params, token, signal)
      if (!Array.isArray(payload?.data))
        throw new LiveVideosError('ข้อมูลไลฟ์สดจาก Facebook ไม่สมบูรณ์ กรุณาลองใหม่')
      for (const row of payload.data) {
        if (!active(row)) continue
        const video = videoOption(row)
        if (video) videos.set(video.id, video)
      }
      if (!payload.paging?.next) return [...videos.values()].sort(sortNewest)
      const cursor = payload.paging?.cursors?.after
      if (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || cursors.has(cursor))
        throw new LiveVideosError('โหลดรายการไลฟ์สดได้ไม่ครบ กรุณาลองใหม่')
      cursors.add(cursor)
      after = cursor
    }
    throw new LiveVideosError('รายการไลฟ์สดมีจำนวนมาก กรุณาลองใหม่หรือกรอกรหัสด้วยตนเอง')
  }
  let minimal = false
  try {
    const videos = await broadcasts(true)
    if (videos.length) return { videos, fallback: false }
  } catch (error) {
    if (!(error instanceof LiveVideosError) || error.graphCode !== 100) throw error
    minimal = true
  }
  let videos: FacebookLiveVideo[]
  try {
    videos = await broadcasts(false, minimal)
  } catch (error) {
    if (minimal || !(error instanceof LiveVideosError) || error.graphCode !== 100) throw error
    videos = await broadcasts(false, true)
  }
  if (videos.length) return { videos, fallback: false }
  async function recentVideos(minimalFields = false) {
    const params = new URLSearchParams({
      fields: 'id,title,description,created_time,picture' + (minimalFields ? '' : ',live_status'),
      limit: '3',
    })
    const payload = await readGraph(pageId + '/videos', params, token, signal)
    if (!Array.isArray(payload?.data))
      throw new LiveVideosError('ข้อมูลวิดีโอล่าสุดจาก Facebook ไม่สมบูรณ์ กรุณาลองใหม่')
    const unique = new Map<string, FacebookLiveVideo>()
    for (const row of payload.data) {
      const video = videoOption(row, true)
      if (video) unique.set(video.id, video)
    }
    return [...unique.values()].sort(sortNewest).slice(0, 3)
  }
  try {
    videos = await recentVideos()
  } catch (error) {
    if (!(error instanceof LiveVideosError) || error.graphCode !== 100) throw error
    videos = await recentVideos(true)
  }
  const live = videos.filter((video) => video.isLive)
  return live.length ? { videos: live, fallback: false } : { videos, fallback: videos.length > 0 }
}
