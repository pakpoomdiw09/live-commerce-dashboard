import { NextRequest } from 'next/server'
import { getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply } from '@/lib/features/commerce/auction-api'
import { UUID } from '@/lib/utils'
import { extractFacebookLiveId } from '@/lib/features/commerce/live-cf-setup'
import { liveCfPaymentLinksReady } from '@/lib/features/commerce/live-cf-payment-link'
import {
  normalizeBidKeyword,
  normalizeCloseKeyword,
  sessionAuctionTemplate,
  validSessionAutomation,
} from '@/lib/features/commerce/session-automation'

function failure(error: unknown) {
  const code = (error as { code?: string })?.code
  console.error('[live-auction/session]', { code: code ?? 'UNAVAILABLE' })
  if (error instanceof SyntaxError) return auctionReply({ error: 'ข้อมูลไม่ถูกต้อง' }, 400)
  if (code === 'P0002' || code === '42501')
    return auctionReply({ error: 'ไม่พบ เซสชัน เพจ หรือบัญชีรับเงินของร้านนี้' }, 404)
  if (code === '40001')
    return auctionReply(
      { error: 'เซสชัน จบแล้วหรือข้อมูลถูกแก้ไข กรุณาโหลดข้อมูลล่าสุด', reload: true },
      409,
    )
  if (['P0001', '22P02', '23514'].includes(code ?? ''))
    return auctionReply({ error: 'กรุณาตรวจค่าตั้งค่า เซสชัน' }, 400)
  return auctionReply({ error: 'ระบบไลฟ์สดยังไม่พร้อม กรุณาให้ผู้ดูแลตรวจการตั้งค่า' }, 503)
}
export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get('tenantId')
    const denied = await authorizeAuction(req, tenantId)
    if (denied) return denied
    const sessionId = req.nextUrl.searchParams.get('sessionId')
    if (!sessionId || !UUID.test(sessionId))
      return auctionReply({ error: 'รหัส เซสชัน ไม่ถูกต้อง' }, 400)
    const result = await supabaseAdmin({ timeoutMs: 15000 }).rpc('live_auction_thai_dashboard', {
      p_tenant: tenantId!,
      p_session: sessionId,
    })
    if (result.error) throw result.error
    return auctionReply(result.data)
  } catch (error) {
    return failure(error)
  }
}
export async function POST(req: NextRequest) {
  try {
    const input = await req.json()
    if (!input || typeof input !== 'object') return auctionReply({ error: 'ข้อมูลไม่ถูกต้อง' }, 400)
    const denied = await authorizeAuction(req, input.tenantId, true)
    if (denied) return denied
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') return auctionReply({ error: 'กรุณาเข้าสู่ระบบ' }, 403)
    if (input.action === 'load_customers') {
      if (
        !UUID.test(input.requestId ?? '') ||
        !UUID.test(input.sessionId ?? '') ||
        !Array.isArray(input.fbIds) ||
        !input.fbIds.length ||
        input.fbIds.length > 500 ||
        input.fbIds.some((id: unknown) => typeof id !== 'string' || !/^\d{1,64}$/.test(id))
      )
        return auctionReply({ error: 'กรุณาเลือกลูกค้าใน เซสชัน (สูงสุด 500 คน)' }, 400)
      const result = await supabaseAdmin({ timeoutMs: 15000 }).rpc(
        'collect_auction_session_customers',
        {
          p_tenant: input.tenantId,
          p_session: input.sessionId,
          p_fb_ids: [...new Set(input.fbIds)],
        },
      )
      if (result.error) throw result.error
      return auctionReply(result.data)
    }
    if (input.action === 'note') {
      if (
        !UUID.test(input.requestId ?? '') ||
        !UUID.test(input.sessionId ?? '') ||
        typeof input.fbId !== 'string' ||
        !/^\d{1,64}$/.test(input.fbId) ||
        typeof input.note !== 'string' ||
        input.note.length > 500 ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 0
      )
        return auctionReply(
          { error: 'กรุณาตรวจลูกค้า เซสชัน และหมายเหตุ (ไม่เกิน 500 ตัวอักษร)' },
          400,
        )
      const result = await supabaseAdmin({ timeoutMs: 15000 }).rpc('save_auction_customer_note', {
        p_tenant: input.tenantId,
        p_session: input.sessionId,
        p_actor: actor.id,
        p_request: input.requestId,
        p_fb_id: input.fbId,
        p_note: input.note.trim(),
        p_revision: input.revision,
      })
      if (result.error) throw result.error
      return auctionReply(result.data)
    }
    if (
      !UUID.test(input.requestId ?? '') ||
      !['start', 'settings'].includes(input.action) ||
      !validSessionAutomation(input.settings)
    )
      return auctionReply({ error: 'กรุณาตรวจคำดัก บัญชีรับเงิน ตัวแปรข้อความ และรหัสคำขอ' }, 400)
    if (input.action === 'settings' && input.settings.privateReply && !liveCfPaymentLinksReady())
      return auctionReply(
        {
          error: 'กรุณาตั้งค่า LIVE_CF_APP_URL และ LIVE_CF_PAYMENT_LINK_SECRET ก่อนเปิดส่งสรุปยอด',
        },
        503,
      )
    const settings = {
      ...input.settings,
      keywords: (input.settings.keywords ?? []).map(normalizeBidKeyword),
      closeKeywords: (input.settings.closeKeywords ?? []).map(normalizeCloseKeyword),
      countEnabled: false,
      heartCloses: false,
      closeEnabled: true,
      privateText: sessionAuctionTemplate(input.settings.privateText),
      bidText: sessionAuctionTemplate(input.settings.bidText),
      closeText: sessionAuctionTemplate(
        input.settings.closeKeywords ? input.settings.bidText : input.settings.closeText,
      ),
    }
    let payload: Record<string, unknown>
    if (input.action === 'start') {
      const livePostId =
        typeof input.livePostId === 'string'
          ? extractFacebookLiveId(input.livePostId)?.split('_').at(-1)
          : null
      if (!livePostId || typeof input.pageId !== 'string' || !/^\d{1,64}$/.test(input.pageId))
        return auctionReply({ error: 'กรุณาเลือกเพจและไลฟ์สด' }, 400)
      payload = { action: 'start', pageId: input.pageId, livePostId, settings }
    } else {
      if (
        !UUID.test(input.sessionId ?? '') ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 0
      )
        return auctionReply({ error: 'รหัสเซสชันหรือข้อมูลล่าสุดไม่ถูกต้อง' }, 400)
      payload = {
        action: 'settings',
        sessionId: input.sessionId,
        revision: input.revision,
        settings,
      }
    }
    const result = await supabaseAdmin({ timeoutMs: 15000 }).rpc('configure_auction_session', {
      p_tenant: input.tenantId,
      p_actor: actor.id,
      p_request: input.requestId,
      p_input: payload,
    })
    if (result.error) throw result.error
    return auctionReply(result.data, input.action === 'start' ? 201 : 200)
  } catch (error) {
    return failure(error)
  }
}
