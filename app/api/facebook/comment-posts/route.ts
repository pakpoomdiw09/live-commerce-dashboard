import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { pageTokenFor } from '@/lib/integrations/facebook/client'
import {
  fetchPageCommentPosts,
  fetchPageLiveVideos,
  LiveVideosError,
  verifyLiveVideoPageToken,
  type FacebookCommentPost,
} from '@/lib/integrations/facebook/live-videos'
import { supabaseAdmin } from '@/lib/supabase/server'

const headers = { 'Cache-Control': 'private, no-store' }
const failure = (error: string, status: number) => NextResponse.json({ error }, { status, headers })
const postNumber = (id: string) => id.split('_').at(-1) ?? id

export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') return failure('กรุณาเข้าสู่ระบบ', 401)
    const pageId = req.nextUrl.searchParams.get('page_id') ?? ''
    if (!/^\d{1,40}$/.test(pageId)) return failure('รหัสเพจไม่ถูกต้อง', 400)

    const db = supabaseAdmin({ timeoutMs: 10_000 })
    const tenant = await db.from('tenants').select('id').eq('page_id', pageId).maybeSingle()
    if (tenant.error) throw tenant.error
    if (!tenant.data || !(await canAccessTenant(actor, tenant.data.id, 'owner')))
      return failure('ไม่มีสิทธิ์จัดการเพจนี้', 403)

    const rate = await db.rpc('commerce_rate_limit', {
      p_bucket: `facebook-comment-posts:${tenant.data.id}:${actor.id}`,
      p_max: 12,
    })
    if (rate.error) throw rate.error
    if (rate.data !== true) return failure('โหลดรายการถี่เกินไป กรุณารอสักครู่', 429)

    const saved = await db.from('tenants').select('page_id,page_access_token').eq('id', tenant.data.id).eq('page_id', pageId).maybeSingle()
    if (saved.error) throw saved.error
    if (!saved.data) return failure('การเชื่อมต่อเพจเปลี่ยนไป กรุณาโหลดหน้าใหม่', 409)
    const token = pageTokenFor(saved.data)
    if (!token) return failure('ยังไม่ได้เชื่อมต่อ Facebook Page', 409)
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(25_000)])
    await verifyLiveVideoPageToken(pageId, token, signal)

    const [feedResult, videoResult] = await Promise.allSettled([
      fetchPageCommentPosts(pageId, token, signal),
      fetchPageLiveVideos(pageId, token, signal),
    ])
    if (feedResult.status === 'rejected' && videoResult.status === 'rejected')
      throw feedResult.reason

    const byPost = new Map<string, FacebookCommentPost>()
    if (feedResult.status === 'fulfilled') {
      for (const post of feedResult.value) byPost.set(postNumber(post.id), post)
    }
    if (videoResult.status === 'fulfilled') {
      for (const video of videoResult.value.videos) {
        const key = postNumber(video.id)
        const existing = byPost.get(key)
        byPost.set(key, {
          id: existing?.id ?? video.id,
          title: existing?.preview ? existing.title : video.title,
          preview: existing?.preview ?? video.title,
          thumbnail: existing?.thumbnail ?? video.thumbnail,
          createdAt: existing?.createdAt ?? video.createdAt,
          isLive: video.isLive,
        })
      }
    }
    const posts = [...byPost.values()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    return NextResponse.json({ pageId, posts }, { headers })
  } catch (error) {
    if (error instanceof LiveVideosError) return failure(error.message, error.status)
    return failure('โหลดรายการโพสต์จาก Facebook ไม่สำเร็จ', 503)
  }
}
