#!/usr/bin/env node
// Safe by default: lists eligible rows only. Add --apply to call Meta and update Supabase.
const { loadEnvConfig } = require('@next/env')
const { createClient } = require('@supabase/supabase-js')

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const tenantArg = args.find((value) => value.startsWith('--tenant='))?.slice(9) || ''
const limitArg = args.find((value) => value.startsWith('--limit='))?.slice(8) || '100'
if (args.some((value) => !/^--apply$|^--tenant=[0-9a-f-]+$|^--limit=\d+$/.test(value)))
  throw new Error(
    'Usage: npm run facebook:profiles:backfill -- [--apply] [--tenant=UUID] [--limit=1..500]',
  )
if (
  tenantArg &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantArg)
)
  throw new Error('Invalid --tenant UUID')
const limit = Number(limitArg)
if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('--limit must be 1..500')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !serviceKey) throw new Error('Missing Supabase server environment variables')
const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(15_000), cache: 'no-store' }),
  },
})
const graphVersion = (process.env.FB_GRAPH_VERSION || 'v24.0').trim()
const fallback = (name) => !String(name || '').trim() || /^ลูกค้า Facebook \(/.test(name)

async function main() {
  let query = db
    .from('customers')
    .select('id,tenant_id,platform_user_id,display_name,avatar_url,last_message_at')
    .eq('platform', 'facebook')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (tenantArg) query = query.eq('tenant_id', tenantArg)
  const customers = await query
  if (customers.error) throw customers.error
  const eligible = (customers.data || []).filter(
    (customer) => fallback(customer.display_name) || !customer.avatar_url,
  )
  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      scanned: customers.data?.length || 0,
      eligible: eligible.length,
    }),
  )
  if (!apply || !eligible.length) return

  const tenantIds = [...new Set(eligible.map((customer) => customer.tenant_id).filter(Boolean))]
  const tenants = await db
    .from('tenants')
    .select('id,page_id,page_access_token')
    .in('id', tenantIds)
    .eq('is_active', true)
  if (tenants.error) throw tenants.error
  const pages = new Map((tenants.data || []).map((tenant) => [tenant.id, tenant]))
  const result = { updated: 0, unavailable: 0, missingToken: 0, failed: 0 }

  for (const customer of eligible) {
    const tenant = pages.get(customer.tenant_id)
    const token = tenant?.page_access_token?.trim()
    if (!tenant?.page_id || !token) {
      result.missingToken++
      continue
    }
    try {
      const endpoint = `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(customer.platform_user_id)}?fields=first_name,last_name,name,profile_pic`
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || data?.error) {
        result.unavailable++
        continue
      }
      const text = (value) => (typeof value === 'string' ? value.trim() : '')
      const name =
        text(data?.name) ||
        [text(data?.first_name), text(data?.last_name)].filter(Boolean).join(' ')
      let avatar = ''
      try {
        const parsed = new URL(text(data?.profile_pic))
        if (parsed.protocol === 'https:') avatar = parsed.href
      } catch {}
      const profile = {
        ...(name ? { display_name: name } : {}),
        ...(avatar ? { avatar_url: avatar } : {}),
      }
      if (!Object.keys(profile).length) {
        result.unavailable++
        continue
      }
      const saved = await db
        .from('customers')
        .update(profile)
        .eq('id', customer.id)
        .eq('tenant_id', customer.tenant_id)
        .eq('platform', 'facebook')
        .eq('platform_user_id', customer.platform_user_id)
        .select('id')
        .maybeSingle()
      if (saved.error || !saved.data) result.failed++
      else result.updated++
    } catch {
      result.failed++
    }
  }
  console.log(JSON.stringify(result))
  if (result.failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: true, code: error?.code || 'UNKNOWN' }))
  process.exitCode = 1
})
