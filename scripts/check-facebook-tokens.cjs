// Read-only diagnostics. Never prints credentials or customer data.
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
require('@next/env').loadEnvConfig(process.cwd())
const { createClient } = require('@supabase/supabase-js')
const code = ts.transpileModule(fs.readFileSync('lib/facebook.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { exports: {}, process, fetch, AbortSignal, URL, console }
vm.runInNewContext(code, context)
;(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data, error } = await db.from('tenants').select('id,page_id,page_access_token').not('page_id','is',null)
  if (error) throw new Error('Tenant lookup failed: ' + error.code)
  for (const tenant of data) {
    const token = context.exports.pageTokenFor(tenant)
    console.log(JSON.stringify({ tenantId: tenant.id, pageId: tenant.page_id,
      source: tenant.page_access_token?.trim() ? 'tenants.page_access_token' : 'environment fallback',
      status: token ? await context.exports.getPageTokenStatus(token, tenant.page_id) : 'missing',
    }))
  }
  const shared = (process.env.PAGE_ACCESS_TOKEN || '').trim()
  if (shared) {
    const appId = process.env.FB_APP_ID || process.env.NEXT_PUBLIC_FB_APP_ID
    const authorization = appId && process.env.FB_APP_SECRET ? `${appId}|${process.env.FB_APP_SECRET}` : shared
    const res = await fetch(context.exports.graph(`debug_token?input_token=${encodeURIComponent(shared)}`), {
      headers: { Authorization: `Bearer ${authorization}` }, signal: AbortSignal.timeout(10000),
    })
    const body = await res.json()
    console.log(JSON.stringify({ environment: 'PAGE_ACCESS_TOKEN', httpStatus: res.status,
      valid: body.data?.is_valid ?? null, type: body.data?.type ?? null, pageId: body.data?.profile_id ?? null,
      pagesMessaging: body.data?.scopes?.includes('pages_messaging') ?? null, errorCode: body.error?.code ?? null,
    }))
  }
  console.log(JSON.stringify({ environment: 'PAGE_ACCESS_TOKEN', present: Boolean(shared),
    expectedPageId: process.env.FB_PAGE_ID || null,
    status: shared && process.env.FB_PAGE_ID ? await context.exports.getPageTokenStatus(shared, process.env.FB_PAGE_ID) : 'not checked: token or FB_PAGE_ID missing',
  }))
})().catch(() => { console.error('Read-only token diagnostics failed; check connectivity and environment configuration'); process.exitCode = 1 })
