import { after, NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { authorizeAuction, auctionReply, auctionFailure } from '@/lib/features/commerce/auction-api'
import { pageTokenFor, replyToComment } from '@/lib/integrations/facebook/client'
import { parseWebhook } from '@/lib/integrations/facebook/webhook-envelope'
import { runFacebookWebhookWorker } from '@/lib/integrations/facebook/webhook-worker'
import { handleFacebookWebhookEvent } from '@/lib/integrations/facebook/webhook-handler'
import { UUID } from '@/lib/utils'
import { parseAuctionComment } from '@/lib/integrations/facebook/auction-comment-parser'
import { resolveCommentSettings } from '@/lib/features/commerce/comment-config'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Publish as the owning Page; feed the confirmed comment through the same ordered queue. */
export async function POST(req: NextRequest) {
  let posted = false
  let commentId: string | null = null
  try {
    const input = await req.json()
    if (!input || typeof input !== 'object') return auctionReply({ error: 'ข้อมูลไม่ถูกต้อง' }, 400)
    const denied = await authorizeAuction(req, input.tenantId, true)
    if (denied) return denied
    if (
      typeof input.auctionId !== 'string' ||
      !UUID.test(input.auctionId) ||
      !['3', '2', '1', 'close'].includes(input.action)
    )
      return auctionReply({ error: 'คำสั่งประมูลไม่ถูกต้อง' }, 400)
    const db = supabaseAdmin({ timeoutMs: 15000 })
    const auction = await db
      .from('auctions')
      .select('id,page_id,live_post_id,status,session_automation')
      .eq('id', input.auctionId)
      .eq('tenant_id', input.tenantId)
      .maybeSingle()
    if (auction.error) throw auction.error
    if (!auction.data) return auctionReply({ error: 'ไม่พบรายการประมูลของร้านนี้' }, 404)
    if (auction.data.status !== 'active')
      return auctionReply({ error: 'รายการนี้ปิดหรือยกเลิกแล้ว' }, 409)
    const activeSession = await db
      .from('live_sessions')
      .select('mode,auction_settings,comment_settings,confirmation_keywords,closing_keywords')
      .eq('tenant_id', input.tenantId)
      .eq('page_id', auction.data.page_id)
      .eq('live_post_id', auction.data.live_post_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (activeSession.error) throw activeSession.error
    const automation = resolveCommentSettings(
      activeSession.data ?? {},
      auction.data.session_automation ?? {},
    )
    if (
      automation &&
      (input.action === 'close'
        ? automation.closeEnabled === false
        : automation.countEnabled !== true)
    )
      return auctionReply({ error: 'คำสั่งนี้ปิดไว้ในค่าตั้งค่า Session' }, 409)
    const tenant = await db
      .from('tenants')
      .select('page_id,page_access_token')
      .eq('id', input.tenantId)
      .eq('page_id', auction.data.page_id)
      .eq('is_active', true)
      .maybeSingle()
    if (tenant.error) throw tenant.error
    if (!tenant.data)
      return auctionReply({ error: 'เพจของรายการนี้ไม่ได้เชื่อมต่อกับร้านแล้ว' }, 409)
    const token = pageTokenFor(tenant.data)
    if (!token)
      return auctionReply({ error: 'กรุณาเชื่อมต่อ Facebook Page ใหม่ก่อนส่งคอมเมนต์' }, 409)
    const tags = automation
    const command =
      input.action === 'close'
        ? (tags.closeKeywords[0] ?? null)
        : (Object.entries(tags.counting_tags ?? {}).find(
            ([, count]) => String(count) === input.action,
          )?.[0] ?? input.action)
    const parsed =
      typeof command === 'string'
        ? parseAuctionComment(command, true, tags as Parameters<typeof parseAuctionComment>[2])
        : { type: 'IGNORE' as const }
    if (
      typeof command !== 'string' ||
      parsed.type !== 'HOST_CONTROL' ||
      (input.action === 'close'
        ? parsed.action !== 'close'
        : parsed.action !== 'count' || parsed.count !== input.action)
    )
      return auctionReply({ error: 'แท็กคำสั่งไม่ตรงกับการตั้งค่า Session' }, 409)
    let receipt: { id?: unknown }
    try {
      receipt = await replyToComment(token, auction.data.live_post_id, command)
    } catch {
      return auctionReply(
        {
          error:
            'ยังยืนยันการส่งคอมเมนต์ไม่ได้ กรุณาตรวจไลฟ์ก่อนลองอีกครั้ง หากไม่มีคอมเมนต์ให้ตรวจสิทธิ์เพจและเชื่อมต่อ Facebook ใหม่',
        },
        502,
      )
    }
    posted = true
    commentId = typeof receipt.id === 'string' ? receipt.id : null
    if (!commentId) throw new Error('AUCTION_COMMENT_RECEIPT_MISSING')
    const raw = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: auction.data.page_id,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: commentId,
                post_id: auction.data.live_post_id,
                from: { id: auction.data.page_id },
                message: command,
                created_time: new Date().toISOString(),
              },
            },
          ],
        },
      ],
    })
    const envelope = parseWebhook(new TextEncoder().encode(raw))
    const saved = await db.rpc('enqueue_facebook_webhook', {
      p_raw: envelope.raw,
      p_hash: envelope.hash,
      p_events: envelope.events,
    })
    if (saved.error) throw saved.error
    if (!saved.data?.id || !Number.isInteger(saved.data.accepted))
      throw new Error('AUCTION_QUEUE_RECEIPT_INVALID')
    try {
      after(async () => {
        try {
          await runFacebookWebhookWorker(db, handleFacebookWebhookEvent, {
            deadline: Date.now() + 45_000,
            maxEvents: 30,
          })
        } catch {
          console.error('[auction/host-action] deferred worker failed', {
            auctionId: input.auctionId,
            commentId,
          })
        }
      })
    } catch {
      console.warn('[auction/host-action] queued for cron', {
        auctionId: input.auctionId,
        commentId,
      })
    }
    console.info('[auction/host-action] comment queued', {
      auctionId: input.auctionId,
      action: input.action,
      commentId,
    })
    return auctionReply(
      {
        posted: true,
        queued: true,
        commentId,
        message: `ส่งคอมเมนต์ “${command}” เข้าไลฟ์แล้ว กำลังประมวลผลตามลำดับคอมเมนต์`,
      },
      202,
    )
  } catch (error) {
    if (posted) {
      // Graph may already have delivered its webhook. Never publish again on an uncertain enqueue.
      console.error('[auction/host-action] posted; awaiting Meta webhook', { commentId })
      return auctionReply(
        {
          posted: true,
          queued: false,
          commentId,
          message: 'ส่งคอมเมนต์เข้าไลฟ์แล้ว กำลังรอ Webhook ยืนยันสถานะ กรุณาอย่าส่งคำสั่งเดิมซ้ำ',
        },
        202,
      )
    }
    return auctionFailure(error)
  }
}
