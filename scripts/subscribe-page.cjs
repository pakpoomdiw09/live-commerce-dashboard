// Subscribes the app to the Page's webhook fields. Prints Meta's JSON response; never prints the token.
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const FIELDS = 'feed,messages,messaging_postbacks,message_echoes,message_reads,message_deliveries'

// Minimal .env.local reader (no dotenv): KEY=VALUE lines, optional quotes, # comments.
function loadEnvLocal() {
  const file = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(file)) throw new Error('.env.local not found in the current directory.')
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match || match[2].trimStart().startsWith('#')) continue
    let value = match[2].trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '')
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}

async function main() {
  loadEnvLocal()
  const pagePosition = process.argv.indexOf('--page-id')
  const PAGE_ID = (
    pagePosition >= 0 ? process.argv[pagePosition + 1] : process.env.FB_PAGE_ID
  )?.trim()
  if (!PAGE_ID || !/^\d{1,64}$/.test(PAGE_ID)) throw new Error('Supply --page-id or FB_PAGE_ID.')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key)
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.')

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const tenant = await db
    .from('tenants')
    .select('page_access_token')
    .eq('page_id', PAGE_ID)
    .eq('is_active', true)
    .maybeSingle()
  if (tenant.error) throw new Error(`Supabase lookup failed (${tenant.error.code || 'UNKNOWN'}).`)
  const token = tenant.data?.page_access_token
  if (!token) throw new Error(`No page_access_token found for page ${PAGE_ID}.`)

  const endpoint = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v24.0'}/${PAGE_ID}/subscribed_apps`
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ subscribed_fields: FIELDS }),
  })
  const body = await response.json().catch(() => null)
  console.log(JSON.stringify(body, null, 2))
  if (!response.ok || body?.success !== true) process.exitCode = 1
}

main().catch((error) => {
  console.error(
    `Subscribe failed: ${error instanceof Error ? error.message : 'unexpected failure'}`,
  )
  process.exitCode = 1
})
