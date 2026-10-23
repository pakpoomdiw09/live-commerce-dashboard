import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasFeature, hasSlipAccess } from '@/lib/feature-access'
import { analyzeVision } from '@/lib/features/vision/vision-provider'
import { validateVisionFile, downloadVisionImage } from '@/lib/features/vision/vision-image'
import {
  decideVisionAction,
  type VisionJob,
  type VisionProduct,
  type VisionSettings,
} from '@/lib/features/vision/vision-types'
import { IMAGE_RULE_COLUMNS, type ImageResponseRule } from '@/lib/features/vision/image-rules'
import { processSlip } from '@/lib/features/slips/process'
import { deliverRichOnce, notifySlipResult } from '@/lib/features/slips/notify'
import { pageTokenFor } from '@/lib/integrations/facebook/client'
import { defaultVisionSettings } from '@/lib/features/vision/vision-server'

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

/** Called only after Meta signature verification. A disabled center leaves the legacy slip flow intact. */
export async function queueMessengerVision(
  db: SupabaseClient,
  tenantId: string,
  customerId: string,
  messageId: string,
  urls: string[],
) {
  if (process.env.AI_VISION_AUTOMATION_ENABLED !== 'true' || !urls.length) return false
  if (!(await hasFeature(db, tenantId, 'image_assistant'))) return false
  const settings = await db
    .from('vision_settings')
    .select('enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (settings.error || !settings.data?.enabled) return false
  // Once the center opts in, never route an unclassified image to the slip verifier as a fallback.
  for (const [index, url] of urls.entries())
    try {
      const file = await downloadVisionImage(url)
      await enqueueVision(db, {
        tenantId,
        customerId,
        messageId,
        key: `${messageId}:${index}`,
        file,
        source: 'messenger',
      })
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

/** One claim = at most one AI request and one dispatch attempt. Uncertain work always needs review. */
export async function runVisionJob(db: SupabaseClient, jobId?: string) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('VISION_PROVIDER_NOT_CONFIGURED')
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
    const settingsRow = await db
      .from('vision_settings')
      .select('*')
      .eq('tenant_id', job.tenant_id)
      .maybeSingle()
    if (settingsRow.error) throw settingsRow.error
    const settings = (settingsRow.data ?? defaultVisionSettings(job.tenant_id)) as VisionSettings
    const tenant = await db
      .from('tenants')
      .select(
        'id,name,plan,account_number,bank_code,page_id,page_access_token,auto_verify_enabled,auto_reply_enabled',
      )
      .eq('id', job.tenant_id)
      .single()
    if (tenant.error) throw tenant.error
    const limit = await db
      .from('vision_plan_limits')
      .select('product_search')
      .eq('plan', tenant.data.plan)
      .single()
    if (limit.error) throw limit.error
    const productSearch =
      limit.data.product_search === true && (await hasFeature(db, job.tenant_id, 'ai_agent'))
    const products = productSearch
      ? await db
          .from('products')
          .select('id,code,name,price,stock,description')
          .eq('tenant_id', job.tenant_id)
          .eq('is_active', true)
          .order('id')
          .limit(100)
      : { data: [], error: null }
    if (products.error) throw products.error
    const catalog = (products.data ?? []) as VisionProduct[]
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
    const result = await analyzeVision(file, catalog)
    if (process.env.SNAPBOT_SAFETY_ENABLED === 'true')
      await (await import('@/lib/automation-safety')).assertAutomationRunning(db, job.tenant_id)
    const rules = await db
      .from('image_response_rules')
      .select(IMAGE_RULE_COLUMNS)
      .eq('tenant_id', job.tenant_id)
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('id')
      .limit(1000)
    if (rules.error) throw rules.error
    let currentCatalog = catalog
    if (
      result.category === 'PRODUCT' &&
      result.productId &&
      productSearch &&
      catalog.some((p) => p.id === result.productId)
    ) {
      // Prices/stock may have changed while Gemini was running. Use a fresh tenant-scoped row.
      const current = await db
        .from('products')
        .select('id,code,name,price,stock,description')
        .eq('tenant_id', job.tenant_id)
        .eq('id', result.productId)
        .eq('is_active', true)
        .maybeSingle()
      if (current.error) throw current.error
      currentCatalog = current.data ? [current.data as VisionProduct] : []
    }
    const decision = decideVisionAction(
      result,
      settings,
      (rules.data ?? []) as ImageResponseRule[],
      currentCatalog,
      productSearch,
    )
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
    // DB rechecks plan/settings, customer assignment and 24h window immediately before effects.
    if (process.env.AI_VISION_AUTOMATION_ENABLED !== 'true') throw new Error('AUTOMATION_DISABLED')
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
    if (decision.action === 'HUMAN_HANDOFF') {
      if (settings.handoff_enabled) {
        const handoff = await db.rpc('start_inbox_handover', { p_customer: job.customer_id })
        if (handoff.error) throw handoff.error
        if (handoff.data) {
          const release = await db.rpc('end_inbox_delivery', {
            p_customer: job.customer_id,
            p_lease: handoff.data,
          })
          if (release.error) throw release.error
        }
      }
      await saveJob(db, job, {
        status: 'requires_review',
        reason: decision.reason,
        claim_token: null,
        claim_until: null,
      })
    } else if (decision.action === 'VERIFY_SLIP') {
      if (!tenant.data.auto_verify_enabled || !(await hasSlipAccess(db, job.tenant_id)))
        throw new Error('SLIP_ACCESS_OR_CREDITS_REQUIRED')
      const slip = await processSlip(db, {
        file,
        customerId: job.customer_id,
        messageId: job.message_id,
        tenant: tenant.data,
      })
      if (slip.failure || slip.crashed) throw new Error('SLIP_PROVIDER_FAILED')
      await saveJob(db, job, { reason: `SLIP_${slip.status.toUpperCase()}` })
      if (recipient.token) await notifySlipResult(db, slip, recipient, tenant.data.name)
      await saveJob(db, job, {
        status: slip.status === 'valid' ? 'completed' : 'requires_review',
        claim_token: null,
        claim_until: null,
      })
    } else {
      if (!recipient.token) throw new Error('PAGE_TOKEN_UNAVAILABLE')
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
        status: 'completed',
        reason: decision.reason,
        claim_token: null,
        claim_until: null,
      })
    }
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
  if (process.env.AI_VISION_AUTOMATION_ENABLED !== 'true') return { enabled: false, processed: 0 }
  let processed = 0
  // One provider call can take 25s; leave serverless time for persistence and delivery.
  if (await runVisionJob(db)) processed++
  return { enabled: true, processed }
}
