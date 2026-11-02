import { NextRequest } from 'next/server'
import { getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply } from '@/lib/features/commerce/auction-api'
import { UUID } from '@/lib/utils'
import { extractFacebookLiveId } from '@/lib/features/commerce/live-cf-setup'
import { liveCfPaymentLinksReady } from '@/lib/features/commerce/live-cf-payment-link'
import {
  normalizeBidKeyword,
  sessionAuctionTemplate,
  validSessionAutomation,
} from '@/lib/features/commerce/session-automation'

function failure(error: unknown) {
  const code = (error as { code?: string })?.code
  console.error('[live-auction/session]', { code: code ?? 'UNAVAILABLE' })
  if (error instanceof SyntaxError) return auctionReply({ error: 'ข้อมูลไม่ถูกต้อง' }, 400)
  if (code === 'P0002' || code === '42501')
    return auctionReply({ error: 'ไม่พบ Session เพจ หรือบัญชีรับเงินของร้านนี้' }, 404)
  if (code === '40001')
    return auctionReply(
      { error: 'Session จบแล้วหรือค่าตั้งค่าถูกแก้ไข กรุณาโหลดข้อมูลล่าสุด', reload: true },
      409,
    )
  if (['P0001', '22P02', '23514'].includes(code ?? ''))
    return auctionReply({ error: 'กรุณาตรวจค่าตั้งค่า Session' }, 400)
  return auctionReply(
    { error: 'ระบบ Session ยังไม่พร้อม กรุณาตรวจ migration live-auction-dashboard.sql' },
    503,
  )
}
export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get('tenantId')
    const denied = await authorizeAuction(req, tenantId)
    if (denied) return denied
    const sessionId = req.nextUrl.searchParams.get('sessionId')
    if (!sessionId || !UUID.test(sessionId))
      return auctionReply({ error: 'รหัส Session ไม่ถูกต้อง' }, 400)
    const result = await supabaseAdmin({ timeoutMs: 15000 }).rpc('live_auction_dashboard', {
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
      keywords: input.settings.keywords.map(normalizeBidKeyword),
      privateText: sessionAuctionTemplate(input.settings.privateText),
      bidText: sessionAuctionTemplate(input.settings.bidText),
      closeText: sessionAuctionTemplate(input.settings.closeText),
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
        return auctionReply({ error: 'รหัส Session หรือ revision ไม่ถูกต้อง' }, 400)
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
