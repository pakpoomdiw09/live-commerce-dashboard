// Read-only diagnostics for the follow-up queue and the latest Facebook inbound contact.
// This script never claims a follow-up or sends a Facebook message.
const path = require('node:path')
const { loadEnvConfig } = require('@next/env')
loadEnvConfig(path.resolve(__dirname, '..'), true, { info() {}, error() {} })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function main() {
  const [tenantId, baseArg] = process.argv.slice(2)
  if (!tenantId || !UUID.test(tenantId))
    throw new Error(
      'Usage: node scripts/test-followup-and-broadcast.cjs <tenant-uuid> [app-origin]',
    )

  const base = new URL(baseArg || process.env.CRON_BASE_URL || 'http://localhost:3000')
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !['http:', 'https:'].includes(base.protocol) ||
    (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  )
    throw new Error('Use an HTTPS origin, or localhost for development')

  const secret = (process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '').trim()
  if (!secret) throw new Error('Set CRON_SECRET or INTERNAL_API_SECRET before running diagnostics')

  const cronUrl = new URL('/api/cron/follow-ups?dryRun=1', base)
  const response = await fetch(cronUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    redirect: 'error',
    signal: AbortSignal.timeout(55000),
  })
  if (!response.ok)
    throw new Error(`Follow-up diagnostic returned HTTP ${response.status}; check server logs`)
  const queue = await response.json()
  if (queue.dryRun !== true || !Array.isArray(queue.dueJobs))
    throw new Error('Unexpected follow-up dry-run response')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!supabaseUrl || !serviceKey)
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for read-only checks',
    )
  const { createClient } = require('@supabase/supabase-js')
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const tenant = await db.from('tenants').select('page_id').eq('id', tenantId).maybeSingle()
  if (tenant.error || !tenant.data) throw new Error('Could not read the selected tenant')
  const customer = await db
    .from('customers')
    .select('id,platform_user_id,last_message_at,last_interaction_at,agent_opted_out')
    .eq('tenant_id', tenantId)
    .eq('platform', 'facebook')
    .not('last_interaction_at', 'is', null)
    .order('last_interaction_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (customer.error) throw new Error('Could not read the latest Facebook customer')

  const now = Date.now()
  let broadcastReason = 'no_recent_facebook_customer'
  let latestInteractionAt = null
  if (customer.data) {
    const latest = customer.data
    latestInteractionAt = latest.last_interaction_at
    const event = await db
      .from('broadcast_messaging_events')
      .select('kind,page_id,interacted_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', latest.id)
      .eq('page_id', tenant.data.page_id)
      .eq('kind', 'inbound_message')
      .order('interacted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (event.error) throw new Error('Could not read signed inbound-message evidence')

    const eventAt = Date.parse(event.data?.interacted_at ?? '')
    if (!latest.platform_user_id?.trim()) broadcastReason = 'missing_psid'
    else if (latest.agent_opted_out !== false)
      broadcastReason = latest.agent_opted_out ? 'opted_out' : 'consent_unknown'
    else if (!event.data) broadcastReason = 'missing_interaction'
    else if (event.data.kind !== 'inbound_message' || event.data.page_id !== tenant.data.page_id)
      broadcastReason = 'invalid_interaction'
    else if (!Number.isFinite(eventAt) || eventAt > now) broadcastReason = 'invalid_interaction'
    else if (now - eventAt >= 24 * 60 * 60 * 1000) broadcastReason = 'outside_window'
    else broadcastReason = 'within_24h_window'
  }

  console.log(
    JSON.stringify(
      {
        sendsPerformed: 0,
        followUps: {
          dryRun: true,
          dueCount: queue.dueCount,
          jobs: queue.dueJobs.map((job) => ({
            scheduledAtUTC: job.run_at,
            dueAtOrBeforeUTC: queue.nowUTC,
          })),
        },
        latestFacebookCustomer: {
          found: Boolean(customer.data),
          hasPsid: Boolean(customer.data?.platform_user_id?.trim()),
          lastMessageAt: customer.data?.last_message_at ?? null,
          lastInteractionAt: latestInteractionAt,
          broadcastWindowCheck: broadcastReason,
        },
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Diagnostics failed')
  process.exitCode = 1
})
