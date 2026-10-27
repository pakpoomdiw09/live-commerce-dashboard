// Read-only Facebook diagnostics. This script never calls the Send API.
const { loadEnvConfig } = require('@next/env')
const { createClient } = require('@supabase/supabase-js')

loadEnvConfig(process.cwd())

const graphVersion = process.env.FB_GRAPH_VERSION || 'v24.0'
const pageId = (process.env.FB_PAGE_ID || '').trim()
const rotatedAcknowledgement = process.env.FB_DIAGNOSTICS_TOKEN_ROTATED === 'true'

function safeError(body, token) {
  const error = body?.error
  if (!error || typeof error !== 'object') return null
  const message = typeof error.message === 'string' ? error.message : ''
  return {
    message: message.split(token).join('[REDACTED]').slice(0, 1000) || null,
    type: typeof error.type === 'string' ? error.type : null,
    code: Number.isInteger(error.code) ? error.code : null,
    error_subcode: Number.isInteger(error.error_subcode) ? error.error_subcode : null,
    fbtrace_id: typeof error.fbtrace_id === 'string' ? error.fbtrace_id : null,
  }
}

function diagnosis(error) {
  if (!error) return 'No Graph API error reported.'
  if (error.code === 190) return 'Token is invalid, expired, or revoked.'
  if ([10, 200].includes(error.code))
    return 'Permission or Page access is missing; inspect the permission result and Page role.'
  if (/policy|restricted|disabled|integrity/i.test(error.message || ''))
    return 'The Graph API error mentions a policy, restriction, or disabled asset.'
  if (error.code === 2022)
    return 'Graph API returned code 2022; use the message, subcode and fbtrace_id with Meta support. This code alone does not prove a policy restriction.'
  return 'The error does not identify token expiry, permissions, or policy by itself.'
}

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
  return { httpStatus: response.status, body }
}

async function getPageToken() {
  const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!databaseUrl || !serviceKey)
    throw new Error('Set Supabase URL and service role key to read the current Page token.')
  if (!pageId) throw new Error('Set FB_PAGE_ID to scope the database lookup to one Page.')

  const db = createClient(databaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
  })
  const { data, error } = await db
    .from('tenants')
    .select('id,page_id,page_access_token')
    .eq('page_id', pageId)
    .limit(2)
  if (error) throw new Error(`Tenant lookup failed (${error.code || 'UNKNOWN'}).`)
  if (!data?.length) throw new Error('No tenant is configured for FB_PAGE_ID.')
  if (data.length !== 1) throw new Error('FB_PAGE_ID matches multiple tenants; scope the database data first.')

  const tenant = data[0]
  const token =
    tenant.page_access_token?.trim() ||
    (process.env.FB_PAGE_TOKEN || process.env.PAGE_ACCESS_TOKEN || '').trim()
  if (!token) throw new Error('No Page token is stored for this tenant or configured in the environment.')
  return { token, tenantId: tenant.id, actualPageId: tenant.page_id }
}

async function main() {
  console.log('Facebook Send API diagnostics (read-only; no message will be sent)')
  if (!rotatedAcknowledgement) {
    console.error(
      'STOP: token rotation is not acknowledged. Revoke the exposed token, set a replacement, then set FB_DIAGNOSTICS_TOKEN_ROTATED=true to continue.',
    )
    process.exitCode = 2
    return
  }

  const { token, tenantId, actualPageId } = await getPageToken()
  console.log(`Page configuration: found one tenant for FB_PAGE_ID; tenant=${tenantId}; page=${actualPageId}`)
  console.log(`Graph version: ${graphVersion}`)

  const me = await graphGet('me?fields=id,name', token)
  const meError = safeError(me.body, token)
  console.log(
    JSON.stringify({
      check: 'me',
      httpStatus: me.httpStatus,
      valid: me.httpStatus >= 200 && me.httpStatus < 300 && typeof me.body?.id === 'string',
      pageId: typeof me.body?.id === 'string' ? me.body.id : null,
      pageMatches: typeof me.body?.id === 'string' ? me.body.id === actualPageId : null,
      error: meError,
      diagnosis: diagnosis(meError),
    }),
  )

  const permissions = await graphGet('me/permissions', token)
  const permissionError = safeError(permissions.body, token)
  const pageMessaging = Array.isArray(permissions.body?.data)
    ? permissions.body.data.find((item) => item?.permission === 'pages_messaging')
    : null
  console.log(
    JSON.stringify({
      check: 'me/permissions',
      httpStatus: permissions.httpStatus,
      pages_messaging:
        pageMessaging && typeof pageMessaging.status === 'string' ? pageMessaging.status : 'not reported',
      error: permissionError,
      diagnosis: diagnosis(permissionError),
    }),
  )

  if (meError || permissionError) process.exitCode = 1
}

main().catch((error) => {
  console.error(`Diagnostics stopped: ${error instanceof Error ? error.message : 'unexpected failure'}`)
  process.exitCode = 1
})
