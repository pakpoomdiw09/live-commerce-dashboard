import { after, NextRequest } from 'next/server'
import { getActor } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply } from '@/lib/features/commerce/auction-api'
import { UUID } from '@/lib/utils'
import {
  inputExpense,
  inputMoney,
  validSessionTemplate,
} from '@/lib/features/commerce/live-session-types'
import { runCustomerTabReminders } from '@/lib/features/commerce/customer-tab-reminders'

export const maxDuration = 60
function failure(error: unknown) {
  const issue = error as { code?: string; message?: string }
  console.error('[live-session/api]', { code: issue?.code ?? 'SESSION_FAILED' })
  if (error instanceof SyntaxError) return auctionReply({ error: 'ข้อมูลคำขอไม่ถูกต้อง' }, 400)
  if (issue?.code === '40001')
    return auctionReply(
      {
        error: issue.message?.includes('IN_PROGRESS')
          ? 'กำลังตรวจสลิปหรือส่งข้อความ กรุณารอให้งานเสร็จแล้วโหลดข้อมูลใหม่'
          : 'ยอดหรือรายการเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไข',
        reload: true,
      },
      409,
    )
  if (issue?.code === 'P0002' || issue?.code === '42501')
    return auctionReply({ error: 'ไม่พบข้อมูลใน Session ของร้านนี้' }, 404)
  if (issue?.code === 'P0001' || ['22003', '22P02', '23514'].includes(issue?.code ?? ''))
    return auctionReply(
      {
        error:
          'รายการนี้แก้ไขไม่ได้ กรุณาตรวจว่ารายการยังไม่จัดส่ง ไม่ถูกยกเลิก และเลือกผู้เสนอราคาที่รับแล้ว',
      },
      400,
    )
  return auctionReply({ error: 'โหลดหรือบันทึกไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ' }, 503)
}
export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get('tenantId')
    const denied = await authorizeAuction(req, tenantId)
    if (denied) return denied
    const db = supabaseAdmin({ timeoutMs: 15000 })
    const sessionId = req.nextUrl.searchParams.get('sessionId')
    if (!sessionId) {
      const sessions = await db
        .from('live_sessions')
        .select(
          'id,tenant_id,page_id,live_post_id,ended_at,reminders_enabled,created_at,mode,confirmation_keywords,closing_keywords,cf_patterns,comment_settings,cost_amount,ad_spent,shipping_cost,other_fees,financial_revision,auction_settings,automation_revision,auction_round_template',
        )
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false })
        .limit(100)
      if (sessions.error) throw sessions.error
      return auctionReply({ sessions: sessions.data })
    }
    if (!UUID.test(sessionId)) return auctionReply({ error: 'Session ไม่ถูกต้อง' }, 400)
    const tabId = req.nextUrl.searchParams.get('tabId'),
      roundId = req.nextUrl.searchParams.get('roundId')
    if ((tabId && !UUID.test(tabId)) || (roundId && !UUID.test(roundId)))
      return auctionReply({ error: 'รหัสรายการไม่ถูกต้อง' }, 400)
    if (roundId) {
      const session = await db
        .from('live_sessions')
        .select('page_id,live_post_id')
        .eq('id', sessionId)
        .eq('tenant_id', tenantId!)
        .maybeSingle()
      if (session.error) throw session.error
      if (!session.data) return auctionReply({ error: 'ไม่พบ Session' }, 404)
      const round = await db
        .from('auctions')
        .select('id')
        .eq('id', roundId)
        .eq('tenant_id', tenantId!)
        .eq('page_id', session.data.page_id)
        .eq('live_post_id', session.data.live_post_id)
        .maybeSingle()
      if (round.error) throw round.error
      if (!round.data) return auctionReply({ error: 'ไม่พบรอบประมูล' }, 404)
      const query = (req.nextUrl.searchParams.get('q') ?? '').trim()
      if (query.length > 100) return auctionReply({ error: 'ชื่อค้นหายาวเกินไป' }, 400)
      let bidQuery = db
        .from('auction_bids')
        .select('id,bidder_id,bidder_name,bid_amount,comment_text,created_at')
        .eq('auction_id', roundId)
        .eq('status', 'accepted')
      if (query) bidQuery = bidQuery.ilike('bidder_name', `%${query.replace(/[\\%_]/g, '\\$&')}%`)
      const bids = await bidQuery.order('created_at', { ascending: false }).limit(100)
      if (bids.error) throw bids.error
      return auctionReply({ bids: bids.data })
    }
    const result = await db.rpc(tabId ? 'live_session_tab_proof' : 'live_session_dashboard', {
      p_tenant: tenantId!,
      p_session: sessionId,
      ...(tabId ? { p_tab: tabId } : {}),
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
    if (!UUID.test(input.sessionId ?? '') || !UUID.test(input.requestId ?? ''))
      return auctionReply({ error: 'รหัสคำขอไม่ถูกต้อง' }, 400)
    const revision = Number.isSafeInteger(input.revision) && input.revision >= 0
    if (input.action === 'comment-config') {
      if (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings))
        return auctionReply({ error: 'ข้อมูลการตั้งค่าไม่ถูกต้อง' }, 400)
      const saved = await supabaseAdmin().rpc('save_facebook_comment_config', {
        p_tenant: input.tenantId,
        p_session: input.sessionId,
        p_actor: actor.id,
        p_settings: input.settings,
      })
      if (saved.error) throw saved.error
      return auctionReply(saved.data)
    }
    let payload: Record<string, unknown>
    switch (input.action) {
      case 'costs':
        if (
          !revision ||
          [input.cost, input.ads, input.shipping].some((value) => inputExpense(value) === null) ||
          (input.fees !== undefined && inputExpense(input.fees) === null)
        )
          return auctionReply(
            { error: 'ค่าใช้จ่ายต้องเป็นจำนวนเงินไม่ติดลบ และไม่เกินสองทศนิยม' },
            400,
          )
        payload = {
          action: 'costs',
          revision: input.revision,
          cost: inputExpense(input.cost),
          ads: inputExpense(input.ads),
          shipping: inputExpense(input.shipping),
          ...(input.fees !== undefined ? { fees: inputExpense(input.fees) } : {}),
        }
        break
      case 'winner':
        if (
          !revision ||
          [input.roundId, input.orderId, input.bidId].some(
            (id) => typeof id !== 'string' || !UUID.test(id),
          )
        )
          return auctionReply({ error: 'กรุณาเลือกผู้เสนอราคาที่รับแล้วจากรอบนี้' }, 400)
        payload = {
          action: 'winner',
          revision: input.revision,
          roundId: input.roundId,
          orderId: input.orderId,
          bidId: input.bidId,
        }
        break
      case 'adjust':
        if (
          !revision ||
          !UUID.test(input.tabId ?? '') ||
          !Array.isArray(input.items) ||
          input.items.length > 2000 ||
          inputMoney(input.shipping, 999999) === null ||
          typeof input.reason !== 'string' ||
          input.reason.trim().length < 3 ||
          input.reason.length > 500 ||
          input.items.some(
            (item: { orderId?: unknown; amount?: unknown; cancelled?: unknown }) =>
              !item ||
              typeof item.orderId !== 'string' ||
              !UUID.test(item.orderId) ||
              inputMoney(item.amount, 999999999) === null ||
              Number(item.amount) <= 0 ||
              typeof item.cancelled !== 'boolean',
          )
        )
          return auctionReply(
            { error: 'กรุณาตรวจยอดแต่ละรายการ ค่าส่ง และระบุเหตุผลการแก้ไขอย่างน้อย 3 ตัวอักษร' },
            400,
          )
        payload = {
          action: 'adjust',
          revision: input.revision,
          tabId: input.tabId,
          shipping: input.shipping,
          items: input.items.map(
            (item: { orderId: string; amount: number; cancelled: boolean }) => ({
              orderId: item.orderId,
              amount: item.amount,
              cancelled: item.cancelled,
            }),
          ),
          reason: input.reason.trim(),
        }
        break
      case 'remind': {
        if (
          !validSessionTemplate(input.template) ||
          (input.tabIds !== null &&
            (!Array.isArray(input.tabIds) ||
              !input.tabIds.length ||
              input.tabIds.length > 2000 ||
              input.tabIds.some((id: unknown) => typeof id !== 'string' || !UUID.test(id))))
        )
          return auctionReply({ error: 'กรุณาตรวจรายชื่อและตัวแปรข้อความทวงยอด' }, 400)
        const db = supabaseAdmin({ timeoutMs: 15000 })
        const rate = await db.rpc('commerce_rate_limit', {
          p_bucket: `session-reminders:${input.tenantId}`,
          p_max: 3,
        })
        if (rate.error) throw rate.error
        if (!rate.data) return auctionReply({ error: 'กดส่งบ่อยเกินไป กรุณารอหนึ่งนาที' }, 429)
        const queued = await db.rpc('queue_live_session_reminders', {
          p_tenant: input.tenantId,
          p_session: input.sessionId,
          p_actor: actor.id,
          p_request: input.requestId,
          p_tabs: input.tabIds === null ? null : [...new Set<string>(input.tabIds)].sort(),
          p_template: input.template,
        })
        if (queued.error) throw queued.error
        after(async () => {
          try {
            await runCustomerTabReminders(db)
          } catch {
            console.error('[live-session/reminders] deferred worker unavailable')
          }
        })
        return auctionReply({
          queued: queued.data,
          message: `เข้าคิว ${queued.data} คน ระบบจะตรวจยอดและสิทธิ์ส่งอีกครั้งก่อนส่ง ไม่เพิ่มงานซ้ำกับบิลที่มีคิวค้างอยู่`,
        })
      }
      default:
        return auctionReply({ error: 'คำสั่งไม่ถูกต้อง' }, 400)
    }
    const result = await supabaseAdmin({ timeoutMs: 15000 }).rpc('manage_live_session', {
      p_tenant: input.tenantId,
      p_session: input.sessionId,
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
