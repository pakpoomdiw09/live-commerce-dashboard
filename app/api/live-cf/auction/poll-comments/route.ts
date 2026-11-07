import 'server-only'
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getActor, canAccessTenant } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { graph, pageTokenFor } from '@/lib/integrations/facebook/client'
import { parseWebhook } from '@/lib/integrations/facebook/webhook-envelope'
import { runFacebookWebhookWorker } from '@/lib/integrations/facebook/webhook-worker'
import { handleFacebookWebhookEvent } from '@/lib/integrations/facebook/webhook-handler'
import { fetchPageLiveVideos } from '@/lib/integrations/facebook/live-videos'
import { UUID } from '@/lib/utils'
import { deliverAuctionNotifications } from '@/lib/features/commerce/auction-server'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store' }
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers })

// Best-effort per-instance memory of comment IDs already handed to the queue. The authoritative
// de-duplication is unique(page_id,event_key) in facebook_webhook_events and auction_bids.comment_id,
// which also covers the same comment arriving later through the real webhook.
const seen = new Map<string, number>()
const SEEN_MAX = 5000

type GraphComment = {
  id?: string
  message?: string
  created_time?: string
  from?: { id?: string; name?: string }
}

/**
 * POST { page_id }: polls the Graph API for comments on the Page's ACTIVE auction live video and
 * feeds them through the same queue/handler as webhook deliveries. Used while webhooks are not
 * arriving. The Page token never leaves the server.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isFeatureEnabled('live_cf')) return json({ error: 'ไม่พบหน้านี้' }, 404)
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401)
    const body = await req.json().catch(() => null)
    const pageId = typeof body?.page_id === 'string' ? body.page_id : ''
    if (!/^\d{1,40}$/.test(pageId)) return json({ error: 'รหัสเพจไม่ถูกต้อง' }, 400)

    const db = supabaseAdmin({ timeoutMs: 10_000 })
    // Resolve permission before reading any Page credential with the service role.
    const tenant = await db
      .from('tenants')
      .select('id,page_id,page_access_token')
      .eq('page_id', pageId)
      .eq('is_active', true)
      .maybeSingle()
    if (tenant.error) throw tenant.error
    if (!tenant.data || !(await canAccessTenant(actor, tenant.data.id, 'staff')))
      return json({ error: 'ไม่มีสิทธิ์จัดการเพจนี้' }, 403)
    const rate = await db.rpc('commerce_rate_limit', {
      p_bucket: `auction-poll:${tenant.data.id}:${actor.id}`,
      p_max: 40, // 2.5s cadence is 24/minute; headroom for a second tab
    })
    if (rate.error) throw rate.error
    if (rate.data !== true) return json({ error: 'poll rate limited' }, 429)

    // The dashboard tells us which session is selected; its live_post_id is the only target. Without
    // it (older clients) fall back to the page's newest active round.
    const sessionId =
      typeof body?.session_id === 'string' && UUID.test(body.session_id) ? body.session_id : null
    let sessionPost: string | null = null
    if (sessionId) {
      const session = await db
        .from('live_sessions')
        .select('live_post_id')
        .eq('id', sessionId)
        .eq('tenant_id', tenant.data.id)
        .eq('page_id', pageId)
        .maybeSingle()
      if (session.error) throw session.error
      if (!session.data || !/^d{1,64}$/.test(String(session.data.live_post_id)))
        return json({ polled: false, reason: 'SESSION_NOT_FOUND' })
      sessionPost = String(session.data.live_post_id)
    }
    const COLUMNS = 'id,live_post_id,live_post_aliases,created_at'
    const sessionFilter = sessionPost
      ? `live_post_id.eq.${sessionPost},live_post_aliases.cs.{${sessionPost}}`
      : 'id.not.is.null'
    const round = await db
      .from('auctions')
      .select(COLUMNS)
      .eq('tenant_id', tenant.data.id)
      .eq('page_id', pageId)
      .eq('status', 'active')
      .or(sessionFilter)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (round.error) throw round.error
    // Closed rounds still await the winner's confirmation comment.
    const waiting = round.data
      ? null
      : await db
          .from('auctions')
          .select(COLUMNS)
          .eq('tenant_id', tenant.data.id)
          .eq('page_id', pageId)
          .eq('status', 'closed')
          .not('winner_locked_at', 'is', null)
          .is('winner_confirmed_at', null)
          .or(sessionFilter)
          .order('closed_at', { ascending: false })
          .limit(1)
          .maybeSingle()
    if (waiting?.error) throw waiting.error
    const target = round.data ?? waiting?.data
    if (!target)
      return json({ polled: false, reason: 'NO_ACTIVE_ROUND', videoId: sessionPost })

    const token = pageTokenFor(tenant.data)
    if (!token) return json({ error: 'ยังไม่ได้เชื่อมต่อ Facebook' }, 409)

    const fetchComments = async (videoId: string) => {
      const url = new URL(graph(`${videoId}/comments`))
      url.searchParams.set('order', 'reverse_chronological')
      url.searchParams.set('filter', 'stream')
      url.searchParams.set('limit', '50')
      url.searchParams.set('fields', 'id,message,created_time,from{id,name}')
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(8_000)]),
        cache: 'no-store',
      })
      return { res: response, graphBody: await response.json().catch(() => null) }
    }
    let pollId = String(target.live_post_id)
    let { res, graphBody } = await fetchComments(pollId)
    let liveNow: string[] | null = null
    if (!res.ok && graphBody?.error?.code === 100) {
      // The stored video is unreadable (ended, wrong ID or not this Page's). Re-verify which
      // live is actually running on the Page instead of failing permanently.
      const live = await fetchPageLiveVideos(pageId, token, req.signal).catch(() => null)
      liveNow = live ? live.videos.filter((v) => v.isLive).map((v) => v.id) : null
      const alt = liveNow?.length === 1 && /^d{1,64}$/.test(liveNow[0]) ? liveNow[0] : null
      if (alt && alt !== pollId) {
        // Never steal a video that already belongs to another round of this tenant.
        const owner = await db
          .from('auctions')
          .select('id')
          .eq('tenant_id', tenant.data.id)
          .eq('live_post_id', alt)
          .limit(1)
        if (owner.error) throw owner.error
        if (!owner.data?.length) {
          const aliases = [...new Set([...(target.live_post_aliases ?? []), alt])]
          const saved = await db
            .from('auctions')
            .update({ live_post_aliases: aliases })
            .eq('id', target.id)
          if (saved.error) throw saved.error
          console.info('[auction/poll] retargeted round to the Page live video', {
            auctionId: target.id,
            from: pollId,
            to: alt,
          })
          pollId = alt
          ;({ res, graphBody } = await fetchComments(pollId))
        }
      }
    }
    if (!res.ok) {
      // Graph error text is safe to log (the token is sent in a header, never in the URL); strip
      // it anyway if it were ever echoed back.
      const g = graphBody?.error
      console.warn('[auction/poll] graph error', {
        pageId,
        videoId: pollId,
        status: res.status,
        code: g?.code ?? null,
        subcode: g?.error_subcode ?? null,
        type: g?.type ?? null,
        message: typeof g?.message === 'string' ? g.message.split(token).join('[REDACTED]') : null,
        liveNow,
      })
      return json(
        {
          polled: false,
          reason: g?.code === 100 ? 'VIDEO_NOT_ACCESSIBLE' : 'GRAPH_ERROR',
          code: g?.code ?? null,
          videoId: pollId,
          liveVideos: liveNow,
        },
        502,
      )
    }

    const startedAt = Date.parse(target.created_at)
    const comments = ((graphBody?.data ?? []) as GraphComment[])
      .filter(
        (c) =>
          typeof c.id === 'string' &&
          typeof c.message === 'string' &&
          c.message.trim() &&
          typeof c.from?.id === 'string' &&
          // Comments from before the round opened must never become bids.
          Date.parse(c.created_time ?? '') >= startedAt &&
          !seen.has(c.id),
      )
      .reverse() // oldest first: the queue orders by insertion sequence
    if (!comments.length) return json({ polled: true, fetched: 0, queued: 0 })

    const payload = {
      object: 'page',
      entry: [
        {
          id: pageId,
          changes: comments.map((c) => ({
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              comment_id: c.id,
              post_id: pollId,
              video_id: pollId,
              // 10-digit epoch seconds: the SQL stale-guard compares it with the round start.
              created_time: Math.floor(Date.parse(c.created_time!) / 1000),
              from: { id: c.from!.id, name: c.from!.name },
              message: c.message,
            },
          })),
        },
      ],
    }
    const raw = JSON.stringify(payload)
    const bytes = new TextEncoder().encode(raw)
    const envelope = parseWebhook(bytes)
    const saved = await db.rpc('enqueue_facebook_webhook', {
      p_raw: envelope.raw,
      p_hash: createHash('sha256').update(bytes).digest('hex'),
      p_events: envelope.events,
    })
    if (saved.error) throw saved.error
    for (const c of comments) seen.set(c.id!, Date.now())
    if (seen.size > SEEN_MAX)
      for (const key of [...seen.keys()].slice(0, seen.size - SEEN_MAX)) seen.delete(key)

    const drained = await runFacebookWebhookWorker(db, handleFacebookWebhookEvent, {
      deadline: Date.now() + 20_000,
    })
    // Winner confirmation and billing are sent by the existing outbox; also flush it here because
    // Hobby plans have no frequent cron.
    try {
      await deliverAuctionNotifications()
    } catch {
      console.warn('[auction/poll] notification outbox unavailable')
    }
    console.info('[auction/poll] ingested', {
      pageId,
      auctionId: target.id,
      fetched: comments.length,
      accepted: saved.data?.accepted ?? null,
      claimed: drained?.claimed ?? null,
    })
    return json({
      polled: true,
      fetched: comments.length,
      queued: saved.data?.accepted ?? 0,
      comments: comments.slice(-10).map((c) => ({
        id: c.id,
        name: c.from?.name ?? null,
        message: c.message,
        at: c.created_time,
      })),
    })
  } catch (error) {
    console.error('[auction/poll] failed', {
      code: (error as { code?: unknown })?.code ?? null,
      name: error instanceof Error ? error.name : 'unknown',
    })
    return json({ error: 'poll failed' }, 503)
  }
}
