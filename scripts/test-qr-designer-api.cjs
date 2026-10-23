const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript'),
  assert = require('node:assert/strict'),
  { test } = require('node:test')
const tenant = '11111111-1111-4111-8111-111111111111',
  account = '22222222-2222-4222-8222-222222222222'
class InboxError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
function fixture({ denied = false, conflict = false } = {}) {
  const calls = [],
    row = { id: account, bank_code: 'PROMPTPAY', account_number: '0812345678', is_active: true },
    storage = {
      upload: async (path, bytes, opts) => {
        calls.push({ upload: path, bytes, opts })
        return { error: null }
      },
      remove: async (paths) => {
        calls.push({ remove: paths })
        return { error: null }
      },
    }
  const db = {
    from(table) {
      const q = {
        select() {
          return q
        },
        eq(column, value) {
          calls.push({ table, column, value })
          return q
        },
        maybeSingle: async () => ({ data: table === 'bank_accounts' ? row : null, error: null }),
      }
      return q
    },
    storage: { from: () => storage },
    rpc: async (name, args) => {
      calls.push({ name, args })
      return { error: conflict ? { code: '40001' } : null }
    },
  }
  const deps = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    '@/lib/features/payments/payment-codes-server': {
      receivingCodeTenant: async () => {
        if (denied) throw new InboxError('Denied', 403)
        return { db, tenantId: tenant, actor: { id: 'server-actor' } }
      },
      createReceivingQr: () => 'generated-payload',
      decodeReceivingQr: async () => 'decoded-payload',
    },
    '@/lib/features/payments/payment-codes-core': {
      codeMatchesAccount: () => ({ amountSatang: 12500 }),
      receivingAmount: () => null,
    },
    '@/lib/features/payments/qr-design': { validateQrDesign: JSON.parse.bind(JSON) },
    '@/lib/features/vision/vision-image': {
      validateVisionFile: async (f) => Buffer.from(await f.arrayBuffer()),
    },
    '@/lib/features/inbox/inbox-server': {
      InboxError,
      inboxError: (e) => ({ status: e.status ?? 500 }),
      checkRpc: (e) => {
        if (e) throw e
      },
    },
    '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
    sharp: {
      default: () => ({
        resize: () => ({ png: () => ({ toBuffer: async () => Buffer.from('validated') }) }),
      }),
    },
  }
  // Validator double deliberately returns an object; production validator is tested separately.
  deps['@/lib/features/payments/qr-design'].validateQrDesign = (v) => v
  const ctx = {
    exports: {},
    require: (n) => {
      if (!(n in deps)) throw Error(n)
      return deps[n]
    },
    process: { env: { QR_PAYMENT_DESIGNER_ENABLED: 'true' } },
    File,
    Request,
    Buffer,
    crypto,
    JSON,
    Number,
    String,
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync('app/api/payment-designs/route.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    ctx,
  )
  function req(origin = 'https://offline.test') {
    const form = new FormData()
    for (const [key, value] of Object.entries({
      accountId: account,
      version: '0',
      confirmed: 'true',
      design: '{}',
    }))
      form.set(key, value)
    form.set('original', new File(['qr-original-bytes'], 'test.png', { type: 'image/png' }))
    const request = new Request('https://offline.test/api/payment-designs?tenantId=' + tenant, {
      method: 'POST',
      body: form,
      headers: { origin },
    })
    return { nextUrl: new URL(request.url), headers: request.headers, body: request.body }
  }
  return { api: ctx.exports, calls, req }
}
test('designer API rejects unauthorized requests before storage, and blocks cross-origin writes', async () => {
  const f = fixture({ denied: true })
  assert.equal((await f.api.POST(f.req())).status, 403)
  assert.equal(f.calls.length, 0)
  const g = fixture()
  assert.equal((await g.api.POST(g.req('https://foreign.test'))).status, 403)
  assert.equal(g.calls.length, 0)
})
test('designer upload stores actual bytes privately, derives actor/tenant from guard, and atomically links through RPC', async () => {
  const f = fixture(),
    r = await f.api.POST(f.req())
  assert.equal(r.body.ok, true)
  assert.equal(r.body.paymentVerified, false)
  const upload = f.calls.find((c) => c.upload),
    saved = f.calls.find((c) => c.name)
  assert.equal(upload.bytes.toString(), 'qr-original-bytes')
  assert.ok(upload.upload.startsWith(`${tenant}/${account}/`))
  assert.equal(upload.opts.upsert, false)
  assert.equal(saved.args.p_original, upload.upload)
  assert.equal(saved.args.p_actor, 'server-actor')
  assert.equal(saved.args.p_tenant, tenant)
  assert.equal(saved.args.p_payload, 'decoded-payload')
  assert.equal(saved.args.p_amount, 12500)
  assert.ok(
    f.calls.filter((c) => c.table).some((c) => c.column === 'tenant_id' && c.value === tenant),
  )
})
test('designer upload compensates new storage files when account/version changes; no silent overwrite', async () => {
  const f = fixture({ conflict: true }),
    r = await f.api.POST(f.req())
  assert.equal(r.status, 409)
  assert.deepEqual(Array.from(f.calls.find((c) => c.remove).remove), [
    f.calls.find((c) => c.upload).upload,
  ])
})
test('designer upload bounds streamed bodies even without Content-Length', async () => {
  const f = fixture(),
    req = f.req()
  req.body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(11 * 1024 * 1024 + 1))
      controller.close()
    },
  })
  const result = await f.api.POST(req)
  assert.equal(result.status, 413)
  assert.equal(f.calls.length, 0)
})
