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
  errors: number
  jobs: { jobId: string; status: string; reason: string | null }[]
}
type Claimed = { id: string; tenant_id: string; claim_token: string; run_at?: string }

/** Retry only result persistence, never the provider request. A lost RPC response may have committed. */
async function settleFollowUp(
  db: SupabaseClient,
  job: Claimed,
  outcome: 'sent' | 'failed' | 'requires_review' | 'cancelled',
  provider: string | null,
  reason: string | null,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const settled = await db.rpc('complete_follow_up', {
      p_job: job.id,
      p_claim: job.claim_token,
      p_result: outcome,
      p_provider: provider,
      p_reason: reason,
    })
    if (!settled.error && settled.data === true) return true
    console.error('[FOLLOW-UP RESULT] persistence not confirmed', {
      jobId: job.id,
      attempt: attempt + 1,
      code: settled.error?.code ?? 'claim_changed',
    })
  }
  // Do not mistake an already-committed completion for a failed send.
  const saved = await db
    .from('follow_up_jobs')
    .select('status,provider_message_id,reason')
    .eq('id', job.id)
    .eq('tenant_id', job.tenant_id)
    .maybeSingle()
  return (
    !saved.error &&
    saved.data?.status === outcome &&
    saved.data.provider_message_id === provider &&
    saved.data.reason === reason
  )
}

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
    errors: 0,
    jobs: [],
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
      const expired = await db.rpc('expire_follow_up_if_outside_window', {
        p_job: job.id,
        p_claim: job.claim_token,
      })
      if (expired.error || typeof expired.data !== 'boolean') {
        console.error('[FOLLOW-UP WINDOW] check failed', {
          jobId: job.id,
          code: expired.error?.code ?? 'invalid_response',
        })
        throw new Error('FOLLOW_UP_WINDOW_CHECK_FAILED: apply supabase/follow-up-24h-window.sql')
      }
      if (expired.data) {
        result.cancelled++
        result.jobs.push({ jobId: job.id, status: 'cancelled', reason: 'outside_24h_window' })
        console.info('[FOLLOW-UP WINDOW] cancelled', {
          jobId: job.id,
          reason: 'outside_24h_window',
        })
        continue
      }
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
        result.jobs.push({ jobId: job.id, status: 'requires_review', reason: 'automation_stopped' })
        continue
      }
      // Obtain the Page token before preflight: a missing token must never consume message credit.
      const page = await db
        .from('tenants')
        .select('page_id,page_access_token')
        .eq('id', job.tenant_id)
        .maybeSingle()
      if (page.error) throw page.error
      // A missing tenant/Page must never accidentally select an unrelated shared token.
      const token = page.data?.page_id ? pageTokenFor(page.data) : null
      console.info('[FOLLOW-UP PREPARE] token', {
        jobId: job.id,
        tenantId: job.tenant_id,
        pageId: page.data?.page_id ?? null,
        tokenPresent: Boolean(token),
        source: page.data?.page_access_token?.trim() ? 'tenant' : token ? 'environment' : 'missing',
      })
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
        result.jobs.push({ jobId: job.id, status: 'requires_review', reason: 'no_token' })
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
        // Preflight is transactional. Only release a claim if dispatch never started.
        const held = await db
          .from('follow_up_jobs')
          .update({
            status: 'requires_review',
            reason: 'prepare_failed',
            claim_token: null,
            claim_until: null,
          })
          .eq('id', job.id)
          .eq('tenant_id', job.tenant_id)
          .eq('status', 'processing')
          .eq('claim_token', job.claim_token)
          .is('dispatch_started_at', null)
        if (held.error)
          console.error('[FOLLOW-UP PREPARE] release failed', {
            jobId: job.id,
            code: held.error.code,
          })
        result.errors++
        result.review++
        result.jobs.push({ jobId: job.id, status: 'requires_review', reason: 'prepare_failed' })
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
        result.errors++
        result.jobs.push({
          jobId: job.id,
          status: 'requires_review',
          reason: 'invalid_prepare_response',
        })
        continue
      }
      if (ready.status !== 'ready') {
        if (ready.status === 'requires_review') result.review++
        else if (ready.status === 'cancelled') result.cancelled++
        else result.skipped++
        result.jobs.push({ jobId: job.id, status: ready.status, reason: ready.reason ?? null })
        continue
      }
      // prepare_follow_up commits the message/dispatch marker before this one and only network call.
      let outcome: 'sent' | 'failed' | 'requires_review' | 'cancelled' = 'requires_review',
        provider: string | null = null,
        reason: string | null = 'delivery_unknown'
      let deliveryError: {
        message: string
        httpStatus: number | null
        facebookCode: number | null
        facebookSubcode: number | null
      } | null = null
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
        const permission = authorized.data as {
          status?: string
          reason?: string
          windowExpiresAt?: string | null
        } | null
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
          result.jobs.push({
            jobId: job.id,
            status: permission.status!,
            reason: permission.reason ?? null,
          })
          continue
        }
        if (permission.windowExpiresAt === undefined) throw new Error('FOLLOW_UP_PRECHECK_FAILED')
        // ISO/timestamptz offsets represent absolute instants. Never compare local
        // time strings or add seven hours for Bangkok. Exact expiry is closed.
        const expiresAt = Date.parse(permission.windowExpiresAt ?? '')
        if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
          outcome = 'cancelled'
          reason = 'outside_24h_window'
          console.info('[FOLLOW-UP WINDOW] expired before network send', {
            jobId: job.id,
            windowExpiresAt: permission.windowExpiresAt,
          })
        } else {
          const sendStarted = Date.now()
          console.info('[FOLLOW-UP SEND] request', {
            jobId: job.id,
            tenantId: job.tenant_id,
            textLength: ready.text.length,
            nowUTC: new Date(sendStarted).toISOString(),
          })
          // Both database gates verified the inbound 24-hour window. General follow-ups
          // do not establish an event registration that would justify an event-update tag.
          provider = await sendMessageWithReceipt(
            token,
            ready.psid,
            { text: ready.text },
            'RESPONSE',
          )
          console.info('[FOLLOW-UP SEND] accepted', {
            jobId: job.id,
            providerMessageId: provider,
            durationMs: Date.now() - sendStarted,
          })
          outcome = 'sent'
          reason = null
        }
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
          outcome = isWindowOrTagError(error) ? 'cancelled' : 'failed'
          reason = isWindowOrTagError(error) ? 'outside_24h_window' : 'api_rejected'
          if (outcome === 'failed' && (error.code === 2022 || error.subcode === 1404132))
            reason = 'page_restricted'
        }
        console.warn('[smart-follow-up] delivery result', {
          jobId: job.id,
          outcome,
          code: error instanceof SendApiError ? error.code : 'network_unknown',
        })
        deliveryError = {
          message:
            error instanceof SendApiError
              ? error.providerMessage || error.message
              : 'Follow-up delivery was not confirmed',
          httpStatus: error instanceof SendApiError ? error.status : null,
          facebookCode: error instanceof SendApiError ? error.code : null,
          facebookSubcode: error instanceof SendApiError ? error.subcode : null,
        }
        console.error(
          JSON.stringify({
            event: 'follow_up.send_failed',
            jobId: job.id,
            tenantId: job.tenant_id,
            outcome,
            reason,
            ...deliveryError,
            error: {
              message: deliveryError.message,
              code: deliveryError.facebookCode,
              error_subcode: deliveryError.facebookSubcode,
            },
            // A rejected RESPONSE is not evidence that an unrelated event tag is eligible.
            tagFallbackAttempted: false,
          }),
        )
      }
      // Cancellation before sending or explicit window rejection releases reserved credit/lease.
      const settled = await settleFollowUp(db, job, outcome, provider, reason)
      if (deliveryError) {
        // Keep structured diagnostics in the existing tenant-scoped audit table.
        // The client removes credentials and reflected outgoing text from Meta's message.
        const audit = await db.from('follow_up_execution_logs').insert({
          tenant_id: job.tenant_id,
          job_id: job.id,
          status: 'delivery_error',
          reason: JSON.stringify({ reason, ...deliveryError }),
        })
        if (audit.error)
          console.error('[FOLLOW-UP RESULT] error audit failed', {
            jobId: job.id,
            code: audit.error.code,
          })
      }
      if (!settled) {
        console.error('[smart-follow-up] result persistence requires review', {
          jobId: job.id,
        })
        result.errors++
        result.review++
        result.jobs.push({
          jobId: job.id,
          status: 'requires_review',
          reason: 'result_persistence_failed',
        })
        continue // recovery converts an expired dispatch to review; never resend.
      }
      if (outcome === 'sent') result.sent++
      else if (outcome === 'failed') result.failed++
      else if (outcome === 'cancelled') result.cancelled++
      else result.review++
      result.jobs.push({ jobId: job.id, status: outcome, reason })
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
