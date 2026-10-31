const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const load = require('./helpers/load-typescript.cjs')
const tenant = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const accountId = '33333333-3333-4333-8333-333333333333'
const globals = {
  Buffer,
  File,
  FormData,
  Request,
  Response,
  Headers,
  URL,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Uint8ClampedArray,
  AbortController,
  AbortSignal,
  setTimeout,
  clearTimeout,
  crypto: { randomUUID },
  console,
  process: { env: { PAYMENT_CHANNELS_ENABLED: 'true' } },
}
const core = load('lib/features/payments/payment-codes-core.ts', {}, globals)
const banks = load('lib/features/banking/banks.ts')
const accounts = load('lib/features/banking/bank-accounts.ts', {
  '@/lib/features/banking/banks': banks,
})
const qrCore = load(
  'lib/features/banking/bank-qr-upload.ts',
  { '@/lib/features/payments/payment-codes-core': core },
  globals,
)
const security = load(
  'lib/upload-security.ts',
  {
    'server-only': {},
    sharp: require('sharp'),
    '@/lib/image-signature': load('lib/image-signature.ts'),
  },
  globals,
)
const vision = load(
  'lib/features/vision/vision-image.ts',
  { 'server-only': {}, '@/lib/image-signature': load('lib/image-signature.ts') },
  globals,
)
class InboxError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const errors = {
  InboxError,
  inboxError: (e) => ({ status: e.status ?? 503, body: { error: e.message } }),
}
const payload = require('promptpay-qr')('0812345678', {})
async function qrFile(value = payload, format = 'png') {
  const svg = require('react-dom/server').renderToStaticMarkup(
    require('react').createElement(require('qrcode.react').QRCodeSVG, {
      value,
      size: 600,
      marginSize: 4,
    }),
  )
  const image = require('sharp')(Buffer.from(svg))
  const bytes = await (format === 'png' ? image.png() : image.jpeg()).toBuffer()
  return new File([bytes], `qr.${format}`, { type: format === 'png' ? 'image/png' : 'image/jpeg' })
}

function fixture({
  who = { kind: 'user', id: 'server-owner' },
  role = 'owner',
  enabled = true,
  feature = true,
  rpcError = null,
  stored = null,
  stale = false,
} = {}) {
  const calls = []
  const account = {
    id: accountId,
    bank_code: 'KBANK',
    account_name: 'ร้านทดสอบ',
    account_number: '1234567890',
    is_active: true,
    is_primary: true,
  }
  const db = {
    from(table) {
      const filters = {}
      const q = {
        select: () => q,
        eq(key, value) {
          filters[key] = value
          return q
        },
        async maybeSingle() {
          assert.equal(filters.tenant_id, tenant)
          calls.push({ read: table })
          return {
            data:
              table === 'bank_receiving_qr'
                ? stored
                : { ...account, account_number: stale ? '9999999999' : account.account_number },
            error: null,
          }
        },
      }
      return q
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'bank-receiving-qr')
        return {
          async upload(path, bytes, options) {
            calls.push({ upload: path, bytes, options })
            return { error: null }
          },
          async remove(paths) {
            calls.push({ remove: paths })
            return { error: null }
          },
          async download(path) {
            calls.push({ download: path })
            return { data: new Blob(['private image'], { type: 'image/png' }), error: null }
          },
        }
      },
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args })
      return { data: args.p_version + 1, error: rpcError }
    },
  }
  const guard = load(
    'lib/features/slips/slip-bank-server.ts',
    {
      'server-only': {},
      '@/lib/auth': {
        getActor: async () => who,
        canAccessTenant: async (_, id, need) =>
          id === tenant && role !== 'foreign' && (need !== 'owner' || role === 'owner'),
      },
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
      'promptpay-qr': require('promptpay-qr'),
    },
    globals,
  )
  const server = load(
    'lib/features/payments/payment-codes-server.ts',
    {
      'server-only': {},
      '@/lib/features/slips/slip-bank-server': guard,
      '@/lib/feature-access': { hasFeature: async () => feature },
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/features/vision/vision-image': vision,
      sharp: require('sharp'),
      jsqr: require('jsqr'),
      'promptpay-qr': require('promptpay-qr'),
      '@/lib/features/payments/payment-codes-core': core,
    },
    { ...globals, process: { env: { PAYMENT_CHANNELS_ENABLED: String(enabled) } } },
  )
  class NextResponse {
    constructor(body, options = {}) {
      this.body = body
      Object.assign(this, options)
      this.status ??= 200
    }
    static json(body, options) {
      return new NextResponse(body, options)
    }
  }
  const api = load(
    'app/api/bank-accounts/qr/route.ts',
    {
      'next/server': { NextResponse },
      '@/lib/features/payments/payment-codes-server': server,
      '@/lib/features/banking/bank-accounts': accounts,
      '@/lib/features/banking/bank-qr-upload': qrCore,
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/upload-security': security,
    },
    globals,
  )
  function request(
    file,
    { fields = {}, origin = 'https://shop.test', tenantId = tenant, asset = '' } = {},
  ) {
    const url = `https://shop.test/api/bank-accounts/qr?tenantId=${tenantId}${asset ? '&asset=' + asset : ''}`
    if (file === undefined) return { nextUrl: new URL(url), headers: new Headers({ origin }) }
    const form = new FormData()
    for (const [key, value] of Object.entries({
      bank_code: 'KBANK',
      account_name: ' ร้านทดสอบ ',
      account_number: '123-4-56789-0',
      version: String(stored?.version ?? 0),
      ...fields,
    }))
      form.set(key, value)
    if (file) form.set('file', file)
    const req = new Request(url, { method: 'POST', headers: { origin }, body: form })
    Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
    return req
  }
  return { api, request, calls, account }
}
const stored = {
  tenant_id: tenant,
  account_id: accountId,
  image_path: `${tenant}/old.png`,
  payload,
  bank_code_snapshot: 'KBANK',
  account_number_snapshot: '1234567890',
  version: 2,
}

