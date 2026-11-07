import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasFeature } from '@/lib/feature-access'
import { analyzeVision } from '@/lib/features/vision/vision-provider'
import { validateVisionFile, downloadVisionImage } from '@/lib/features/vision/vision-image'
import {
  type VisionJob,
  type VisionResult,
  type VisionDecision,
} from '@/lib/features/vision/vision-types'
import { CATALOG_INQUIRY, loadVisionCatalog, catalogVisionDecision } from './vision-catalog'
import { deliverRichOnce } from '@/lib/features/slips/notify'
import { pageTokenFor } from '@/lib/integrations/facebook/client'

export async function enqueueVision(
  db: SupabaseClient,
  input: {
    tenantId: string
    key: string
    file: File
    source: 'test' | 'messenger'
    customerId?: string
    messageId?: string
  },
) {
  const { tenantId, key, file, source, customerId, messageId } = input
  await validateVisionFile(file)
  if (!(await hasFeature(db, tenantId, 'image_assistant'))) throw new Error('FEATURE_LOCKED')
  const existing = await db
    .from('vision_jobs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source', source)
    .eq('idempotency_key', key)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return existing.data.id as string
  const id = crypto.randomUUID(),
    path = `${tenantId}/${id}`
  const upload = await db.storage
    .from('vision-images')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) throw upload.error
  const saved = await db
    .from('vision_jobs')
    .insert({
      id,
      tenant_id: tenantId,
      customer_id: customerId ?? null,
      message_id: messageId ?? null,
      source,
      idempotency_key: key,
      image_path: path,
      mime_type: file.type,
    })
    .select('id')
    .single()
  if (saved.error) {
    const removed = await db.storage.from('vision-images').remove([path])
    if (removed.error)
      console.error('[vision] orphan image cleanup failed', { id, code: removed.error.name })
    if (saved.error.code === '23505') {
      const duplicate = await db
        .from('vision_jobs')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('source', source)
        .eq('idempotency_key', key)
        .single()
      if (duplicate.error) throw duplicate.error
      return duplicate.data.id as string
    }
    throw saved.error
  }
  return saved.data.id as string
}

/** Called only after Meta signature verification; no training/settings opt-in required. */
export async function queueMessengerVision(
  db: SupabaseClient,
  tenantId: string,
  customerId: string,
  messageId: string,
  urls: string[],
) {
  if (!urls.length) return false
  if (!(await hasFeature(db, tenantId, 'image_assistant'))) return false
  const tenant = await db
    .from('tenants')
    .select('auto_reply_enabled')
    .eq('id', tenantId)
    .eq('is_active', true)
    .maybeSingle()
  if (tenant.error) throw tenant.error
  if (!tenant.data?.auto_reply_enabled) return 'disabled' as const
  for (const [index, url] of urls.entries())
    try {
      const file = await downloadVisionImage(url)
      const jobId = await enqueueVision(db, {
        tenantId,
        customerId,
        messageId,
        key: `${messageId}:${index}`,
        file,
        source: 'messenger',
      })
      // Process now; the durable cron worker remains recovery for interrupted requests.
      await runVisionJob(db, jobId)
    } catch (error) {
      console.error('[vision] ingestion failed', {
        tenantId,
        messageId,
        code: error instanceof Error ? error.name : 'unknown',
      })
      const audit = await db
        .from('vision_audit_logs')
        .insert({ tenant_id: tenantId, event: 'ingestion_failed', detail: messageId })
      if (audit.error)
        console.error('[vision] ingestion audit unavailable', { tenantId, code: audit.error.code })
    }
  return true
}

async function saveJob(db: SupabaseClient, job: VisionJob, values: Record<string, unknown>) {
  const saved = await db
    .from('vision_jobs')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'processing')
    .eq('claim_token', job.claim_token)
    .select('id')
    .maybeSingle()
  if (saved.error || !saved.data) throw new Error('VISION_CLAIM_CHANGED')
}

async function handoverVisionJob(db: SupabaseClient, job: VisionJob, reason: string) {
  if (job.source !== 'messenger') return false
  const routed = await db.rpc('handover_vision_job', {
    p_job: job.id,
    p_claim: job.claim_token,
    p_reason: reason,
  })
  if (routed.error) throw routed.error
  return routed.data === true
}

