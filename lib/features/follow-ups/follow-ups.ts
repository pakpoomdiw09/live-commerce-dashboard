import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pageTokenFor,
  sendMessageWithReceipt,
  SendApiError,
  isWindowOrTagError,
} from '@/lib/integrations/facebook/client'
export type FollowUpRun = {
  sent: number
  cancelled: number
  failed: number
  review: number
  skipped: number
  remaining: boolean
  sendEnabled: boolean
}
type Claimed = { id: string; tenant_id: string; claim_token: string; run_at?: string }
/** DB transactions own claims, preflight checks, leases, quota, durable messages and result persistence. */
export async function runFollowUps(
  db: SupabaseClient,
  tenantId?: string,
  deadline = Date.now() + 45000,
  _legacyBypass = false,
): Promise<FollowUpRun> {
  const result: FollowUpRun = {
    sent: 0,
    cancelled: 0,
    failed: 0,
    review: 0,
    skipped: 0,
    remaining: false,
    sendEnabled: true,
  }
  const started = Date.now()
  let claimedCount = 0
  console.info('[FOLLOW-UP WORKER] started', {
    tenantId: tenantId ?? 'all',
    nowUTC: new Date(started).toISOString(),
  })
  try {
    // Claim one at a time so slow API calls never strand an unprocessed batch of claims.
    for (let n = 0; n < 10 && Date.now() < deadline - 12000; n++) {
      const claimed = await db.rpc('claim_follow_up_jobs', {
        p_tenant: tenantId ?? null,
        p_limit: 1,
      })
      if (claimed.error) {
        console.error('[FOLLOW-UP CLAIM] failed', { code: claimed.error.code })
        throw new Error('อ่านคิวติดตามไม่ได้ กรุณาตรวจสอบ smart-follow-ups.sql')
      }
      const job = (claimed.data as Claimed[] | null)?.[0]
      if (!job) {
        result.remaining = false
        console.info('[FOLLOW-UP CLAIM] no due jobs', {
          tenantId: tenantId ?? 'all',
          claimed: claimedCount,
        })
        return result
      }
      claimedCount++
      console.info('[FOLLOW-UP CLAIM] claimed', {
        jobId: job.id,
        tenantId: job.tenant_id,
        dueUTC: job.run_at ?? null,
        nowUTC: new Date().toISOString(),
      })
      result.remaining = true
      if (
        process.env.SNAPBOT_SAFETY_ENABLED === 'true' &&
        (await (await import('@/lib/automation-safety')).automationStopped(db, job.tenant_id))
      ) {
        const held = await db
          .from('follow_up_jobs')
          .update({
            status: 'requires_review',
            reason: 'automation_stopped',
            claim_token: null,
            claim_until: null,
          })
          .eq('id', job.id)
          .eq('status', 'processing')
          .eq('claim_token', job.claim_token)
        if (held.error) throw held.error
        console.info('[FOLLOW-UP PREPARE] blocked', { jobId: job.id, reason: 'automation_stopped' })
        result.review++
        continue
      }
      // Obtain the Page token before preflight: a missing token must never consume message credit.
      const page = await db
        .from('tenants')
        .select('page_id,page_access_token')
        .eq('id', job.tenant_id)
        .maybeSingle()
      if (page.error) throw page.error
      const token = pageTokenFor(page.data)
      if (!token) {
        const saved = await db
          .from('follow_up_jobs')
          .update({
            status: 'requires_review',
            reason: 'no_token',
            claim_token: null,
            claim_until: null,
          })
          .eq('id', job.id)
          .eq('status', 'processing')
          .eq('claim_token', job.claim_token)
        if (saved.error) throw saved.error
        console.warn('[FOLLOW-UP PREPARE] blocked', { jobId: job.id, reason: 'no_token' })
        result.review++
        continue
      }
      const prepared = await db.rpc('prepare_follow_up', {
        p_job: job.id,
        p_claim: job.claim_token,
      })
      if (prepared.error) {
        console.error('[smart-follow-up] preflight failed', {
          jobId: job.id,
          code: prepared.error.code,
        })
        continue
      }
      const ready = prepared.data as {
        status: string
        text?: string
        psid?: string
        reason?: string
      } | null
      console.info('[FOLLOW-UP PREPARE] result', {
        jobId: job.id,
        status: ready?.status ?? 'invalid',
        reason: ready?.reason ?? null,
      })
      if (!ready) {
        console.error('[FOLLOW-UP PREPARE] invalid response', { jobId: job.id })
        continue
      }
      if (ready.status !== 'ready') {
        if (ready.status === 'requires_review') result.review++
        else if (ready.status === 'cancelled') result.cancelled++
        else result.skipped++
        continue
      }
      // prepare_follow_up commits the message/dispatch marker before this one and only network call.
      let outcome: 'sent' | 'failed' | 'requires_review' = 'requires_review',
        provider: string | null = null,
        reason: string | null = 'delivery_unknown'
      try {
        if (!ready.text || !ready.psid) throw new Error('Invalid prepared dispatch')
        if (process.env.SNAPBOT_SAFETY_ENABLED === 'true')
          await (await import('@/lib/automation-safety')).assertAutomationRunning(db, job.tenant_id)
        const authorized = await db.rpc('authorize_follow_up_dispatch', {
          p_job: job.id,
          p_claim: job.claim_token,
        })
        if (authorized.error) {
          console.error('[smart-follow-up] final check failed', {
            jobId: job.id,
            code: authorized.error.code,
          })
          throw new Error('FOLLOW_UP_PRECHECK_FAILED')
        }
        const permission = authorized.data as { status?: string; reason?: string } | null
        console.info('[smart-follow-up] final check', {
          jobId: job.id,
          status: permission?.status ?? 'invalid',
          reason: permission?.reason ?? null,
        })
        if (
          !permission ||
          !['ready', 'cancelled', 'requires_review', 'skipped'].includes(permission.status ?? '')
        )
          throw new Error('FOLLOW_UP_PRECHECK_FAILED')
        if (permission.status !== 'ready') {
          if (permission.status === 'cancelled') result.cancelled++
          else if (permission.status === 'requires_review') result.review++
          else result.skipped++
          continue
        }
        const sendStarted = Date.now()
        console.info('[FOLLOW-UP SEND] request', {
          jobId: job.id,
          tenantId: job.tenant_id,
          textLength: ready.text.length,
          nowUTC: new Date(sendStarted).toISOString(),
        })
        provider = await sendMessageWithReceipt(token, ready.psid, { text: ready.text }, 'UPDATE')
        console.info('[FOLLOW-UP SEND] accepted', {
          jobId: job.id,
          providerMessageId: provider,
          durationMs: Date.now() - sendStarted,
        })
        outcome = 'sent'
        reason = null
      } catch (error) {
        if ((error as { code?: string })?.code === 'AUTOMATION_STOPPED') {
          outcome = 'failed'
          reason = 'automation_stopped'
        }
        if (
          error instanceof Error &&
          ['FOLLOW_UP_SEND_DISABLED', 'FOLLOW_UP_PRECHECK_FAILED'].includes(error.message)
        ) {
          outcome = 'failed'
          reason = error.message === 'FOLLOW_UP_SEND_DISABLED' ? 'send_disabled' : 'precheck_failed'
        }
        if (error instanceof SendApiError && error.status < 500) {
          outcome = isWindowOrTagError(error) ? 'requires_review' : 'failed'
          reason = isWindowOrTagError(error) ? 'window_closed' : 'api_rejected'
        }
        console.warn('[smart-follow-up] delivery result', {
          jobId: job.id,
          outcome,
          code: error instanceof SendApiError ? error.code : 'network_unknown',
        })
        console.warn('[FOLLOW-UP SEND] failed', {
          jobId: job.id,
          tenantId: job.tenant_id,
          outcome,
          reason,
          httpStatus: error instanceof SendApiError ? error.status : null,
          facebookCode: error instanceof SendApiError ? error.code : null,
          facebookSubcode: error instanceof SendApiError ? error.subcode : null,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
      }
      // Explicit window rejection is also known not delivered; refund before putting it in review.
      const settled = await db.rpc('complete_follow_up', {
        p_job: job.id,
        p_claim: job.claim_token,
        p_result: outcome,
        p_provider: provider,
        p_reason: reason,
      })
      if (settled.error || settled.data !== true) {
        console.error('[smart-follow-up] result persistence requires review', {
          jobId: job.id,
          code: settled.error?.code ?? 'claim_changed',
        })
        result.review++
        continue // recovery converts an expired dispatch to review; never resend.
      }
      if (outcome === 'sent') result.sent++
      else if (outcome === 'failed') result.failed++
      else result.review++
      console.info('[FOLLOW-UP SEND] persisted', { jobId: job.id, outcome, reason })
    }
    return result
  } finally {
    console.info('[FOLLOW-UP WORKER] complete', {
      tenantId: tenantId ?? 'all',
      claimed: claimedCount,
      ...result,
      durationMs: Date.now() - started,
    })
  }
}
