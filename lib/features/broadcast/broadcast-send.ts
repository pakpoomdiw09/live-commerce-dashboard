import 'server-only'
import { canAccessTenant } from '@/lib/auth'
import { assertAutomationRunning } from '@/lib/automation-safety'
import { getBilling } from '@/lib/features/billing/billing'
import { SendApiError, sendMessageWithReceipt } from '@/lib/integrations/facebook/client'
import { broadcastPolicyVerified, recipientReason } from '@/lib/features/broadcast/broadcast-policy'
import {
  broadcastEvidence,
  broadcastPageStatus,
  broadcastSignature,
  selectedBroadcastCustomers,
  type BroadcastScope,
} from '@/lib/features/broadcast/broadcast-service'
import type { BroadcastRow } from '@/lib/features/agents/chatbot'
import { InboxError } from '@/lib/features/inbox/inbox-server'
import { fetchAll } from '@/lib/features/broadcast/broadcast'

const BROADCAST_BATCH_SIZE = 10
const BROADCAST_BATCH_DELAY_MS = 1_000
const MAX_RATE_LIMIT_BACKOFF_MS = 30_000

function isMetaRateLimit(error: unknown) {
  return (
    error instanceof SendApiError &&
    (error.status === 429 || [4, 17, 32, 613].includes(error.code ?? -1))
  )
}

function recipientUnavailableReason(error: unknown): string | null {
  if (!(error instanceof SendApiError)) return null
  const code = error.code ?? error.subcode
  if (error.code === 551 || error.code === 2018278 || error.subcode === 2018278)
    return `recipient_unavailable_${code ?? 'unknown'}`

  // Code 10 is also used for Page/app permission failures. Mark it per-recipient
  // only when Meta's own message says the recipient cannot receive this message.
  if (
    error.code === 10 &&
    /recipient|user|blocked|unavailable|cannot receive|can't receive|not available|messaging window|outside.{0,30}24.?hour/i.test(
      error.providerMessage ?? '',
    )
  )
    return `recipient_unavailable_${code ?? '10'}`
  return null
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export async function broadcastDeliveryStats(scope: BroadcastScope, id: string) {
  const deliveries = await fetchAll<{ customer_id: string; status: string; reason: string | null }>(
    (from, to) =>
      scope.db
        .from('broadcast_deliveries')
        .select('customer_id,status,reason')
        .eq('tenant_id', scope.tenantId)
        .eq('broadcast_id', id)
        .order('customer_id')
        .range(from, to),
  )
  return {
    deliveries,
    sent: deliveries.filter((row) => ['accepted', 'delivered', 'read'].includes(row.status)).length,
    delivered: deliveries.filter((row) => ['delivered', 'read'].includes(row.status)).length,
    read: deliveries.filter((row) => row.status === 'read').length,
    failed: deliveries.filter((row) => row.status === 'failed').length,
    unknown: deliveries.filter((row) => ['unknown', 'claimed'].includes(row.status)).length,
    skipped: deliveries.filter((row) => row.status === 'skipped').length,
  }
}

