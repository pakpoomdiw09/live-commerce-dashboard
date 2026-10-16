/* eslint-disable @typescript-eslint/no-explicit-any */
import { after, NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getCustomerProfile, getPageTokenStatus, pageTokenFor, privateReply, replyToComment, type OutgoingMessage } from '@/lib/facebook'
import { RULE_COLUMNS, ruleMatches, type CommentRule } from '@/lib/comment-rules'
import { answerChat } from '@/lib/chatbot-server'
import { cfCode, orderSummaryText, pendingOrders, placeCfOrder, soldOutText } from '@/lib/orders'
import { processSlip } from '@/lib/slip/process'
import { deliverOnce, notifySlipResult, type Recipient } from '@/lib/slip/notify'
import { downloadSlipImage, slipCandidates } from '@/lib/slip/image'
import { sendWithMessageCredit } from '@/lib/message-quota'
import {observeFollowUpMessage} from '@/lib/followup-ai'
import {queueMessengerVision} from '@/lib/vision'

export const runtime = 'nodejs' // node:crypto
// slip checks run in after(): image download (10 s) + SlipOK (20 s) + reply (10 s) per image
export const maxDuration = 60

// Subscribe the Page to the `messages` and `feed` fields in the Meta app dashboard.

// 1) Meta calls this once, when you register the webhook URL
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const token = process.env.FB_VERIFY_TOKEN?.trim() || process.env.FACEBOOK_VERIFY_TOKEN?.trim()
  const challenge = q.get('hub.challenge')
  // an unset or empty token must never verify (fail closed)
  if (token && challenge && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === token) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  if (!token) console.error('[fb webhook] FB_VERIFY_TOKEN is not set in .env.local')
  return new NextResponse('Forbidden', { status: 403 })
}

// 2) Every message and comment event arrives here
export async function POST(req: NextRequest) {
  const raw = await req.text() // the signature covers the raw body, so don't parse first
  const sigError = signatureError(raw, req.headers.get('x-hub-signature-256'))
  if (sigError) {
    console.error('[fb webhook] 401:', sigError)
    return new NextResponse('Invalid signature', { status: 401 })
  }
  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return new NextResponse('Bad JSON', { status: 400 })
  }
  // Answer 200 immediately (Meta retries slow responses) and do the work afterwards.
  // Errors here never reach Meta (it already got 200): check the server log.
  after(() => processEvents(payload).catch((e) => console.error('[fb webhook] processing failed:', e)))
  return NextResponse.json({ ok: true })
}

/** null when the signature is valid, otherwise the reason (for the server log only) */
function signatureError(raw: string, header: string | null): string | null {
  const secret = process.env.FB_APP_SECRET?.trim()
  // an empty secret is a valid HMAC key, so refuse to validate anything when it is not set
  if (!secret) return 'FB_APP_SECRET is not set in .env.local (Meta app > App settings > Basic > App secret)'
  if (!header) return 'missing X-Hub-Signature-256 header (request did not come from Meta?)'
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return null
  return 'signature mismatch: FB_APP_SECRET does not belong to the app that owns this webhook'
}

/** Tenant settings the webhook needs. A Page not linked to a tenant in Settings gets null. */
type PageTenant = {
  id: string
  name: string
  account_name: string | null
  account_number: string
  bank_code: string
  page_id: string
  page_access_token: string | null
  auto_reply_enabled: boolean
  auto_verify_enabled: boolean
}

async function tenantForPage(pageId: string): Promise<PageTenant | null> {
  const { data, error } = await supabaseAdmin()
    .from('tenants')
    .select('id, name, account_name, account_number, bank_code, page_id, page_access_token, auto_reply_enabled, auto_verify_enabled')
    .eq('page_id', pageId)
    .eq('is_active', true)
    .maybeSingle()
  // fail closed: without the tenant nothing automatic runs (no SlipOK credit, no replies)
  if (error) console.error('[fb webhook] tenant lookup failed (did you run supabase/platform.sql?):', error.message)
  return (data as PageTenant | null) ?? null
}

