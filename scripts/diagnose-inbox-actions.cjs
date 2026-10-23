// Read-only: never invokes claim/transfer RPCs or sends Facebook messages.
const fs = require('node:fs')
const { createClient } = require('@supabase/supabase-js')
async function main() {
  if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw Error('Missing Supabase URL/service key')
  const safe = (value) =>
    String(value ?? '')
      .split(key)
      .join('[REDACTED]')
  const boundedFetch = (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(10000) })
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: boundedFetch },
  })
  console.log(
    'Project:',
    new URL(url).hostname,
    'local Pro flag:',
    process.env.SMART_INBOX_PRO_ENABLED === 'true',
  )
  for (const [name, columns] of [
    [
      'action columns',
      'id,tenant_id,assigned_user_id,bot_enabled,conversation_status,conversation_version,inbound_seq,handover_at,outbound_lock_until',
    ],
    ['optional customer profile', 'avatar_url,phone,address,tags,notes,order_status'],
    ['Pro columns', 'inbox_stage,closed_at,close_reason'],
  ]) {
    const result = await db.from('customers').select(columns).limit(1)
    console.log(
      JSON.stringify({
        query: name,
        status: result.status,
        code: result.error?.code,
        message: result.error ? safe(result.error.message) : undefined,
        details: result.error ? safe(result.error.details) : undefined,
      }),
    )
  }
  const response = await boundedFetch(url + '/rest/v1/', {
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/openapi+json',
    },
  })
  if (!response.ok) {
    console.log(
      'OpenAPI metadata unavailable:',
      response.status,
      '; run supabase/inbox-actions-check.sql',
    )
    return
  }
  const schema = await response.json()
  for (const name of ['manage_inbox_conversation', 'manage_inbox_pro']) {
    const route = schema.paths?.['/rpc/' + name]
    console.log(
      JSON.stringify({
        rpc: name,
        exposedToServiceRole: !!route,
        parameters: route?.post?.parameters?.map((p) =>
          p.schema?.properties ? Object.keys(p.schema.properties) : p.name,
        ),
      }),
    )
  }
  console.log(
    'This checks local environment/schema only. For production grants/triggers run supabase/inbox-actions-check.sql. No state was changed.',
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