/** No automatic retry of a claimed recipient, including after a transport timeout. */
export async function sendBroadcast(
  scope: BroadcastScope,
  draft: BroadcastRow,
  input: { confirmed?: unknown; fingerprint?: unknown },
) {
  if (
    input.confirmed !== true ||
    input.fingerprint !== broadcastSignature(scope.tenantId, scope.page.page_id, draft)
  )
    throw new InboxError(
      'ข้อมูลเปลี่ยนแล้ว กรุณาตรวจสอบผู้รับและยืนยันใหม่',
      409,
      'PREVIEW_CHANGED',
    )
  if (draft.audience_window !== 'within_24h' || draft.message_tag)
    throw new InboxError(
      'ยังไม่เปิดช่องทางส่งนอกช่วงเวลามาตรฐาน และไม่ใช้ Human Agent กับบรอดแคสต์',
      409,
      'UNSUPPORTED_CHANNEL',
    )
  if (!broadcastPolicyVerified())
    throw new InboxError(
      'ยังไม่เปิดส่งจริง ต้องตรวจนโยบาย Meta และสิทธิ์แอปก่อน',
      409,
      'POLICY_UNVERIFIED',
    )
  if (!scope.token || (await broadcastPageStatus(scope)) !== 'verified')
    throw new InboxError('ยังยืนยันสิทธิ์การส่งของเพจไม่ได้', 409, 'PAGE_UNVERIFIED')
  await assertAutomationRunning(scope.db, scope.tenantId)
  if (draft.status === 'sent') {
    const stats = await broadcastDeliveryStats(scope, draft.id)
    return { ...stats, deliveries: undefined, done: true, remaining: 0, total: draft.total }
  }
  const claim = await scope.db.rpc('claim_broadcast_run', {
    p_broadcast: draft.id,
    p_actor: scope.actor.id,
  })
  if (claim.error?.code === '40001')
    throw new InboxError(
      'รายการเดิมต้องตรวจสอบผลก่อน ระบบจะไม่ส่งซ้ำจากประวัติที่ยังยืนยันไม่ได้',
      409,
      'LEGACY_REVIEW_REQUIRED',
    )
  if (claim.error)
    throw new InboxError(
      'ระบบส่งยังไม่พร้อม กรุณาตรวจการติดตั้ง broadcast-policy.sql',
      503,
      'BROADCAST_SCHEMA_REQUIRED',
    )
  if (!claim.data)
    throw new InboxError('รายการนี้กำลังส่งอยู่ กรุณารอสักครู่แล้วตรวจสถานะ', 409, 'BROADCAST_BUSY')
  const lease = claim.data as string
  try {
    // Claim freezes content in the database; detect edits racing the initial read.
    const locked = await scope.db
      .from('broadcasts')
      .select(
        'name,message,audience_segment,audience_tags,selected_customer_ids,audience_window,message_tag',
      )
      .eq('id', draft.id)
      .eq('tenant_id', scope.tenantId)
      .maybeSingle()
    if (
      locked.error ||
      !locked.data ||
      locked.data.audience_window !== 'within_24h' ||
      locked.data.message_tag ||
      broadcastSignature(scope.tenantId, scope.page.page_id, locked.data) !== input.fingerprint
    )
      throw new InboxError(
        'ฉบับร่างเปลี่ยนแล้ว กรุณาเปิดรายการและตรวจผู้รับใหม่',
        409,
        'PREVIEW_CHANGED',
      )
    const customers = (
      await selectedBroadcastCustomers(
        scope.db,
        scope.tenantId,
        draft.audience_segment,
        draft.audience_tags,
      )
    ).filter(
      (customer) =>
        !draft.selected_customer_ids || draft.selected_customer_ids.includes(customer.id),
    )
    const previous = await broadcastDeliveryStats(scope, draft.id)
    const attempted = new Set(previous.deliveries.map((row) => row.customer_id))
    const queue = customers
      .filter(
        (customer) =>
          !attempted.has(customer.id) &&
          (!draft.selected_customer_ids || draft.selected_customer_ids.includes(customer.id)),
      )
      .sort((left, right) => {
        const leftAt = Date.parse(left.last_message_at ?? '')
        const rightAt = Date.parse(right.last_message_at ?? '')
        const leftTimestamp = Number.isFinite(leftAt) ? leftAt : 0
        const rightTimestamp = Number.isFinite(rightAt) ? rightAt : 0
        return rightTimestamp - leftTimestamp || left.id.localeCompare(right.id)
      })
    const deadline = Date.now() + 25_000
    let cursor = 0,
      processed = 0,
      outOfCredits = false,
      rateLimitBackoffMs = 0,
      dispatchWarning: string | null = null

    while (cursor < queue.length && processed < 20 && Date.now() < deadline) {
      const batch: Array<{
        customer: (typeof queue)[number]
        settle: (result: string, detail: string | null, receipt?: string | null) => Promise<void>
      }> = []
      let preparationError: unknown = null

      try {
        while (
          cursor < queue.length &&
          batch.length < BROADCAST_BATCH_SIZE &&
          processed < 20 &&
          Date.now() < deadline
        ) {
          const customer = queue[cursor++]
          if (
            !broadcastPolicyVerified() ||
            !(await canAccessTenant(scope.actor, scope.tenantId, 'owner'))
          )
            throw new InboxError('Broadcast permission or policy changed; stopping before send', 409)
          await assertAutomationRunning(scope.db, scope.tenantId)
          const currentPage = await scope.db
            .from('tenants')
            .select('page_id,page_access_token,is_active')
            .eq('id', scope.tenantId)
            .maybeSingle()
          if (
            currentPage.error ||
            !currentPage.data?.is_active ||
            currentPage.data.page_id !== scope.page.page_id
          )
            throw new InboxError('Page or shop status changed; review before continuing', 409, 'PAGE_CHANGED')
          const billing = await getBilling(scope.db, scope.tenantId, scope.actor.isPlatformAdmin)
          if (billing.monthly + billing.topup < 1) {
            outOfCredits = true
            break
          }
          const evidence = await broadcastEvidence(
            scope.db,
            scope.tenantId,
            scope.page.page_id,
            customer.id,
          )
          const fresh = await scope.db
            .from('customers')
            .select('agent_opted_out')
            .eq('id', customer.id)
            .eq('tenant_id', scope.tenantId)
            .maybeSingle()
          if (fresh.error || !fresh.data)
            throw new InboxError('Could not verify recipient consent; stopping before send', 503)
          const reason = recipientReason(
            {
              evidence: evidence.get(customer.id),
              pageId: scope.page.page_id,
              optedOut: fresh.data.agent_opted_out,
              pageVerified: true,
              policyVerified: broadcastPolicyVerified(),
              credits: billing.monthly + billing.topup,
            },
            Date.now(),
          )
          const reserved = await scope.db.rpc('claim_broadcast_recipient', {
            p_broadcast: draft.id,
            p_customer: customer.id,
            p_lease: lease,
          })
          if (reserved.error) throw new InboxError('Could not claim recipient; stopping before send', 503)
          if (reserved.data === 'credits_exhausted') {
            outOfCredits = true
            break
          }
          processed++
          if (reserved.data !== 'claimed') {
            console.info('[broadcast] recipient not claimed', {
              broadcastId: draft.id,
              customerId: customer.id,
              reason: reserved.data ?? 'unknown',
              lastMessageAt: customer.last_message_at,
              pageId: scope.page.page_id,
            })
            continue
          }
          const settle = async (
            result: string,
            detail: string | null,
            receipt: string | null = null,
          ) => {
            const saved = await scope.db.rpc('settle_broadcast_recipient', {
              p_broadcast: draft.id,
              p_customer: customer.id,
              p_lease: lease,
              p_result: result,
              p_reason: detail,
              p_receipt: receipt,
            })
            if (saved.error)
              throw new InboxError(
                'Could not record delivery result. Review this broadcast before sending again.',
                503,
                'SEND_REQUIRES_REVIEW',
              )
          }
          if (!customer.platform_user_id.trim()) {
            await settle('skipped', 'missing_psid')
            console.info('[broadcast] recipient skipped', {
              broadcastId: draft.id,
              customerId: customer.id,
              reason: 'missing_psid',
            })
            continue
          }
          if (reason !== 'eligible') {
            await settle('skipped', reason)
            console.info('[broadcast] recipient skipped', {
              broadcastId: draft.id,
              customerId: customer.id,
              reason,
              lastMessageAt: customer.last_message_at,
              pageId: scope.page.page_id,
            })
            continue
          }
          const started = await scope.db.rpc('begin_broadcast_transport', {
            p_broadcast: draft.id,
            p_customer: customer.id,
            p_lease: lease,
          })
          if (started.error) throw new InboxError('Could not verify recipient before transport', 503)
          if (started.data !== true) continue
          batch.push({ customer, settle })
        }
      } catch (error) {
        preparationError = error
      }

      if (preparationError) {
        const aborted = await Promise.allSettled(
          batch.map((item) => item.settle('skipped', 'preflight_aborted')),
        )
        const settleFailure = aborted.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        )
        if (settleFailure) throw settleFailure.reason
        throw preparationError
      }
      if (!batch.length) continue

      // Ten recipients at a time; wait after the whole batch so the rolling
      // rate stays at or below ten requests per second for this broadcast run.
      const outcomes = await Promise.allSettled(
        batch.map(async ({ customer }) => {
          await assertAutomationRunning(scope.db, scope.tenantId)
          return sendMessageWithReceipt(
            scope.token,
            customer.platform_user_id,
            { text: draft.message },
            'UPDATE',
          )
        }),
      )
      let hitRateLimit = false,
        stopAfterBatch = false,
        fatalAfterBatch: unknown = null

      for (let index = 0; index < outcomes.length; index++) {
        const outcome = outcomes[index]
        const { customer, settle } = batch[index]
        if (outcome.status === 'fulfilled') {
          try {
            await settle('accepted', null, outcome.value)
            const transcript = await scope.db.from('messages').insert({
              customer_id: customer.id,
              external_id: 'bc:' + draft.id + ':' + customer.id,
              sender: 'bot',
              body: draft.message,
              provider_message_id: outcome.value,
              delivery_status: 'sent',
            })
            if (transcript.error)
              console.warn('[broadcast] transcript unavailable', { code: transcript.error.code })
          } catch (error) {
            fatalAfterBatch ??= error
          }
          continue
        }

        const error = outcome.reason
        if (error instanceof InboxError) {
          try {
            await settle('skipped', 'automation_stopped')
          } catch (settleError) {
            fatalAfterBatch ??= settleError
          }
          fatalAfterBatch ??= error
          continue
        }

        const unavailable = recipientUnavailableReason(error)
        if (unavailable) {
          try {
            await settle('skipped', unavailable)
          } catch (settleError) {
            fatalAfterBatch ??= settleError
          }
          console.info('[broadcast] recipient cannot receive message', {
            broadcastId: draft.id,
            customerId: customer.id,
            reason: unavailable,
          })
          continue
        }

        if (isMetaRateLimit(error)) {
          hitRateLimit = true
          dispatchWarning = 'Meta จำกัดอัตราการส่ง ระบบพักก่อนส่งชุดถัดไป'
          const apiError = error as SendApiError
          try {
            await settle(
              'failed',
              'meta_rate_limit_' + (apiError.code ?? 'http_' + apiError.status),
            )
          } catch (settleError) {
            fatalAfterBatch ??= settleError
          }
          console.warn('[broadcast] Meta rate limit; recipient will not be retried', {
            broadcastId: draft.id,
            customerId: customer.id,
            httpStatus: apiError.status,
            errorCode: apiError.code,
          })
          continue
        }

        const apiError = error instanceof SendApiError ? error : null
        const refused = apiError !== null && apiError.status < 500
        try {
          await settle(
            refused ? 'failed' : 'unknown',
            refused
              ? 'meta_api_rejected_' + (apiError.code ?? apiError.status)
              : 'transport_uncertain',
          )
        } catch (settleError) {
          fatalAfterBatch ??= settleError
        }
        // Code 10 without recipient-specific evidence, 190, and 200 commonly
        // indicate Page/app configuration. Stop this run rather than fan out.
        if (apiError && [10, 190, 200].includes(apiError.code ?? -1)) {
          stopAfterBatch = true
          dispatchWarning = 'Meta ปฏิเสธการส่ง ตรวจสอบสิทธิ์ของเพจ/แอปก่อนส่งต่อ'
        }
      }

      if (fatalAfterBatch) throw fatalAfterBatch
      rateLimitBackoffMs = hitRateLimit
        ? Math.min(rateLimitBackoffMs ? rateLimitBackoffMs * 2 : 2_000, MAX_RATE_LIMIT_BACKOFF_MS)
        : 0
      if (stopAfterBatch) break
      if (cursor < queue.length && processed < 20 && Date.now() < deadline) {
        const delayMs = Math.max(BROADCAST_BATCH_DELAY_MS, rateLimitBackoffMs)
        if (Date.now() + delayMs >= deadline) break
        await pause(delayMs)
      }
    }
    const stats = await broadcastDeliveryStats(scope, draft.id)
    const remaining = Math.max(0, queue.length - processed),
      done = remaining === 0
    const total = Math.max(customers.length, stats.deliveries.length)
    const updated = await scope.db
      .from('broadcasts')
      .update({
        total,
        sent: stats.sent,
        failed: stats.failed,
        skipped: stats.skipped,
        status: done ? 'sent' : 'sending',
        last_error: stats.unknown
          ? 'บางรายการยังไม่ทราบผล ห้ามส่งซ้ำอัตโนมัติ'
          : outOfCredits
            ? 'เครดิตข้อความไม่พอ'
            : dispatchWarning,
        ...(done ? { finished_at: new Date().toISOString() } : {}),
      })
      .eq('id', draft.id)
      .eq('tenant_id', scope.tenantId)
    if (updated.error) throw new InboxError('บันทึกสรุปไม่สำเร็จ กรุณาตรวจประวัติก่อนส่งต่อ', 503)
    return { ...stats, deliveries: undefined, total, remaining, done, outOfCredits }
  } finally {
    // Release only our own lease; uncertainty remains durable in the recipient ledger.
    await scope.db
      .from('broadcast_runs')
      .update({ locked_until: new Date().toISOString() })
      .eq('broadcast_id', draft.id)
      .eq('lease', lease)
  }
}