test('PNG/JPG are decoded on the server, privately uploaded and atomically linked to the real bank account', async () => {
  for (const format of ['png', 'jpg']) {
    const f = fixture(),
      file = await qrFile(payload, format)
    const result = await f.api.POST(f.request(file))
    assert.equal(result.status, 200)
    const upload = f.calls.find((c) => c.upload),
      save = f.calls.find((c) => c.rpc)
    assert.ok(upload.upload.startsWith(tenant + '/'))
    assert.equal(upload.options.upsert, false)
    assert.equal(upload.bytes.equals(Buffer.from(await file.arrayBuffer())), true)
    assert.equal(save.rpc, 'save_bank_receiving_qr')
    assert.equal(save.args.p_actor, 'server-owner')
    assert.equal(save.args.p_tenant, tenant)
    assert.equal(save.args.p_number, '1234567890')
    assert.equal(save.args.p_payload, payload)
    assert.equal(save.args.p_path, upload.upload)
    assert.equal(save.args.p_name, 'ร้านทดสอบ')
  }
})

test('anonymous, staff, foreign shop and disabled feature calls fail before reading QR/storage', async () => {
  for (const [options, status] of [
    [{ who: null }, 401],
    [{ role: 'staff' }, 403],
    [{ role: 'foreign' }, 404],
    [{ enabled: false }, 409],
    [{ feature: false }, 403],
  ]) {
    const f = fixture(options)
    assert.equal((await f.api.GET(f.request())).status, status)
    assert.equal((await f.api.POST(f.request(null))).status, status)
    assert.equal(f.calls.length, 0)
  }
  const f = fixture()
  assert.equal((await f.api.POST(f.request(null, { origin: 'https://evil.test' }))).status, 403)
  assert.equal((await f.api.GET(f.request(undefined, { tenantId: other }))).status, 404)
  assert.equal(f.calls.length, 0)
})

test('only one current private QR is returned; stale account changes and foreign storage paths are never served', async () => {
  const f = fixture({ stored })
  const result = await f.api.GET(f.request())
  assert.equal(result.body.hasQr, true)
  assert.equal(result.body.version, 2)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  assert.equal(Object.hasOwn(result.body, 'payload'), false)
  const image = await f.api.GET(f.request(undefined, { asset: 'image' }))
  assert.equal(image.status, 200)
  assert.equal(image.headers['X-Content-Type-Options'], 'nosniff')
  for (const options of [
    { stored, stale: true },
    { stored: { ...stored, image_path: `${other}/secret.png` } },
  ]) {
    const g = fixture(options)
    assert.equal((await g.api.GET(g.request(undefined, { asset: 'image' }))).status, 404)
    assert.equal(
      g.calls.some((c) => c.download),
      false,
    )
  }
})

test('invalid bank, spoofed/blank/non-payment images and forged fields cannot change the bank or upload assets', async () => {
  const blank = await require('sharp')({
    create: { width: 200, height: 200, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer()
  const cases = [
    [null, { bank_code: 'PROMPTPAY' }],
    [null, { account_number: 'bad' }],
    [await qrFile(), { p_actor: 'forged' }],
    [new File(['<svg/>'], 'spoof.png', { type: 'image/png' }), {}],
    [new File([blank], 'blank.png', { type: 'image/png' }), {}],
    [await qrFile('https://evil.test/pay'), {}],
    [null, {}],
  ]
  for (const [file, fields] of cases) {
    const f = fixture(),
      result = await f.api.POST(f.request(file, { fields }))
    assert.ok([400, 415].includes(result.status), JSON.stringify(result))
    assert.equal(
      f.calls.some((c) => c.upload || c.rpc),
      false,
    )
  }
})

test('name-only edits reuse the image; account changes require a new QR and version conflicts never overwrite', async () => {
  const f = fixture({ stored })
  assert.equal(
    (await f.api.POST(f.request(null, { fields: { account_name: 'ชื่อใหม่' } }))).status,
    200,
  )
  assert.equal(
    f.calls.some((c) => c.upload),
    false,
  )
  assert.equal(f.calls.find((c) => c.rpc).args.p_path, stored.image_path)
  const g = fixture({ stored })
  assert.equal(
    (await g.api.POST(g.request(null, { fields: { account_number: '9999999999' } }))).status,
    400,
  )
  assert.equal(
    (await g.api.POST(g.request(await qrFile(), { fields: { version: '0' } }))).status,
    409,
  )
  assert.equal(
    g.calls.some((c) => c.upload || c.rpc),
    false,
  )
})

test('definite database refusal cleans a new upload; ambiguous timeout preserves possibly committed image', async () => {
  for (const code of ['40001', 'NETWORK_TIMEOUT']) {
    const f = fixture({ rpcError: { code } })
    const result = await f.api.POST(f.request(await qrFile()))
    assert.equal(result.status, code === '40001' ? 409 : 503)
    assert.equal(
      f.calls.some((c) => c.remove),
      code === '40001',
    )
  }
})

test('successful replacement deletes only the previous private asset', async () => {
  const f = fixture({ stored })
  assert.equal((await f.api.POST(f.request(await qrFile()))).status, 200)
  assert.deepEqual(Array.from(f.calls.find((c) => c.remove).remove), [stored.image_path])
})
