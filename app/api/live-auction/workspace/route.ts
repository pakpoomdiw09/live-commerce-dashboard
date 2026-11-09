import { NextRequest } from 'next/server'
import { getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply } from '@/lib/features/commerce/auction-api'
import { auctionHostIds } from '@/lib/features/commerce/auction-hosts'
import { liveCfPaymentLinksReady } from '@/lib/features/commerce/live-cf-payment-link'
import { inputExpense, inputMoney } from '@/lib/features/commerce/live-session-types'
import { UUID } from '@/lib/utils'
import {
  normalizeBidKeyword,
  normalizeCloseKeyword,
  sessionAuctionTemplate,
  validSessionAutomation,
} from '@/lib/features/commerce/session-automation'

function failure(error: unknown) {
  const issue = (error ?? {}) as { code?: string; message?: string }
  console.error('[live-auction/workspace]', { code: issue.code ?? 'UNAVAILABLE' })
  if (issue.message === 'AUCTION_HOST_FACEBOOK_REQUIRED')
    return auctionReply({ error: 'กรุณาเชื่อมต่อ Facebook ของคุณกับเพจนี้อีกครั้ง' }, 400)
  if (error instanceof SyntaxError) return auctionReply({ error: 'ข้อมูลไม่ถูกต้อง' }, 400)
  if (issue.code === '40001' || issue.code === '23505')
    return auctionReply(
      { error: 'ข้อมูลรอบเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก', reload: true },
      409,
    )
  if (issue.code === '42501') return auctionReply({ error: 'ไม่มีสิทธิ์ใช้เพจหรือบัญชีนี้' }, 403)
  if (['P0001', '22P02', '23514'].includes(issue.code ?? ''))
    return auctionReply({ error: 'ตรวจข้อมูลราคาและเงื่อนไข รอบที่รับบิดแล้วแก้ราคาไม่ได้' }, 400)
  return auctionReply({ error: 'ระบบประมูลยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง' }, 503)
}

// A failed read must never masquerade as a new, empty workspace.
async function workspaceRead<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const result = await query
  if (result.error) throw result.error
  return result.data
}

export async function GET(req: NextRequest) {
  // Keep authorization failures outside the optional database fallback.
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  try {
    const denied = await authorizeAuction(req, tenantId)
    if (denied) return denied
  } catch (error) {
    return failure(error)
  }
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId')
    const pageId = req.nextUrl.searchParams.get('pageId')
    const livePostId = req.nextUrl.searchParams.get('livePostId')
    if (
      (sessionId && !UUID.test(sessionId)) ||
      (pageId && !/^\d{1,64}$/.test(pageId)) ||
      (livePostId && (!pageId || !/^\d{1,64}$/.test(livePostId)))
    )
      return auctionReply({ error: 'รหัสไลฟ์หรือเซสชันไม่ถูกต้อง' }, 400)
    const db = supabaseAdmin({ timeoutMs: 15000 })
    let query = db.from('live_sessions').select('*').eq('tenant_id', tenantId!)
    if (sessionId) query = query.eq('id', sessionId)
    if (pageId) query = query.eq('page_id', pageId)
    if (livePostId) query = query.eq('live_post_id', livePostId)
    const session = await workspaceRead(
      query.order('created_at', { ascending: false }).limit(1).maybeSingle(),
    )
    if (sessionId && !session) return auctionReply({ ready: false, error: 'Session not found' }, 404)
    // A new live can inherit the merchant's previous preferences without creating data on GET.
    let previous = session
    if (!previous && pageId) {
      previous = await workspaceRead(
        db
          .from('live_sessions')
          .select('*')
          .eq('tenant_id', tenantId!)
          .eq('page_id', pageId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      )
    }
    const selectedPage = pageId ?? session?.page_id
    const selectedPost = livePostId ?? session?.live_post_id
    const rounds = () => {
      let query = db.from('auctions').select('*').eq('tenant_id', tenantId!)
      if (selectedPage) query = query.eq('page_id', selectedPage)
      if (selectedPost) query = query.eq('live_post_id', selectedPost)
      return query.order('created_at', { ascending: false }).limit(1)
    }
    // Cycled rounds may share a source timestamp. Prefer the single active round.
    const round = await workspaceRead(rounds().eq('status', 'active').maybeSingle()) ??
      await workspaceRead(rounds().maybeSingle())
    let reviews = db.from('auction_deliveries')
      .select('channel,status,auctions!inner(tenant_id,page_id,live_post_id)')
      .eq('auctions.tenant_id', tenantId!)
      .in('status', ['requires_review', 'failed'])
    if (selectedPage) reviews = reviews.eq('auctions.page_id', selectedPage)
    if (selectedPost) reviews = reviews.eq('auctions.live_post_id', selectedPost)
    const reviewRows = await workspaceRead(reviews.limit(50))
    const deliveryReviews = (reviewRows ?? []).map(row => ({
      channel: row.channel === 'private' ? 'private' : 'public',
      status: row.status === 'failed' ? 'failed' : 'requires_review',
    }))
    return auctionReply({
      ready: true,
      deliveryReviews,
      template: session?.auction_round_template ?? previous?.auction_round_template ?? null,
      auction: round,
      bids: [],
      session,
      round,
      settings:
        session?.auction_settings ??
        previous?.auction_settings ??
        round?.session_automation ??
        null,
      preferencesOnly: !session,
    })
  } catch {
    console.error('[live-auction/workspace]', { category: 'READ_UNAVAILABLE' })
    return auctionReply({ ready: false, degraded: true, error: 'Workspace temporarily unavailable. Please retry.' }, 503)
  }
}