/** Durable analysis and one dispatch attempt; uncertain sends always need review. */
export async function runVisionJob(db: SupabaseClient, jobId?: string) {
  const claimed = await db.rpc('claim_vision_job', { p_job: jobId ?? null })
  if (claimed.error) throw claimed.error
  const job = (claimed.data as VisionJob[] | null)?.[0]
  if (!job) return null
  let phase = 'analysis'
  try {
    if (process.env.AGENT_CONTROL_KILL_SWITCH === 'true') throw new Error('AI_EMERGENCY_STOP')
    if (process.env.SNAPBOT_SAFETY_ENABLED === 'true')
      await (await import('@/lib/automation-safety')).assertAutomationRunning(db, job.tenant_id)
    const stored = await db.storage.from('vision-images').download(job.image_path)
    if (stored.error || !stored.data) throw new Error('VISION_IMAGE_UNAVAILABLE')
    const file = new File([stored.data], 'image', { type: job.mime_type })
    const tenant = await db
      .from('tenants')
      .select(
        'id,name,plan,account_number,bank_code,page_id,page_access_token,auto_verify_enabled,auto_reply_enabled',
      )
      .eq('id', job.tenant_id)
      .single()
    if (tenant.error) throw tenant.error
    // A bad/corrupt stored file must not use quota or leave an ambiguous provider marker.
    await validateVisionFile(file)
    const started = await db.rpc('start_vision_analysis', {
      p_job: job.id,
      p_claim: job.claim_token,
    })
    if (started.error || started.data !== true) throw new Error('VISION_ANALYSIS_BLOCKED')
    if (process.env.AGENT_CONTROL_KILL_SWITCH === 'true') throw new Error('AI_EMERGENCY_STOP')
    if (process.env.SNAPBOT_SAFETY_ENABLED === 'true')
      await (await import('@/lib/automation-safety')).assertAutomationRunning(db, job.tenant_id)
    let result: VisionResult = { category: 'UNKNOWN', confidence: 0, description: '' }
    let decision: VisionDecision = {
      action: 'RULE_REPLY',
      reason: 'CATALOG_UNAVAILABLE',
      responseText: CATALOG_INQUIRY,
    }
    try {
      const products = await loadVisionCatalog(db, job.tenant_id)
      result = await analyzeVision(file, products, job.tenant_id)
      decision = await catalogVisionDecision(db, job.tenant_id, result, products)
    } catch {
      // A catalog/provider outage must not pause the conversation or invent a match.
      console.warn('[vision] catalog matching unavailable', { jobId: job.id })
    }
    if (process.env.SNAPBOT_SAFETY_ENABLED === 'true')
      await (await import('@/lib/automation-safety')).assertAutomationRunning(db, job.tenant_id)
    await saveJob(db, job, { result, decision })
    if (job.source === 'test') {
      await saveJob(db, job, {
        status: 'completed',
        reason: 'PREVIEW_ONLY',
        claim_token: null,
        claim_until: null,
      })
      return job.id // Tests analyze real files, but never call SlipOK or send customer messages.
    }
    if (decision.action === 'HUMAN_HANDOFF') {
      if (!(await handoverVisionJob(db, job, decision.reason)))
        throw new Error('VISION_HANDOFF_BLOCKED')
      return job.id
    }
    // Shop automation, human ownership and the Messenger window are rechecked before sending.
    const dispatch = await db.rpc('begin_vision_dispatch', {
      p_job: job.id,
      p_claim: job.claim_token,
    })
    if (dispatch.error || dispatch.data !== true) throw new Error('VISION_DISPATCH_BLOCKED')
    phase = 'dispatch'
    const customer = await db
      .from('customers')
      .select('id,platform_user_id')
      .eq('id', job.customer_id!)
      .eq('tenant_id', job.tenant_id)
      .single()
    if (customer.error) throw customer.error
    const recipient = {
      id: customer.data.id,
      psid: customer.data.platform_user_id,
      token: pageTokenFor(tenant.data),
    }
    if (!recipient.token) throw new Error('PAGE_TOKEN_UNAVAILABLE')
    // Only images classified as slips reach SlipOK; product inquiries never spend slip credits.
    if (
      result.category === 'PAYMENT_SLIP' &&
      result.confidence >= 0.8 &&
      tenant.data.auto_verify_enabled &&
      (await hasFeature(db, job.tenant_id, 'slip_auto_pilot'))
    ) {
      const { processStandaloneSlip } = await import('@/lib/features/slips/standalone-verifier')
      const { standaloneSlipReply } = await import('@/lib/features/slips/standalone-slip')
      const slip = await processStandaloneSlip(db, {
        tenantId: job.tenant_id,
        file,
        customerId: customer.data.id,
        messageId: job.message_id!,
      })
      decision = {
        action: 'RULE_REPLY',
        reason: 'STANDALONE_SLIP',
        responseText: standaloneSlipReply(slip),
      }
    }
    const messages: object[] = []
    if (decision.responseText) messages.push({ text: decision.responseText })
    if (decision.mediaUrl)
      messages.push({
        attachment: { type: 'image', payload: { url: decision.mediaUrl, is_reusable: true } },
      })
    if (!messages.length) throw new Error('EMPTY_VISION_REPLY')
    await deliverRichOnce(
      db,
      recipient,
      `vision:${job.id}`,
      decision.responseText ?? '[รูปภาพ]',
      messages,
      'RESPONSE',
      decision.mediaUrl ? [{ type: 'image', payload: { url: decision.mediaUrl } }] : [],
    )
    await saveJob(db, job, {
      decision,
      status: 'completed',
      reason: decision.reason,
      claim_token: null,
      claim_until: null,
    })
    return job.id
  } catch (error) {
    const reason =
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : phase === 'analysis'
          ? 'AI_PROVIDER_OR_PROCESSING_FAILED'
          : 'DELIVERY_REQUIRES_REVIEW'
    console.error('[vision] job needs review', { jobId: job.id, phase, reason })
    const refund = await db.rpc('refund_unstarted_vision', {
      p_job: job.id,
      p_claim: job.claim_token,
    })
    if (refund.error)
      console.error('[vision] quota refund requires review', {
        jobId: job.id,
        code: refund.error.code,
      })
    try {
      if (await handoverVisionJob(db, job, reason)) return job.id
    } catch (handoffError) {
      console.error('[vision] Inbox handover requires review', {
        jobId: job.id,
        code: (handoffError as { code?: string })?.code ?? 'unknown',
      })
    }
    await saveJob(db, job, {
      status: 'requires_review',
      reason,
      claim_token: null,
      claim_until: null,
    })
    return job.id
  }
}

export async function runVisionQueue(db: SupabaseClient) {
  let processed = 0
  // One provider call can take 25s; leave serverless time for persistence and delivery.
  if (await runVisionJob(db)) processed++
  return { enabled: true, processed }
}
