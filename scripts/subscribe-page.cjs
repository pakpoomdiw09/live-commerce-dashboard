// Subscribes the app to the Page's webhook fields. Prints Meta's JSON response; never prints the token.
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const PAGE_ID = '122099866472012045'
const FIELDS = 'feed,messages,messaging_postbacks'

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.')

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  let token
  const profile = await db
    .from('facebook_page_profiles')
    .select('page_access_token')
    .eq('page_id', PAGE_ID)
    .maybeSingle()
  if (!profile.error) token = profile.data?.page_access_token
  else if (['42P01', 'PGRST205'].includes(profile.error.code)) {
    // This project stores the Page token on the tenant row.
    const tenant = await db
      .from('tenants')
      .select('page_access_token')
      .eq('page_id', PAGE_ID)
      .maybeSingle()
    if (tenant.error) throw new Error(`Supabase lookup failed (${tenant.error.code || 'UNKNOWN'}).`)
    token = tenant.data?.page_access_token
    console.error('facebook_page_profiles not found; used tenants.page_access_token.')
  } else throw new Error(`Supabase lookup failed (${profile.error.code || 'UNKNOWN'}).`)
  if (!token) throw new Error(`No page_access_token found for page ${PAGE_ID}.`)

  const endpoint = `https://graph.facebook.com/v21.0/${PAGE_ID}/subscribed_apps?subscribed_fields=${FIELDS}&access_token=${encodeURIComponent(token)}`
  const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(15000) })
  const body = await response.json().catch(() => null)
  console.log(JSON.stringify(body, null, 2))
  if (!response.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(`Subscribe failed: ${error instanceof Error ? error.message : 'unexpected failure'}`)
  process.exitCode = 1
})