export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    if (!input || typeof input !== 'object') return auctionReply({ error: 'ข้อมูลไม่ถูกต้อง' }, 400)
    const denied = await authorizeAuction(req, input.tenantId, true)
    if (denied) return denied
    const finance = Object.fromEntries(
      ['cost', 'ads', 'shipping', 'fees'].map((key) => [key, inputExpense(input.finance?.[key])]),
    )
    if (
      !UUID.test(input.requestId ?? '') ||
      (input.durationSeconds != null &&
        (!Number.isSafeInteger(input.durationSeconds) ||
          input.durationSeconds < 30 ||
          input.durationSeconds > 86400)) ||
      typeof input.pageId !== 'string' ||
      !/^\d{1,64}$/.test(input.pageId) ||
      typeof input.livePostId !== 'string' ||
      !/^\d{1,64}$/.test(input.livePostId) ||
      !validSessionAutomation(input.settings) ||
      (input.sessionId != null && !UUID.test(input.sessionId)) ||
      (input.roundId != null && !UUID.test(input.roundId)) ||
      typeof input.itemName !== 'string' ||
      !input.itemName.trim() ||
      input.itemName.trim().length > 200 ||
      inputMoney(input.startPrice, 999999999) === null ||
      Number(input.startPrice) <= 0 ||
      inputMoney(input.minStep, 999999999) === null ||
      Number(input.minStep) <= 0 ||
      inputMoney(input.shippingFee, 999999) === null ||
      Object.values(finance).some((value) => value === null) ||
      (input.sessionId &&
        ['revision', 'financialRevision'].some(
          (key) => !Number.isSafeInteger(input[key]) || input[key] < 0,
        ))
    )
      return auctionReply({ error: 'กรุณาตรวจข้อมูลทุกโซน ราคา คำดัก และข้อความ' }, 400)
    if (input.settings.privateReply && !liveCfPaymentLinksReady())
      return auctionReply(
        { error: 'กรุณาตั้งค่า URL แอปและ payment link secret ก่อนเปิดส่ง Messenger' },
        503,
      )
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') return auctionReply({ error: 'กรุณาเข้าสู่ระบบ' }, 403)
    const db = supabaseAdmin({ timeoutMs: 20000 })
    const hostIds = await auctionHostIds(db, actor.id, input.pageId)
    const settings = {
      ...input.settings,
      winnerFlow: input.settings.winnerFlow ?? 'on_demand',
      auto_accumulate_summary: input.settings.auto_accumulate_summary ?? true,
      keywords: input.settings.keywords.map(normalizeBidKeyword),
      closeKeywords: (input.settings.closeKeywords ?? []).map(normalizeCloseKeyword),
      counting_tags: Object.fromEntries(Object.entries<string>(input.settings.counting_tags ?? {}).map(
        ([tag, count]) => [normalizeBidKeyword(tag), count.trim()],
      )),
      autoCycleRounds: input.settings.autoCycleRounds ?? true,
      bidText: sessionAuctionTemplate(input.settings.bidText),
      closeText: sessionAuctionTemplate(input.settings.bidText),
      privateText: sessionAuctionTemplate(input.settings.privateText),
      closeEnabled: true,
      countEnabled: input.settings.countEnabled,
      heartCloses: false,
    }
    const payload = {
      pageId: input.pageId,
      livePostId: input.livePostId,
      sessionId: input.sessionId ?? null,
      roundId: input.roundId ?? null,
      revision: input.revision ?? 0,
      financialRevision: input.financialRevision ?? 0,
      itemName: input.itemName.trim(),
      startPrice: Number(input.startPrice),
      minStep: Number(input.minStep),
      shippingFee: Number(input.shippingFee),
      durationSeconds: input.durationSeconds ?? null,
      settings,
      hostIds,
      finance,
    }
    const result = await db.rpc('save_auction_workspace', {
      p_tenant: input.tenantId,
      p_actor: actor.id,
      p_request: input.requestId,
      p_input: payload,
    })
    if (result.error) throw result.error
    return auctionReply(result.data)
  } catch (error) {
    return failure(error)
  }
}