/** Every event is handled on its own: one failure must not drop the rest of the batch (Meta won't resend it). */
async function processEvents(payload: any) {
  for (const entry of payload.entry ?? []) {
    const pageId = String(entry.id)
    const hasWork = entry.messaging?.length || entry.changes?.length
    const tenant = hasWork ? await tenantForPage(pageId) : null
    if (hasWork && !tenant) console.warn(`[fb webhook] Page ${pageId} is not linked to a tenant: storing only, no automation`)

    for (const ev of entry.messaging ?? []) {
      try {
        await onMessage(ev, pageId, tenant)
      } catch (e) {
        console.error('[fb webhook] message event failed', ev?.message?.mid ?? '', e)
      }
    }
    for (const ch of entry.changes ?? []) {
      console.log(`[fb webhook] ${ch.field} ${ch.value?.item ?? ''} ${ch.value?.verb ?? ''} page=${pageId}`)
      if (ch.field !== 'feed' || ch.value?.item !== 'comment' || ch.value?.verb !== 'add') continue
      try {
        await onComment(ch.value, pageId, tenant)
      } catch (e) {
        console.error('[fb webhook] comment event failed', ch.value?.comment_id ?? '', e)
      }
    }
  }
}

/** Only signed Meta events for this Page/customer can mark outgoing messages delivered/read. */
async function recordReceipt(ev: any, tenantId: string, pageId: string) {
  if (String(ev.recipient?.id) !== pageId || typeof ev.sender?.id !== 'string') return
  const db = supabaseAdmin()
  const customer = await db.from('customers').select('id').eq('tenant_id', tenantId).eq('platform_user_id', ev.sender.id).eq('platform', 'facebook').maybeSingle()
  if (customer.error) throw customer.error
  if (!customer.data) return
  if (ev.delivery?.mids?.length) {
    const mids = ev.delivery.mids.filter((id: unknown) => typeof id === 'string').slice(0, 100)
    const result = await db.from('messages').update({ delivery_status: 'delivered' }).eq('customer_id', customer.data.id).in('provider_message_id', mids).in('delivery_status', ['sent','pending'])
    if (result.error) throw result.error
  }
  if (typeof ev.read?.watermark === 'number' && Number.isFinite(ev.read.watermark) && ev.read.watermark <= Date.now() + 120000 && ev.read.watermark > 0) {
    const result = await db.from('messages').update({ delivery_status: 'read' }).eq('customer_id', customer.data.id).neq('sender', 'customer').not('provider_message_id', 'is', null).lte('created_at', new Date(ev.read.watermark).toISOString()).in('delivery_status', ['sent','delivered'])
    if (result.error) throw result.error
  }
}

