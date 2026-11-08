const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const load = require('./helpers/load-typescript.cjs')
const { NextResponse } = require('next/server')
const privateValues = ['PRIVATE_AUTHOR_SENTINEL', 'PRIVATE_BODY_SENTINEL', 'PRIVATE_TOKEN_SENTINEL']
function logger() {
  const lines = []
  return { lines, console: Object.fromEntries(['log','info','warn','error'].map(key => [key, (...args) => lines.push(args.map(v => v instanceof Error ? v.stack : JSON.stringify(v)).join(' '))])) }
}
function assertPrivate(log) {
  for (const value of privateValues) assert.equal(log.lines.join('\n').includes(value), false, 'private fixture data reached a console sink')
}
test('shared message profile and fallback paths log no sender identities, bodies or credentials', async () => {
  const log = logger()
  const tenant = { id: 'tenant', page_id: '100', auto_reply_enabled: false }
  const customer = { id: 'customer', tenant_id: 'tenant', platform_user_id: privateValues[0], display_name: null, bot_enabled: false }
  const db = { from(table) {
    const result = { data: table === 'tenants' ? tenant : customer, error: null }
    const query = new Proxy({}, { get(_target, name) {
      if (name === 'maybeSingle' || name === 'single') return async () => result
      if (name === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject)
      return () => query
    } })
    return query
  } }
  const dependencies = Object.fromEntries(ts.preProcessFile(fs.readFileSync('lib/integrations/facebook/webhook-handler.ts','utf8')).importedFiles.map(({fileName}) => [fileName, new Proxy({}, { get: () => () => null })]))
  Object.assign(dependencies, {
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/integrations/facebook/client': { pageTokenFor: () => privateValues[2], getCustomerProfile: async () => ({ display_name: 'safe' }) },
    '@/lib/integrations/facebook/message-window': { facebookMessageEcho: () => null, facebookInboundMessage: () => ({ senderId: privateValues[0], messageId: 'message' }) },
    '@/lib/features/broadcast/broadcast-policy': { inboundBroadcastEvidence: () => null },
  })
  const handler = load('lib/integrations/facebook/webhook-handler.ts', dependencies, { console: log.console, process: { env: {} }, Date })
  await handler.handleFacebookWebhookEvent({ event: { id: 'event', page_id: '100', kind: 'message', created_at: new Date().toISOString(), payload: { sender: { id: privateValues[0] }, message: { mid: 'message', text: privateValues[1] } } },
    assertLease: async () => {}, persistRecord: async () => ({ id: 'message', customer, duplicate: false }), once: async (_key, fn) => fn() })
  assertPrivate(log)
})

test('ingress and deferred-worker exceptions never dump provider errors or payload data', async () => {
  for (const failAtIngress of [true,false]) {
    const log = logger()
    let deferred
    const poison = new Error(privateValues.join(' '))
    const api = load('lib/integrations/facebook/webhook-http.ts', {
      'server-only': {}, 'next/server': { NextResponse, after: (fn) => { deferred = fn } },
      '@/lib/supabase/server': { supabaseAdmin: () => { if (failAtIngress) throw poison; return { rpc: async () => ({ data: { id: 'receipt', accepted: 1 }, error: null }) } } },
      '@/lib/integrations/facebook/webhook-envelope': { readWebhookBody: async () => new Uint8Array([1]), verifyWebhookSignature: () => true, parseWebhook: () => ({ raw: '{}', hash: 'hash', events: [{ pageId: '100', kind: 'message', payload: {} }] }), WebhookInputError: class extends Error {} },
      '@/lib/integrations/facebook/webhook-worker': { runFacebookWebhookWorker: async () => { throw poison } },
      '@/lib/integrations/facebook/webhook-handler': { handleFacebookWebhookEvent: async () => {} },
    }, { console: log.console, process: { env: { FB_APP_SECRET: privateValues[2] } }, URL, Date })
    const response = await api.postFacebookWebhook(new Request('https://example.test/webhook', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=fixture' }, body: '{}' }))
    assert.equal(response.status, failAtIngress ? 503 : 200)
    if (deferred) await deferred()
    assertPrivate(log)
  }
})
