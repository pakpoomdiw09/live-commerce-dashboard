import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { canAccessTenant, getActor, isPlatformAdmin } from '@/lib/auth'
import { MissingPageTokenError, pageTokenFor, WINDOW_OR_TAG_ERROR, type MessagingType } from '@/lib/facebook'
import { broadcastAudience, fetchAll } from '@/lib/broadcast'
import { getBilling, reserveCredits, settleCredits } from '@/lib/billing'
import { creditsLeft, OUT_OF_CREDITS, PLANS, UPGRADE_FOR_TAGS } from '@/lib/plans'
import { deliverRichOnce } from '@/lib/slip/notify'
import { BROADCAST_COLUMNS, type BroadcastRow } from '@/lib/chatbot'
import { UUID } from '@/lib/utils'

export const runtime = 'nodejs'
export const maxDuration = 60

const BUDGET_MS = 40_000 // stop starting new batches after this; the caller calls again for the rest
const BATCH = 15 // customers sent at once
const BATCH_DELAY_MS = 1_000 // pause between batches, so the Page isn't throttled or flagged for bursts
const FAILED = '[ส่งไม่สำเร็จ]'
const WINDOW_FAILED = `${FAILED} ${WINDOW_OR_TAG_ERROR}`

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Send (or keep sending) a broadcast. Each call sends as many batches as fit in the time budget and returns
 * { done, sent, failed, skipped, total, remaining }; the dashboard calls again until done.
 * Every customer is messaged at most once (deliverRichOnce claims `bc:<broadcast>:<customer>`).
 * within_24h broadcasts go out as UPDATE to customers inside Meta's 24-hour window; outside_24h ones
 * go out with the broadcast's message tag to customers past it. Everyone else is counted as skipped.
 * Shop owners only: a broadcast reaches every customer at once.
 * Plan gating: Free can't use message tags. Each batch reserves credits first and gives back the
 * ones whose message failed, so only messages Meta accepted cost a credit. Out of credits: 402,
 * the broadcast stays "sending" and can be resumed after an upgrade or top-up.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(req)
  if (!actor) return bad('unauthorized', 401)
  const { id } = await params
  if (!UUID.test(id)) return bad('id must be a uuid')

  const db = supabaseAdmin()
  const { data: row } = await db.from('broadcasts').select(BROADCAST_COLUMNS).eq('id', id).maybeSingle()
  const b = row as BroadcastRow | null
  if (!b || !(await canAccessTenant(actor, b.tenant_id))) return bad('broadcast not found', 404)
  if (!(await canAccessTenant(actor, b.tenant_id, 'owner'))) return bad('เฉพาะเจ้าของร้านเท่านั้นที่ส่งบรอดแคสต์ได้', 403)
  if (b.status === 'sent') return NextResponse.json({ done: true, sent: b.sent, failed: b.failed, skipped: b.skipped, total: b.total, remaining: 0 })
  if (b.audience_window === 'outside_24h' && !b.message_tag) return bad('ส่งหาลูกค้าที่ไม่ได้ทักเกิน 24 ชม. ต้องเลือกหมวดหมู่ข้อความ')
  const messagingType: MessagingType = b.audience_window === 'outside_24h' ? { tag: b.message_tag! } : 'UPDATE'

  let billing
  try {
    billing = await getBilling(db, b.tenant_id, actor.kind === 'user' && isPlatformAdmin(actor))
  } catch (e) {
    return bad(e instanceof Error ? e.message : 'billing unavailable', 500)
  }
  if (!billing.featureBypass && b.audience_window === 'outside_24h' && !PLANS[billing.plan].messageTags) return bad(UPGRADE_FOR_TAGS, 403)
  if (creditsLeft(billing) <= 0) return bad(OUT_OF_CREDITS, 402)

  const { data: tenant } = await db.from('tenants').select('page_id, page_access_token').eq('id', b.tenant_id).maybeSingle()
  const token = pageTokenFor(tenant)
  if (!token) return bad(new MissingPageTokenError().message, 409)

  if (b.status !== 'sending') {
    await db.from('broadcasts').update({ status: 'sending', started_at: new Date().toISOString() }).eq('id', id).in('status', ['draft', 'failed'])
  }

  const prefix = `bc:${id}:`
  try {
    const audience = await broadcastAudience(db, b.tenant_id, b.audience_segment, b.audience_tags, b.audience_window, b.message_tag)
    const attempted = new Set(
      (await fetchAll<{ external_id: string }>((from, to) => db.from('messages').select('external_id').like('external_id', `${prefix}%`).order('id').range(from, to))).map(
        (m) => m.external_id.slice(prefix.length),
      ),
    )
    const queue = audience.reachable.filter((c) => !attempted.has(c.id))
    const deadline = Date.now() + BUDGET_MS
    let outOfCredits = false

    while (queue.length && Date.now() < deadline) {
      const reserved = await reserveCredits(db, b.tenant_id, Math.min(BATCH, queue.length))
      const granted = reserved.monthly + reserved.topup
      if (!granted) {
        outOfCredits = true
        break
      }
      const batch = queue.splice(0, granted)
      const sent = await Promise.all(
        batch.map(async (c) => {
          try {
            return await deliverRichOnce(db, { id: c.id, psid: c.platform_user_id, token }, `${prefix}${c.id}`, b.message, [{ text: b.message }], messagingType)
          } catch (e) {
            // recorded as "[ส่งไม่สำเร็จ] ..." on the message row (with the reason for window/tag errors), counted below
            console.warn('[broadcast] send failed', id, c.id, e instanceof Error ? e.message : e)
            return false
          }
        }),
      )
      await settleCredits(db, b.tenant_id, reserved, sent.filter(Boolean).length)
      if (queue.length) await sleep(BATCH_DELAY_MS)
    }

    const results = await fetchAll<{ body: string | null }>((from, to) => db.from('messages').select('body').like('external_id', `${prefix}%`).order('id').range(from, to))
    const failed = results.filter((m) => m.body?.startsWith(FAILED)).length
    const windowFailed = results.filter((m) => m.body?.startsWith(WINDOW_FAILED)).length
    const remaining = queue.length
    const counts = { total: audience.total, sent: results.length - failed, failed, skipped: audience.total - audience.reachable.length }
    const lastError = windowFailed ? `ส่งไม่สำเร็จ: ${WINDOW_OR_TAG_ERROR} (${windowFailed.toLocaleString('th-TH')} คน)` : null
    await db
      .from('broadcasts')
      .update({ ...counts, last_error: lastError, ...(remaining ? {} : { status: 'sent', finished_at: new Date().toISOString() }) })
      .eq('id', id)
    if (outOfCredits && remaining) return bad(`${OUT_OF_CREDITS} (ยังเหลือผู้รับ ${remaining.toLocaleString('th-TH')} คน กด "ส่งต่อ" ได้หลังเติมเครดิต)`, 402)
    return NextResponse.json({ done: !remaining, remaining, ...counts, lastError })
  } catch (e) {
    console.error('[broadcast] failed', id, e)
    await db
      .from('broadcasts')
      .update({ status: 'failed', last_error: e instanceof Error ? e.message.slice(0, 500) : 'broadcast failed' })
      .eq('id', id)
    return bad(e instanceof Error ? e.message : 'broadcast failed', 500)
  }
}