async function onMessage(ev: any, pageId: string, tenant: PageTenant | null) {
  if (tenant && (ev.delivery || ev.read)) {
    await recordReceipt(ev, tenant.id, pageId)
    return
  }
  const m = ev.message
  if (!m || m.is_echo) return // skip receipts and the Page's own messages
  const psid = ev.sender?.id
  if (typeof psid !== 'string' || !/^\d+$/.test(psid)) return
  const db = supabaseAdmin()
  const token = pageTokenFor(tenant ?? { page_id: pageId, page_access_token: null })
  if (process.env.FB_DEBUG === 'true') {
    console.log('[fb webhook] customer profile token source', {
      pageId, tenantId: tenant?.id ?? null,
      source: tenant?.page_access_token?.trim() ? 'tenants.page_access_token' : token ? 'environment fallback' : 'missing',
      tokenPresent: Boolean(token),
    })
    if (token) console.log('[fb webhook] customer profile token status', { pageId, status: await getPageTokenStatus(token, pageId) })
  }

  // On conflict only these columns are written, so bot_enabled, display_name and the CRM fields are
  // preserved. tenant_id is only sent when the Page is linked, so an unlinked Page never clears it.
  const { data: customer, error } = await db
    .from('customers')
    .upsert(
      { platform: 'facebook', platform_user_id: psid, last_message_at: new Date().toISOString(), ...(tenant ? { tenant_id: tenant.id } : {}) },
      { onConflict: 'platform,platform_user_id' },
    )
    .select('id, display_name, bot_enabled')
    .single()
  // "Invalid API key" here means SUPABASE_SERVICE_ROLE_KEY in .env.local is wrong or truncated
  if (error || !customer) throw new Error(`customer upsert failed: ${error?.message ?? 'no row returned'}`)

  const { data: message, error: insertError } = await db
    .from('messages')
    .insert({
      customer_id: customer.id,
      external_id: m.mid,
      sender: 'customer',
      body: m.text ?? null,
      attachments: m.attachments ?? [],
    })
    .select('id')
    .single()
  if (insertError?.code === '23505') return // Meta retried an event we already stored
  if (insertError || !message) throw insertError ?? new Error('message insert returned no row')

  if (tenant) {
    try {
      const profile = await getCustomerProfile(token, psid)
      if (Object.keys(profile).length) {
        const { data: savedProfile, error: profileError } = await db.from('customers')
          .update(profile)
          .eq('id', customer.id)
          .eq('platform', 'facebook')
          .eq('platform_user_id', psid)
          .eq('tenant_id', tenant.id)
          .select('id, tenant_id, platform_user_id, display_name, avatar_url')
          .maybeSingle()
        if (profileError) {
          console.error('[fb webhook] customer profile save failed', { tenantId: tenant.id, senderId: psid, code: profileError.code, message: profileError.message })
        } else if (savedProfile) {
          console.log('[fb webhook] customer profile saved', {
            customerId: savedProfile.id, tenantId: savedProfile.tenant_id, senderId: savedProfile.platform_user_id,
            name: savedProfile.display_name, avatarUrl: savedProfile.avatar_url, updatedFields: Object.keys(profile),
          })
        } else {
          console.warn('[fb webhook] customer profile not saved: no matching tenant/PSID', { customerId: customer.id, tenantId: tenant.id, senderId: psid })
        }
      } else {
        console.warn('[fb webhook] customer profile unchanged: Graph returned no usable profile', { tenantId: tenant.id, senderId: psid })
      }
    } catch { console.warn('[fb webhook] customer profile refresh failed') }
  }

  // A Page not linked to a tenant: we don't know whose account a slip should go to, who pays for
  // the SlipOK credit, or what to answer. Keep the message for a platform admin and stop.
  if (!tenant) return

  // Auto-reply is on when the tenant allows it and the admin hasn't taken this chat over
  const autoReply = customer.bot_enabled && tenant.auto_reply_enabled
  const recipient: Recipient = { id: customer.id, psid, token }

  // Slip images sent in chat (SlipOK Auto-Pilot): same pipeline as /api/slips/verify.
  // With Auto-Pilot off the images stay in the chat and an admin can verify them from the dashboard.
  // A Meta retry never gets this far: the duplicate mid was rejected by the insert above.
  const visionQueued = await queueMessengerVision(db, tenant.id, customer.id, message.id, slipCandidates(m.attachments))
  if (tenant.auto_verify_enabled && !visionQueued) {
    for (const url of slipCandidates(m.attachments)) {
      try {
        await onSlipImage(url, { ...recipient, messageId: message.id, notify: autoReply }, tenant)
      } catch (e) {
        console.error('[fb webhook] slip image failed', message.id, e)
      }
    }
  }

  if (visionQueued || !m.text) return
  // CF: the customer typed a product code ("1", "A12", "cf 3")
  if (await onCfOrder(m.text, recipient, message.id, tenant, autoReply)) return
  if (!autoReply) return
  try { await observeFollowUpMessage(db,tenant.id,customer.id,message.id) }
  catch { console.warn('[smart-follow-up] message observation unavailable',{tenantId:tenant.id}) }
  const currentBot=await db.from('customers').select('bot_enabled').eq('id',customer.id).eq('tenant_id',tenant.id).maybeSingle()
  if(currentBot.error||!currentBot.data?.bot_enabled)return
  await answerChat(db, { tenant, customer, recipient, messageId: message.id, text: m.text })
}

/** true when the text was a product code of this tenant (the order is placed even with auto-reply off). */
async function onCfOrder(text: string, customer: Recipient, messageId: string, tenant: PageTenant, autoReply: boolean) {
  const code = cfCode(text)
  if (!code) return false
  const db = supabaseAdmin()
  const r = await placeCfOrder(db, { tenantId: tenant.id, customerId: customer.id, messageId, code })
  if (r.status === 'no_match') return false
  console.log(`[fb webhook] CF "${code}" → ${r.status}`)
  if (!autoReply) return true // the admin answers this chat by hand; the order is in the dashboard
  const body =
    r.status === 'created'
      ? tenant.account_number && tenant.bank_code
        ? orderSummaryText(r, (await pendingOrders(db, customer.id)).total, tenant)
        : 'รับออเดอร์แล้วค่ะ ขณะนี้ร้านยังไม่มีบัญชีรับเงินที่เปิดใช้งาน กรุณารอแอดมินแจ้งวิธีชำระเงินก่อนโอน'
      : soldOutText(r)
  await deliverOnce(db, customer, `order:${messageId}`, body)
  return true
}

