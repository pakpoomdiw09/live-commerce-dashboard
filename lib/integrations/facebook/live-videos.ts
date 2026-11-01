import 'server-only'
import { graph } from './client'

export type FacebookLiveVideo = {
  /** Video post ID, used by live_post_id when matching comment webhooks. */
  id: string
  title: string
  thumbnail: string | null
  createdAt: string | null
}

export class LiveVideosError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message)
  }
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

/** Read only LIVE broadcasts. Never expose a token, raw provider errors or paging URLs. */
export async function fetchPageLiveVideos(
  pageId: string,
  token: string,
  requestSignal?: AbortSignal,
): Promise<FacebookLiveVideo[]> {
  if (!/^\d{1,40}$/.test(pageId) || !token.trim())
    throw new LiveVideosError('การเชื่อมต่อเพจไม่ถูกต้อง กรุณาเชื่อมต่อ Facebook ใหม่', 409)
  const signal = AbortSignal.any([
    AbortSignal.timeout(12_000),
    ...(requestSignal ? [requestSignal] : []),
  ])
  const videos = new Map<string, FacebookLiveVideo>()
  const cursors = new Set<string>()
  let after: string | null = null
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      broadcast_status: JSON.stringify(['LIVE']),
      fields: 'id,title,description,creation_time,broadcast_start_time,status,video{id,picture}',
      limit: '50',
    })
    if (after) params.set('after', after)
    let result: Response | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await fetch(graph(`${pageId}/live_videos?${params}`), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal,
        })
        if (result.status < 500 || attempt === 1) break
      } catch {
        if (signal.aborted || attempt === 1)
          throw new LiveVideosError('เชื่อมต่อ Facebook ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 503)
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const payload = await result?.json().catch(() => null)
    if (!result?.ok || payload?.error) {
      const code = Number(payload?.error?.code)
      if (code === 190)
        throw new LiveVideosError('การเชื่อมต่อ Facebook หมดอายุ กรุณาเชื่อมต่อเพจใหม่', 409)
      if ([10, 200, 294].includes(code) || result?.status === 403)
        throw new LiveVideosError(
          'Facebook ยังไม่อนุญาตให้อ่านไลฟ์สด กรุณาตรวจสอบสิทธิ์หรือเชื่อมต่อเพจใหม่',
          403,
        )
      if ([4, 17, 32, 613].includes(code) || result?.status === 429)
        throw new LiveVideosError(
          'Facebook จำกัดการเรียกข้อมูลชั่วคราว กรุณารอสักครู่แล้วลองใหม่',
          429,
        )
      throw new LiveVideosError('โหลดรายการไลฟ์สดจาก Facebook ไม่สำเร็จ กรุณาลองใหม่')
    }
    if (!Array.isArray(payload?.data))
      throw new LiveVideosError('ข้อมูลไลฟ์สดจาก Facebook ไม่สมบูรณ์ กรุณาลองใหม่')
    for (const row of payload.data) {
      if (!row || !['LIVE', 'LIVE_NOW'].includes(row.status)) continue
      const id =
        typeof row.video?.id === 'string' && /^\d{1,40}$/.test(row.video.id) ? row.video.id : row.id
      if (typeof id !== 'string' || !/^\d{1,40}$/.test(id)) continue
      const title = [row.title, row.description].find(
        (value) => typeof value === 'string' && value.trim(),
      )
      videos.set(id, {
        id,
        title: title ? title.trim().slice(0, 200) : 'ไลฟ์สดของเพจ',
        thumbnail: imageUrl(row.video?.picture),
        createdAt: timestamp(row.broadcast_start_time) ?? timestamp(row.creation_time),
      })
    }
    if (!payload.paging?.next) {
      return [...videos.values()].sort((a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      )
    }
    const cursor = payload.paging?.cursors?.after
    if (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || cursors.has(cursor))
      throw new LiveVideosError('โหลดรายการไลฟ์สดได้ไม่ครบ กรุณาลองใหม่')
    cursors.add(cursor)
    after = cursor
  }
  throw new LiveVideosError('รายการไลฟ์สดมีจำนวนมาก กรุณาลองใหม่หรือกรอกรหัสด้วยตนเอง')
}
