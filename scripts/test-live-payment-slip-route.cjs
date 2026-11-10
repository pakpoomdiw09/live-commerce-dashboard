const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const PAYMENT_MAX_BYTES = 5 * 1024 * 1024
const MAX_BODY_BYTES = PAYMENT_MAX_BYTES + 64 * 1024
const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const BOUNDARY = 'live-payment-test-boundary'
const CUSTOMER_TAB = {
  id: '44444444-4444-4444-8444-444444444444',
  tenant_id: TENANT_ID,
  page_id: 'test-page',
  customer_id: '55555555-5555-4555-8555-555555555555',
  remaining_amount: 25,
}

function loadTypeScript(file, mocks) {
  const filename = path.resolve(file)
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  const module = { exports: {} }
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
    return require(specifier)
  }
  const context = {
    Buffer,
    File: globalThis.File,
    FormData,
    Headers,
    ReadableStream,
    Response,
    URL,
    Uint8Array,
    console,
    crypto: require('node:crypto'),
    exports: module.exports,
    module,
    process,
    require: localRequire,
  }
  vm.runInNewContext(
    `(function (exports, require, module, __filename, __dirname) { ${outputText}\n})`,
    context,
    { filename },
  )(module.exports, localRequire, module, filename, path.dirname(filename))
  return module.exports
}

function fakeReader(chunks, state, cancelError = null) {
  let index = 0
  return {
    async read() {
      state.reads += 1
      if (index >= chunks.length) return { done: true, value: undefined }
      return { done: false, value: chunks[index++] }
    },
    async cancel() {
      state.cancels += 1
      if (cancelError) throw cancelError
    },
    releaseLock() {
      state.released = true
    },
  }
}

