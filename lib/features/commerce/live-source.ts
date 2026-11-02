import type { FacebookLiveVideo } from '@/lib/integrations/facebook/live-videos'

export function parseLiveVideoList(
  result: unknown,
  pageId: string,
): { videos: FacebookLiveVideo[]; fallback: boolean } {
  const data = result as { pageId?: unknown; videos?: unknown; fallback?: unknown } | null
  if (
    !data ||
    data.pageId !== pageId ||
    typeof data.fallback !== 'boolean' ||
    !Array.isArray(data.videos) ||
    data.videos.some(
      (row: FacebookLiveVideo) =>
        !row ||
        typeof row.id !== 'string' ||
        !/^\d{1,40}$/.test(row.id) ||
        typeof row.title !== 'string' ||
        typeof row.isLive !== 'boolean' ||
        (row.thumbnail !== null &&
          (typeof row.thumbnail !== 'string' || !row.thumbnail.startsWith('https://'))) ||
        (row.createdAt !== null &&
          (typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)))),
    )
  )
    throw new Error('ข้อมูลไลฟ์สดไม่สมบูรณ์ กรุณาลองใหม่')
  return { videos: data.videos, fallback: data.fallback }
}
