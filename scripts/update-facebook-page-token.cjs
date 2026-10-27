// Updates one tenant with a locally configured, rotated Page token.
// Never prints credentials or sends a Messenger message.
const { loadEnvConfig } = require('@next/env')
const { createClient } = require('@supabase/supabase-js')

loadEnvConfig(process.cwd())

const tenantId = '9c3ad559-138b-446f-b9a5-2e2550f97fa4'
const expectedPageId = '122099866472012045'
const graphVersion = process.env.FB_GRAPH_VERSION || 'v24.0'

async function graphGet(path, token) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  })
  let body
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { response, body }
}

async function main() {
  if (process.env.FACEBOOK_TOKEN_ROTATED !== 'true') {
    throw new Error(
      'Safety stop: revoke the exposed token, set a replacement in .env.local, and set FACEBOOK_TOKEN_ROTATED=true.',
    )
  }

  const token = process.env.PAGE_ACCESS_TOKEN?.trim()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!token || !supabaseUrl || !serviceRoleKey)
    throw new Error('PAGE_ACCESS_TOKEN or required Supabase environment configuration is missing.')

  const me = await graphGet('me?fields=id', token)
  if (me.response.status !== 200 || me.body?.id !== expectedPageId) {
    const graphError = me.body?.error
    throw new Error(
      `Meta rejected the token or returned a different Page (HTTP ${me.response.status}, code ${graphError?.code ?? 'UNKNOWN'}, subcode ${graphError?.error_subcode ?? 'UNKNOWN'}).`,
    )
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  })
  const { data, error } = await db
    .from('tenants')
    .update({ page_access_token: token })
    .eq('id', tenantId)
    .eq('page_id', expectedPageId)
    .select('id,page_id')
    .maybeSingle()

  if (error) throw new Error(`Supabase token update failed (${error.code || 'UNKNOWN'}).`)
  if (!data) throw new Error('No tenant matched both the configured tenant ID and Facebook Page ID.')

  console.log(
    `Success: Page token updated for tenant ${data.id} (Page ${data.page_id}). The token was verified by GET /me and its value was not displayed.`,
  )
}

main().catch((error) => {
  console.error(`Facebook token update stopped: ${error instanceof Error ? error.message : 'unexpected failure'}`)
  process.exitCode = 1
})
