// Read-only diagnostics. Never prints keys, messages, customer names or slip contents.
const fs = require('node:fs')
const { createClient } = require('@supabase/supabase-js')

async function main() {
  if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw Error('Missing Supabase URL or service-role key')
  const redact = (value) =>
    String(value ?? '')
      .split(key)
      .join('[REDACTED]')
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  })
  console.log('Project:', new URL(url).hostname, '(service role; bypasses RLS)')
  let tenant = process.argv.find((arg) => arg.startsWith('--tenant='))?.slice(9)
  if (!tenant) {
    const shops = await db.from('tenants').select('id').eq('is_active', true).limit(2)
    if (shops.error) throw Error('Tenant lookup: ' + redact(shops.error.message))
    if (
      !shops.data?.length ||
      (shops.data.length !== 1 && !process.argv.includes('--first-active'))
    )
      throw Error('Specify --tenant=<UUID> or --first-active; expected exactly one active shop')
    tenant = shops.data[0].id
  }
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(tenant))
    throw Error('Invalid tenant UUID')
  const to = new Date(),
    bangkokDate = new Date(to.getTime() + 7 * 3600000).toISOString().slice(0, 10)
  const from = new Date(new Date(bangkokDate + 'T00:00:00+07:00').getTime() - 29 * 86400000)
  const previous = new Date(from.getTime() - 30 * 86400000)
  console.log('Tenant:', tenant, 'range:', from.toISOString(), '→', to.toISOString())
  let failures = 0
  async function check(query, action) {
    try {
      const result = await action()
      if (result.error) {
        failures++
        console.error(
          JSON.stringify({
            query,
            status: result.status,
            code: result.error.code,
            message: redact(result.error.message),
            details: redact(result.error.details),
            hint: redact(result.error.hint),
          }),
        )
        return
      }
      console.log(
        JSON.stringify({
          query,
          status: result.status,
          count: result.count ?? undefined,
          found:
            result.count !== null && result.count !== undefined
              ? result.count > 0
              : result.data !== null,
          allowed: typeof result.data === 'boolean' ? result.data : undefined,
          keys: result.data && !Array.isArray(result.data) ? Object.keys(result.data) : undefined,
          shape:
            query === 'overview_dashboard_stats'
              ? {
                  access: result.data?.access,
                  activityArray: Array.isArray(result.data?.activity),
                  hoursArray: Array.isArray(result.data?.hours),
                  slipsArray: Array.isArray(result.data?.slips),
                  chatsArray: Array.isArray(result.data?.chats),
                  totals: result.data?.totals,
                  messages: result.data?.messages,
                  customers: result.data?.uniqueCustomers,
                  activityDates: result.data?.activity?.slice(0, 2).map((point) => point.key),
                }
              : undefined,
        }),
      )
    } catch (error) {
      failures++
      console.error(JSON.stringify({ query, message: redact(error.message) }))
    }
  }
  await Promise.all([
    check('tenants.active', () =>
      db.from('tenants').select('id').eq('id', tenant).eq('is_active', true).maybeSingle(),
    ),
    check('tenants.credit_columns', () =>
      db
        .from('tenants')
        .select('slip_quota,slip_used,slip_quota_credits')
        .eq('id', tenant)
        .maybeSingle(),
    ),
    check('customers.count', () =>
      db.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant),
    ),
    check('slips.count', () =>
      db
        .from('slips')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant)
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString()),
    ),
    check('messages.inbound_count', () =>
      db
        .from('messages')
        .select('id,customers!inner(tenant_id)', { count: 'exact', head: true })
        .eq('customers.tenant_id', tenant)
        .eq('sender', 'customer')
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString()),
    ),
    check('agent_message_jobs.count', () =>
      db
        .from('agent_message_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant),
    ),
    check('overview_dashboard_stats', () =>
      db.rpc('overview_dashboard_stats', {
        p_tenant: tenant,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_previous: previous.toISOString(),
        p_page: 1,
        p_query: '',
      }),
    ),
    check('has_tenant_feature.customer_management', () =>
      db.rpc('has_tenant_feature', { p_tenant: tenant, p_feature: 'customer_management' }),
    ),
  ])
  console.log(
    'PGRST202/42883: missing RPC/signature/schema cache; 42501: permission/tenant gate; 42703: missing column; 57014: SQL timeout.',
  )
  console.log(
    'Zero rows alone cannot prove RLS failure. This service-role check does not test browser-session RLS.',
  )
  process.exitCode = failures ? 1 : 0
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
