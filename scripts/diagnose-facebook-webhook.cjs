// Read-only: never enqueue events, claim jobs, send messages, or print secrets/payloads.
const { loadEnvConfig } = require('@next/env')
const { createClient } = require('@supabase/supabase-js')
loadEnvConfig(process.cwd())

async function main() {
  for (const key of [
    'FB_VERIFY_TOKEN',
    'FB_APP_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CRON_SECRET',
  ]) {
    const present = Boolean(
      key === 'FB_VERIFY_TOKEN'
        ? process.env.FB_VERIFY_TOKEN?.trim() || process.env.FACEBOOK_VERIFY_TOKEN?.trim()
        : process.env[key]?.trim(),
    )
    console.log(`${key}: ${present ? 'set' : 'MISSING'}`)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    process.exitCode = 1
    return
  }
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  })
  const checks = [
    [
      'latest_receipts',
      () =>
        db
          .from('facebook_webhook_payloads')
          .select('id,received_at,last_received_at,delivery_count')
          .order('last_received_at', { ascending: false })
          .limit(5),
    ],
    [
      'latest_events',
      () =>
        db
          .from('facebook_webhook_events')
          .select('id,page_id,kind,status,attempts,last_error,created_at,available_at,lease_until')
          .order('created_at', { ascending: false })
          .limit(10),
    ],
    [
      'unfinished_events',
      () =>
        db
          .from('facebook_webhook_events')
          .select('id,page_id,status,attempts,last_error,created_at,available_at,lease_until')
          .neq('status', 'completed')
          .order('created_at', { ascending: true })
          .limit(20),
    ],
    [
      'active_pages',
      () =>
        db
          .from('tenants')
          .select('id,page_id')
          .eq('is_active', true)
          .not('page_id', 'is', null)
          .limit(100),
    ],
    [
      'latest_facebook_customers',
      () =>
        db
          .from('customers')
          .select('id,tenant_id,last_message_at')
          .eq('platform', 'facebook')
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(5),
    ],
  ]
  await Promise.allSettled(
    checks.map(async ([name, read]) => {
      try {
        const result = await read()
        if (result.error) {
          // Error messages/details may contain private data; expose codes only.
          console.log(`${name}: FAILED code=${result.error.code || 'UNKNOWN'}`)
          process.exitCode = 1
        } else console.log(`${name}: ${JSON.stringify(result.data)}`)
      } catch {
        console.log(`${name}: FAILED (network/timeout)`)
        process.exitCode = 1
      }
    }),
  )
}
main().catch(() => {
  console.error('Diagnostics failed; check configuration/network.')
  process.exitCode = 1
})