function multipart(fileBytes, filename = 'proof.jpg', mime = 'image/jpeg') {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`)
  return Buffer.concat([head, fileBytes, tail])
}

function split(bytes, sizes) {
  const chunks = []
  let offset = 0
  for (const size of sizes) {
    if (offset >= bytes.length) break
    chunks.push(new Uint8Array(bytes.subarray(offset, offset + size)))
    offset += size
  }
  if (offset < bytes.length) chunks.push(new Uint8Array(bytes.subarray(offset)))
  return chunks
}

function validJpeg(size = 16) {
  const bytes = Buffer.alloc(size, 0x41)
  bytes.set([0xff, 0xd8, 0xff])
  return bytes
}

function setupRoute({ customerTab = null } = {}) {
  const state = {
    uploads: 0,
    rpcCalls: 0,
    processSlipCalls: 0,
    notifyCalls: 0,
    tenantLookups: 0,
    reads: 0,
    cancels: 0,
    released: false,
  }
  const db = {
    from(table) {
      const query = {
        select() {
          return query
        },
        eq() {
          return query
        },
        async maybeSingle() {
          if (table === 'orders')
            return {
              data: { id: ORDER_ID, tenant_id: TENANT_ID, status: 'pending_payment' },
              error: null,
            }
          if (table === 'auction_payment_proofs') return { data: null, error: null }
          if (table === 'slips') return { data: null, error: null }
          throw new Error(`Unexpected maybeSingle table: ${table}`)
        },
        async single() {
          if (table === 'tenants') {
            state.tenantLookups += 1
            return {
              data: { id: TENANT_ID, account_number: '1234567890', bank_code: '001' },
              error: null,
            }
          }
          throw new Error(`Unexpected single table: ${table}`)
        },
      }
      return query
    },
    storage: {
      from() {
        return {
          async upload() {
            state.uploads += 1
            return { data: { path: 'uploaded' }, error: null }
          },
          async remove() {
            return { data: [], error: null }
          },
        }
      },
    },
    async rpc() {
      state.rpcCalls += 1
      return { data: '33333333-3333-4333-8333-333333333333', error: null }
    },
  }
  const nextServer = {
    NextResponse: {
      json(body, options = {}) {
        return new Response(JSON.stringify(body), options)
      },
    },
  }
  const validation = loadTypeScript('lib/features/payments/payment-validation.ts', {
    'server-only': {},
    '@/lib/features/banking/banks': { BANKS: [], findBank: () => undefined },
    '@/lib/features/slips/slipok': {},
  })
  const route = loadTypeScript('app/pay/live/[token]/slip/route.ts', {
    'next/server': nextServer,
    '@/lib/features/commerce/live-cf-payment-link': {
      verifyLiveCfPaymentToken: () => ({ orderId: ORDER_ID }),
    },
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/features/payments/payment-validation': validation,
    '@/lib/features/commerce/customer-tabs-server': {
      tabForOrder: async () => customerTab,
    },
    '@/lib/features/slips/process': {
      processSlip: async () => {
        state.processSlipCalls += 1
        return { status: 'valid', tabBalance: 25 }
      },
    },
    '@/lib/features/slips/notify': {
      notifyVerifiedSlipForCustomer: async () => {
        state.notifyCalls += 1
      },
    },
    '@/lib/features/commerce/live-payment-rate-limit': {
      limitLivePaymentIp: async () => 'allowed',
      limitLivePaymentOrder: async () => 'allowed',
    },
  })
  return { POST: route.POST, state }
}

function request(chunks, { contentLength, cancelError, getReaderState, contentType } = {}) {
  const state = getReaderState ?? { reads: 0, cancels: 0, released: false }
  const headers = new Headers({
    origin: 'https://local.test',
    'content-type': contentType ?? `multipart/form-data; boundary=${BOUNDARY}`,
  })
  if (contentLength !== undefined) headers.set('content-length', String(contentLength))
  return {
    headers,
    nextUrl: { origin: 'https://local.test' },
    body: {
      getReader() {
        return fakeReader(chunks, state, cancelError)
      },
    },
    readerState: state,
  }
}

async function post(req, options) {
  const { POST, state } = setupRoute(options)
  const response = await POST(req, { params: Promise.resolve({ token: 'test-token' }) })
  return { response, body: await response.json(), state }
}

test('chunked multipart without Content-Length reaches the upload path', async () => {
  const body = multipart(validJpeg())
  const req = request(split(body, [4, 9, 17]))
  const { response, body: result, state } = await post(req)
  assert.equal(response.status, 200)
  assert.deepEqual(result, { submitted: true, status: 'pending_review' })
  assert.equal(state.uploads, 1)
  assert.equal(state.rpcCalls, 1)
  assert.equal(req.readerState.released, true)
})

test('chunked multipart without Content-Length over the body limit returns 413', async () => {
  const tooLarge = Buffer.alloc(MAX_BODY_BYTES + 1, 0x41)
  const req = request(split(tooLarge, [8, 2 * 1024 * 1024]))
  const { response, state } = await post(req)
  assert.equal(response.status, 413)
  assert.equal(state.uploads, 0)
  assert.equal(state.rpcCalls, 0)
  assert.equal(req.readerState.cancels, 1)
  assert.equal(req.readerState.released, true)
})

test('body limit returns 413 even when reader.cancel rejects', async () => {
  const tooLarge = Buffer.alloc(MAX_BODY_BYTES + 1, 0x41)
  const req = request(split(tooLarge, [MAX_BODY_BYTES + 1]), {
    cancelError: new Error('cancel failed'),
  })
  const { response, state } = await post(req)
  assert.equal(response.status, 413)
  assert.equal(state.uploads, 0)
  assert.equal(state.rpcCalls, 0)
  assert.equal(req.readerState.cancels, 1)
  assert.equal(req.readerState.released, true)
})

test('declared body size over the multipart ceiling returns 413 before reading', async () => {
  const req = request([], { contentLength: MAX_BODY_BYTES + 1 })
  const { response, state } = await post(req)
  assert.equal(response.status, 413)
  assert.equal(state.uploads, 0)
  assert.equal(state.rpcCalls, 0)
  assert.equal(req.readerState.reads, 0)
})

test('malformed Content-Length and declared length mismatch return 400', async (t) => {
  await t.test('malformed header', async () => {
    const req = request([], { contentLength: '1.5' })
    const { response, state } = await post(req)
    assert.equal(response.status, 400)
    assert.equal(state.uploads, 0)
    assert.equal(state.rpcCalls, 0)
    assert.equal(req.readerState.reads, 0)
  })
  await t.test('actual body differs from declared length', async () => {
    const body = multipart(validJpeg())
    const req = request(split(body, [64]), { contentLength: body.length + 1 })
    const { response, state } = await post(req)
    assert.equal(response.status, 400)
    assert.equal(state.uploads, 0)
    assert.equal(state.rpcCalls, 0)
  })
})

test('a valid image larger than 5 MB returns 413 without upload or RPC', async () => {
  const { POST, state } = setupRoute()
  const body = multipart(validJpeg(PAYMENT_MAX_BYTES + 1))
  assert.ok(body.length <= MAX_BODY_BYTES)
  const req = request(split(body, [1024 * 1024]))
  const response = await POST(req, { params: Promise.resolve({ token: 'test-token' }) })
  assert.equal(response.status, 413)
  assert.equal(state.uploads, 0)
  assert.equal(state.rpcCalls, 0)
})

test('malformed multipart and executable bytes named as JPEG return 400 without upload or RPC', async (t) => {
  await t.test('malformed multipart', async () => {
    const { POST, state } = setupRoute()
    const body = Buffer.from('not a multipart body')
    const req = request(split(body, [body.length]))
    const response = await POST(req, { params: Promise.resolve({ token: 'test-token' }) })
    assert.equal(response.status, 400)
    assert.equal(state.uploads, 0)
    assert.equal(state.rpcCalls, 0)
  })
  await t.test('MZ executable renamed as JPEG', async () => {
    const { POST, state } = setupRoute()
    const body = multipart(Buffer.from('MZ executable payload'), 'invoice.jpg', 'image/jpeg')
    const req = request(split(body, [64]))
    const response = await POST(req, { params: Promise.resolve({ token: 'test-token' }) })
    assert.equal(response.status, 400)
    assert.equal(state.uploads, 0)
    assert.equal(state.rpcCalls, 0)
  })
})

test('customer-tab upload accepts chunked multipart without Content-Length', async () => {
  const body = multipart(validJpeg())
  const req = request(split(body, [3, 11, 19]))
  const { response, body: result, state } = await post(req, { customerTab: CUSTOMER_TAB })
  assert.equal(response.status, 200)
  assert.deepEqual(result, { submitted: true, balance: 25 })
  assert.equal(state.processSlipCalls, 1)
  assert.equal(state.notifyCalls, 1)
  assert.equal(state.tenantLookups, 1)
  assert.equal(state.uploads, 0)
  assert.equal(state.rpcCalls, 0)
  assert.equal(req.readerState.released, true)
})

test('customer-tab upload over multipart limit returns 413 without processing or uploads', async () => {
  const tooLarge = Buffer.alloc(MAX_BODY_BYTES + 1, 0x41)
  const req = request(split(tooLarge, [13, 2 * 1024 * 1024]))
  const { response, state } = await post(req, { customerTab: CUSTOMER_TAB })
  assert.equal(response.status, 413)
  assert.equal(state.processSlipCalls, 0)
  assert.equal(state.uploads, 0)
  assert.equal(state.rpcCalls, 0)
  assert.equal(req.readerState.cancels, 1)
  assert.equal(req.readerState.released, true)
})

test('customer-tab upload rejects executable bytes disguised as JPEG without processing or uploads', async () => {
  const body = multipart(Buffer.from('MZ executable payload'), 'invoice.jpg', 'image/jpeg')
  const req = request(split(body, [7, 21]))
  const { response, state } = await post(req, { customerTab: CUSTOMER_TAB })
  assert.equal(response.status, 400)
  assert.equal(state.processSlipCalls, 0)
  assert.equal(state.uploads, 0)
  assert.equal(state.rpcCalls, 0)
})
