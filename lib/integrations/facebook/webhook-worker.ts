import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WebhookObject } from '@/lib/integrations/facebook/webhook-envelope'

export type QueuedFacebookEvent = {
  id: string
  page_id: string
  kind: 'message' | 'change'
  payload: WebhookObject
  claim_token: string
  attempts: number
  created_at: string
}
export class WebhookLeaseLost extends Error {
  constructor() {
    super('WEBHOOK_LEASE_LOST')
  }
}
export class WebhookNeedsReview extends Error {
  constructor() {
    super('WEBHOOK_SIDE_EFFECT_UNCONFIRMED')
  }
}
export type WebhookExecution = {
  event: QueuedFacebookEvent
  assertLease: () => Promise<void>
  once: <T>(name: string, work: () => Promise<T>) => Promise<T>
  persistRecord: (tenantId: string | null) => Promise<{
    id: string | null
    duplicate: boolean
    ignored?: boolean
    reason?: string
    customer: { id: string; display_name: string | null; bot_enabled: boolean } | null
  }>
}

/** Codes only: provider errors can contain tokens, customer messages or bank details. */
function failureCode(error: unknown): string {
  if (error instanceof WebhookNeedsReview) return error.message
  if (error instanceof WebhookLeaseLost) return error.message
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[a-z0-9_]{1,80}$/i.test(code)
    ? code
    : 'WEBHOOK_HANDLER_FAILED'
}

export async function runFacebookWebhookWorker(
  db: SupabaseClient,
  handler: (execution: WebhookExecution) => Promise<void>,
  options: { deadline?: number; maxEvents?: number } = {},
) {
  const deadline = options.deadline ?? Date.now() + 240_000
  const maxEvents = Math.min(100, Math.max(1, options.maxEvents ?? 20))
  const summary = {
    claimed: 0,
    completed: 0,
    retried: 0,
    dead: 0,
    review: 0,
    leaseLost: 0,
    sideEffectFailed: 0,
  }
  while (Date.now() < deadline && summary.claimed < maxEvents) {
    const claimed = await db.rpc('claim_facebook_webhook', { p_lease_seconds: 120 })
    if (claimed.error) throw claimed.error
    const event = (claimed.data as QueuedFacebookEvent[] | null)?.[0]
    if (!event) break
    summary.claimed++
    console.log('[facebook-webhook/worker] claimed', {
      eventId: event.id,
      pageId: event.page_id,
      kind: event.kind,
      attempt: event.attempts,
    })
    let lost = false,
      heartbeating = false,
      messagePersisted = false
    const assertLease = async () => {
      if (lost) throw new WebhookLeaseLost()
      const beat = await db.rpc('heartbeat_facebook_webhook', {
        p_event: event.id,
        p_claim: event.claim_token,
      })
      if (beat.error || beat.data !== true) {
        lost = true
        throw new WebhookLeaseLost()
      }
    }
    const timer = setInterval(() => {
      if (heartbeating) return
      heartbeating = true
      void assertLease()
        .catch(() => {
          lost = true
        })
        .finally(() => {
          heartbeating = false
        })
    }, 20_000)
    const execution: WebhookExecution = {
      event,
      assertLease,
      async persistRecord(tenantId) {
        await assertLease()
        console.log('[facebook-webhook/worker] persisting record', {
          eventId: event.id,
          pageId: event.page_id,
          tenantId,
        })
        const saved = await db.rpc('persist_facebook_webhook_record', {
          p_event: event.id,
          p_claim: event.claim_token,
          p_tenant: tenantId,
        })
        if (saved.error) {
          console.error('[facebook-webhook/worker] record persistence failed', {
            eventId: event.id,
            pageId: event.page_id,
            tenantId,
            code: failureCode(saved.error),
          })
          throw saved.error
        }
        if (!saved.data || typeof saved.data.duplicate !== 'boolean')
          throw new Error('INVALID_PERSIST_RESULT')
        if (event.kind === 'message' && saved.data.id && !saved.data.ignored)
          messagePersisted = true
        console.log('[facebook-webhook/worker] record persisted', {
          eventId: event.id,
          pageId: event.page_id,
          tenantId,
          recordId: saved.data.id,
          duplicate: saved.data.duplicate,
          ignored: saved.data.ignored ?? false,
          reason: saved.data.reason,
        })
        return saved.data
      },
      async once<T>(name: string, work: () => Promise<T>): Promise<T> {
        await assertLease()
        const start = await db.rpc('begin_facebook_webhook_step', {
          p_event: event.id,
          p_claim: event.claim_token,
          p_name: name,
        })
        // A lost RPC response may mean the write committed. Never dispatch on an uncertain claim.
        if (start.error) throw start.error
        if (start.data?.status === 'completed') return start.data.result as T
        if (start.data?.status !== 'new') throw new WebhookNeedsReview()
        try {
          await assertLease()
          const result = await work()
          const saved = await db.rpc('complete_facebook_webhook_step', {
            p_event: event.id,
            p_claim: event.claim_token,
            p_name: name,
            p_result: result ?? null,
          })
          if (saved.error || saved.data !== true) throw new WebhookNeedsReview()
          return result
        } catch (error) {
          console.warn('[facebook-webhook/worker] side effect unconfirmed', {
            eventId: event.id,
            step: name,
            code: failureCode(error),
          })
          throw new WebhookNeedsReview()
        }
      },
    }
    try {
      await handler(execution)
      await assertLease()
      const finished = await db.rpc('finish_facebook_webhook', {
        p_event: event.id,
        p_claim: event.claim_token,
        p_outcome: 'completed',
      })
      if (finished.error || finished.data !== 'completed') throw new WebhookLeaseLost()
      summary.completed++
    } catch (error) {
      if (lost || error instanceof WebhookLeaseLost) {
        summary.leaseLost++
        continue
      }
      const review = error instanceof WebhookNeedsReview
      // Inbox delivery has succeeded. Preserve unfinished side-effect checkpoints
      // and the error for review, but never replay a potentially dispatched send.
      const finished = await db.rpc('finish_facebook_webhook', {
        p_event: event.id,
        p_claim: event.claim_token,
        p_outcome: messagePersisted ? 'completed' : review ? 'requires_review' : 'retry',
        p_error: failureCode(error),
      })
      if (finished.error || !finished.data) {
        summary.leaseLost++
        continue
      }
      if (finished.data === 'completed') {
        summary.completed++
        summary.sideEffectFailed++
      } else if (finished.data === 'requires_review') summary.review++
      else if (finished.data === 'dead') summary.dead++
      else summary.retried++
      console.warn('[facebook-webhook/worker]', {
        eventId: event.id,
        attempt: event.attempts,
        outcome: finished.data,
        code: failureCode(error),
      })
    } finally {
      clearInterval(timer)
    }
  }
  return summary
}
