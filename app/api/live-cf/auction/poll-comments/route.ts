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
      if (!session.data || !/^\d{1,64}$/.test(String(session.data.live_post_id)))
        return json({ polled: false, reason: 'SESSION_NOT_FOUND' })
      sessionPost = String(session.data.live_post_id)
    }
    const COLUMNS = 'id,live_post_id,created_at'
    const sessionFilter = sessionPost
      ? `live_post_id.eq.${sessionPost}`
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
      url.searchParams.set('limit', '100')
      url.searchParams.set('fields', 'id,message,created_time,from{id,name}')
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(8_000)]),
        cache: 'no-store',
      })
      return { res: response, graphBody: await response.json().catch(() => null) }
    }
    // Poll only the round's immutable active video ID. Graph error 100 requires the host
    // to select a new session; another active Page video is never adopted as an alias.
    const pollId = String(target.live_post_id)
    let { res, graphBody } = await fetchComments(pollId)
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
      })
      return json(
        {
          polled: false,
          reason: g?.code === 100 ? 'VIDEO_NOT_ACCESSIBLE' : 'GRAPH_ERROR',
          code: g?.code ?? null,
          videoId: pollId,
        },
        502,
      )
    }

    const cursorId = sessionId ?? target.id
    const cursor = await db.from('auction_poll_cursors').select('high_water_at,live_video_id,continuation_url')
      .eq('cursor_id', cursorId).maybeSingle()
    if (cursor.error) throw cursor.error
    const continuation = cursor.data?.live_video_id === pollId ? cursor.data.continuation_url : null
    // A small overlap protects against equal timestamps and delayed Graph indexing. The
    // webhook queue's unique event key is authoritative for deduplication.
    const highWater = cursor.data?.live_video_id === pollId ? Date.parse(cursor.data.high_water_at) : 0
    let pages = (graphBody?.data ?? []) as GraphComment[]
    let next = continuation ?? graphBody?.paging?.next
    let reachedBoundary = false
    const boundary = highWater ? highWater - 120_000 : Date.parse(target.created_at)
    for (let page = 1; next && page < 10; page++) {
      const nextUrl = new URL(next)
      if (nextUrl.hostname !== 'graph.facebook.com' && !nextUrl.hostname.endsWith('.facebook.com')) {
        next = undefined
        break
      }
      nextUrl.searchParams.delete('access_token')
      const response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(8_000)]),
        cache: 'no-store',
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) break
      const batch = (body?.data ?? []) as GraphComment[]
      pages = pages.concat(batch)
      next = body?.paging?.next
      const oldest = Math.min(...batch.map((c) => Date.parse(c.created_time ?? '')).filter(Number.isFinite))
      if (Number.isFinite(oldest) && oldest <= boundary) {
        reachedBoundary = true
        next = undefined
        break
      }
    }
    const startedAt = Date.parse(target.created_at)
    const inspected = pages.map((comment, index) => {
      const hasFrom = Boolean(comment.from && typeof comment.from === 'object')
      const hasFromId = typeof comment.from?.id === 'string' && comment.from.id.length > 0
      const authorIdHasStringType = typeof comment.from?.id === 'string'
      const createdAt = Date.parse(comment.created_time ?? '')
      let reason: string | null = null
      if (typeof comment.id !== 'string' || !comment.id) reason = 'MISSING_COMMENT_ID'
      else if (typeof comment.message !== 'string' || !comment.message.trim()) reason = 'MISSING_MESSAGE'
      else if (!authorIdHasStringType) reason = 'MISSING_FROM_ID'
      else if (!Number.isFinite(createdAt)) reason = 'INVALID_CREATED_TIME'
      else if (createdAt < startedAt) reason = 'BEFORE_ROUND_START'
      else if (highWater && !continuation && createdAt < highWater - 120_000) reason = 'BEFORE_HIGH_WATER_OVERLAP'
      else if (seen.has(comment.id)) reason = 'ALREADY_SEEN_IN_PROCESS'
      console.info('[auction/poll] comment diagnostic', {
        index,
        has_from: hasFrom,
        has_from_id: hasFromId,
        decision: reason ? 'skipped' : 'candidate_for_queue',
        reason,
      })
      return { comment, reason }
    })
    const comments = inspected
      .filter(({ reason }) => reason === null)
      .map(({ comment }) => comment)
      .reverse() // oldest first: the queue orders by insertion sequence
    if (!comments.length) {
      const cursorSaved = await db.from('auction_poll_cursors').upsert({
        cursor_id: cursorId,
        auction_id: target.id,
        tenant_id: tenant.data.id,
        session_id: sessionId,
        live_video_id: pollId,
        high_water_at: new Date(highWater || startedAt).toISOString(),
        continuation_url: reachedBoundary ? null : next ?? continuation,
      }, { onConflict: 'cursor_id' })
      if (cursorSaved.error) throw cursorSaved.error
      return json({ polled: true, fetched: 0, queued: 0 })
    }

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
    const newest = Math.max(...comments.map((c) => Date.parse(c.created_time!)))
    if (Number.isFinite(newest)) {
      let continuationUrl: string | null = reachedBoundary ? null : next ?? continuation
      if (continuationUrl) {
        const safeUrl = new URL(continuationUrl)
        safeUrl.searchParams.delete('access_token')
        continuationUrl = safeUrl.toString()
      }
      const cursorSaved = await db.from('auction_poll_cursors').upsert({
        cursor_id: cursorId,
        auction_id: target.id,
        tenant_id: tenant.data.id,
        session_id: sessionId,
        live_video_id: pollId,
        high_water_at: new Date(Math.max(highWater || 0, newest)).toISOString(),
        continuation_url: continuationUrl,
      }, { onConflict: 'cursor_id' })
      if (cursorSaved.error) throw cursorSaved.error
    }
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