/** notify: reply with the verdict in Messenger (off when auto-reply is off for the tenant or this chat) */
async function onSlipImage(url: string, customer: Recipient & { messageId: string; notify: boolean }, tenant: PageTenant) {
  const file = await downloadSlipImage(url)
  if (!file) return
  const db = supabaseAdmin()
  // Shared verification loads this customer's outstanding order total from the database.
  const r = await processSlip(db, {
    file,
    customerId: customer.id,
    messageId: customer.messageId,
    tenant,
  })
  if (r.failure) return console.error('slip from chat not stored:', r.failure)
  if (customer.notify) await notifySlipResult(db, r, customer, tenant.name)
}

async function onComment(v: any, pageId: string, tenant: PageTenant | null) {
  // the Page's own replies (including the auto-replies below): never answer them, or rules would loop
  if (v.from?.id === pageId) return
  const db = supabaseAdmin()

  // Meta leaves out `from` when the app lacks pages_read_engagement / Page Public Content Access,
  // or (in Development mode) when the commenter has no role on the app
  if (!v.from) console.warn('[fb webhook] comment has no `from` (check app permissions / Live mode):', v.comment_id)

  // NOTE: check that a comment author's from.id matches the Messenger PSID on your Page;
  // if it doesn't, comment authors and chat customers end up as separate rows.
  const { data: customer } = v.from
    ? await db
        .from('customers')
        .upsert(
          { platform: 'facebook', platform_user_id: v.from.id, display_name: v.from.name, ...(tenant ? { tenant_id: tenant.id } : {}) },
          { onConflict: 'platform,platform_user_id' },
        )
        .select('id')
        .single()
    : { data: null }

  const { data: comment, error } = await db
    .from('comments')
    .insert({
      customer_id: customer?.id ?? null,
      tenant_id: tenant?.id ?? null,
      external_id: v.comment_id,
      post_id: v.post_id,
      author_name: v.from?.name ?? null,
      body: v.message ?? null,
    })
    .select('id')
    .single()
  if (error?.code === '23505') return // Meta retried: the rules already ran for this comment
  if (error) throw error

  // rules belong to a tenant: an unlinked Page has none
  if (v.message && tenant) await runCommentRules(comment.id, v, pageId, tenant)
}

/** First active rule (oldest first) of this tenant, for this Page, whose keywords match the comment. */
async function runCommentRules(commentRowId: string, v: any, pageId: string, tenant: PageTenant) {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('comment_rules')
    .select(RULE_COLUMNS)
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .contains('page_ids', [pageId])
    .order('created_at')
  if (error) throw new Error(`comment rules: ${error.message} (did you run supabase/comment-rules.sql and platform.sql?)`)
  const rules = data as CommentRule[]
  // without `from` the Page's own auto-replies can't be recognised above: don't answer our own reply text
  if (!v.from && rules.some((r) => r.reply_text?.trim() === v.message.trim())) return
  const rule = rules.find((r) => ruleMatches(r, v.message))
  console.log(`[fb webhook] comment ${v.comment_id} → ${rule ? `rule "${rule.name}"` : 'no matching rule'}`)
  if (!rule) return
  await db.from('comments').update({ rule_id: rule.id }).eq('id', commentRowId)

  const token = pageTokenFor(tenant)
  const jobs: Promise<void>[] = []
  if (rule.reply_enabled && rule.reply_text) jobs.push(sendWithMessageCredit(db, tenant.id, () => replyToComment(token, v.comment_id, rule.reply_text!)))
  if (rule.inbox_enabled) {
    const message: OutgoingMessage | null =
      rule.inbox_type === 'image'
        ? rule.inbox_image_url
          ? { attachment: { type: 'image', payload: { url: rule.inbox_image_url, is_reusable: true } } }
          : null
        : rule.inbox_text
          ? { text: rule.inbox_text }
          : null
    if (message) jobs.push(sendWithMessageCredit(db, tenant.id, () => privateReply(token, v.comment_id, message)))
  }
  // independent: a failed public reply must not stop the inbox message, and the other way round
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === 'rejected') console.error(`[comment rule "${rule.name}"]`, r.reason)
  }
}
