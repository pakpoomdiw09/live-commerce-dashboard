const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), sharp = require('sharp')
const loadSecurity = require('./helpers/load-upload-security.cjs')
const security = loadSecurity(), fields = { file: security.UPLOAD_FILE_BYTES, qr: 4096, tenantId: 128, customerId: 128, expectedAmount: 32 }
const tenant = '11111111-1111-4111-8111-111111111111'
async function encoded(form) {
  const request = new Request('https://local.test/upload', { method: 'POST', body: form })
  return { bytes: new Uint8Array(await request.arrayBuffer()), type: request.headers.get('content-type') }
}
function streamed(chunks, headers = {}, options = {}) {
  let reads = 0, cancelled = false
  const stream = new ReadableStream({
    pull(controller) { if (options.stall) return; if (reads < chunks.length) controller.enqueue(chunks[reads++]); else controller.close() },
    cancel() { cancelled = true },
  }, { highWaterMark: 0 })
  const request = new Request('https://local.test/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test', ...headers }, body: stream, duplex: 'half', ...(options.signal ? { signal: options.signal } : {}) })
  request.formData = () => { throw Error('Original unbounded formData must not run') }
  return { request, reads: () => reads, cancelled: () => cancelled }
}
const png = async () => sharp({ create: { width: 3, height: 3, channels: 3, background: '#ffaa33' } }).png().toBuffer()

test('streamed uploads without Content-Length or with a falsely small header stop at the byte cap before any multipart parsing', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    let parses = 0
    class ParserRequest extends Request { async formData() { parses++; return super.formData() } }
    const api = loadSecurity({ Request: ParserRequest })
    const f = streamed([new Uint8Array(api.UPLOAD_BODY_BYTES), new Uint8Array(1), new Uint8Array(1024)], headers)
    await assert.rejects(api.readUploadForm(f.request, fields), e => e.status === 413)
    assert.equal(f.reads(), 2)
    assert.equal(f.cancelled(), true)
    assert.equal(parses, 0)
  }
})

test('oversized and malformed lengths and compressed requests are rejected without reading a body', async () => {
  for (const [headers, status] of [[{ 'content-length': '999999999999999999999999' }, 413], [{ 'content-length': '-1' }, 400], [{ 'content-length': '1,2' }, 400], [{ 'content-encoding': 'gzip' }, 415], [{ 'content-type': 'application/json' }, 415]]) {
    const f = streamed([new Uint8Array(1)], headers)
    await assert.rejects(security.readUploadForm(f.request, fields), e => e.status === status)
    assert.equal(f.reads(), 0)
    assert.equal(f.cancelled(), true)
  }
})

test('slow streams and disconnected clients are cancelled and cannot retain an upload slot indefinitely', async () => {
  const api = loadSecurity({ setTimeout: callback => setTimeout(callback, 5) })
  const stalled = streamed([], {}, { stall: true })
  await assert.rejects(api.readUploadForm(stalled.request, fields), e => e.status === 408)
  assert.equal(stalled.cancelled(), true)
  const controller = new AbortController(), aborted = streamed([], {}, { stall: true, signal: controller.signal })
  const promise = security.readUploadForm(aborted.request, fields)
  controller.abort()
  await assert.rejects(promise, e => e.status === 400)
  assert.equal(aborted.cancelled(), true)
})

test('excessive empty chunks cannot grow pending timeout handlers or consume unbounded parser work', async () => {
  const request = streamed(Array.from({ length: 16_386 }, () => new Uint8Array(0)))
  await assert.rejects(security.readUploadForm(request.request, fields), e => e.status === 413)
  assert.equal(request.cancelled(), true)
  assert.equal(request.reads(), 16_385)
})

test('bounded multipart accepts real chunked forms, enforces individual fields, duplicates and actual file limits', async () => {
  const form = new FormData(); form.set('tenantId', tenant); form.set('file', new File([await png()], 'file.png', { type: 'image/png' }))
  const { bytes, type } = await encoded(form), chunks = []
  for (let start = 0; start < bytes.length; start += 7) chunks.push(bytes.slice(start, start + 7))
  const parsed = await security.readUploadForm(streamed(chunks, { 'content-type': type }).request, fields)
  assert.equal(parsed.get('tenantId'), tenant)
  assert.equal(parsed.get('file').type, 'image/png')
  await security.validateUploadImage(parsed.get('file'))
  for (const [name, value, status] of [['qr', 'x'.repeat(4097), 413], ['unknown', 'x', 400]]) {
    const invalid = new FormData(); invalid.set(name, value)
    const input = await encoded(invalid)
    await assert.rejects(security.readUploadForm(streamed([input.bytes], { 'content-type': input.type }).request, fields), e => e.status === status)
  }
  const duplicates = new FormData(); duplicates.append('tenantId', tenant); duplicates.append('tenantId', tenant)
  const duplicate = await encoded(duplicates)
  await assert.rejects(security.readUploadForm(streamed([duplicate.bytes], { 'content-type': duplicate.type }).request, fields), e => e.status === 400)
  const huge = new FormData(); huge.set('file', new File([new Uint8Array(security.UPLOAD_FILE_BYTES + 1)], 'x.png', { type: 'image/png' }))
  const input = await encoded(huge)
  assert.ok(input.bytes.length < security.UPLOAD_BODY_BYTES)
  await assert.rejects(security.readUploadForm(streamed([input.bytes], { 'content-type': input.type }).request, fields), e => e.status === 413)
})

test('multipart part bombs, giant headers, missing boundaries and incomplete streams never reach the native parser', async () => {
  let parses = 0
  class ParserRequest extends Request { async formData() { parses++; return super.formData() } }
  const api = loadSecurity({ Request: ParserRequest })
  for (const body of [
    '--test\r\n' + ('Content-Disposition: form-data; name="qr"\r\n\r\nx\r\n--test\r\n').repeat(10000) + '--test--',
    '--test\r\nContent-Disposition: form-data; name="qr";' + 'x'.repeat(5000) + '\r\n\r\nx\r\n--test--',
    '--test\r\nContent-Disposition: form-data; name="qr"\r\n\r\nunfinished',
    'not multipart',
    '--test\r\nContent-Disposition: form-data; name="qr"; name="file"\r\n\r\nx\r\n--test--',
  ]) await assert.rejects(api.readUploadForm(streamed([Buffer.from(body)]).request, fields), e => e.status === 400)
  assert.equal(parses, 0)
})

test('image inspection accepts decodable JPEG/PNG/WebP and rejects forged MIME, corrupt data, SVG, animation, byte and pixel bombs', async () => {
  const image = sharp({ create: { width: 3, height: 3, channels: 3, background: '#ffaa33' } })
  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await image.clone().toFormat(format).toBuffer()
    assert.ok((await security.validateUploadImage(new File([bytes], 'anything', { type: 'image/' + format }))).length)
  }
  for (const file of [new File(['<svg/>'], 'x.png', { type: 'image/png' }), new File([await png()], 'x.jpg', { type: 'image/jpeg' }), new File([new Uint8Array([255, 216, 255, 0, 0])], 'x.jpg', { type: 'image/jpeg' })]) {
    await assert.rejects(security.validateUploadImage(file), e => e.status === 415)
  }
  await assert.rejects(security.validateUploadImage(new File([], 'x.png', { type: 'image/png' })), e => e.status === 400)
  await assert.rejects(security.validateUploadImage(new File([new Uint8Array(security.UPLOAD_FILE_BYTES + 1)], 'x.png', { type: 'image/png' })), e => e.status === 413)
  const pixels = await sharp({ create: { width: 4100, height: 4100, channels: 3, background: 'white' } }).png().toBuffer()
  assert.ok(pixels.length < security.UPLOAD_FILE_BYTES)
  await assert.rejects(security.validateUploadImage(new File([pixels], 'large.png', { type: 'image/png' })), e => e.status === 413)
  const frames = await sharp(Buffer.from([...Array(4).fill([255, 0, 0]).flat(), ...Array(4).fill([0, 0, 255]).flat()]), { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer()
  assert.equal((await sharp(frames).metadata()).pages, 2)
  await assert.rejects(security.validateUploadImage(new File([frames], 'animated.webp', { type: 'image/webp' })), e => e.status === 415)
})

test('upload admission is bounded, rejects simultaneous work for one user, and releases exactly once', () => {
  const release = security.acquireUploadSlot('test-a'), release2 = security.acquireUploadSlot('test-b')
  try {
    assert.throws(() => security.acquireUploadSlot('test-a'), e => e.status === 429)
    assert.throws(() => security.acquireUploadSlot('test-c'), e => e.status === 429)
    release(); release()
    const release3 = security.acquireUploadSlot('test-c'); release3()
  } finally { release(); release2() }
})

test('admission is shared by separate route bundles in one runtime', () => {
  const globalThis = {}, first = loadSecurity({ globalThis }), second = loadSecurity({ globalThis })
  const a = first.acquireUploadSlot('a'), b = second.acquireUploadSlot('b')
  try { assert.throws(() => second.acquireUploadSlot('c'), e => e.status === 429) }
  finally { a(); b() }
})

function slipRoute({ allowed = true } = {}) {
  let calls = 0, reads = 0
  class FeatureLockedError extends Error {}
  const deps = {
    '@/lib/upload-security': security, 'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200, headers: options.headers ?? {} }) } },
    '@/lib/feature-access': { FeatureLockedError, hasSlipAccess: async () => allowed, featureLockedResponse: () => ({ status: 403 }) },
    '@/lib/auth': { getActor: async () => ({ kind: 'user', id: 'upload-user' }), canAccessTenant: async () => true, isPlatformAdmin: () => false },
    '@/lib/supabase/server': { supabaseAdmin: () => ({ from: () => ({ select() { reads++; return this }, eq() { return this }, maybeSingle: async () => ({ data: { id: tenant, tenant_id: tenant }, error: null }) }) }) },
    '@/lib/features/slips/process': { processSlip: async () => { calls++; return { id: 'slip', status: 'valid' } } }, '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
  }
  const context = { exports: {}, File, console, process: { env: { NODE_ENV: 'production' } }, require(name) { assert.ok(name in deps, name); return deps[name] } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/slips/verify/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { post: context.exports.POST, calls: () => calls, reads: () => reads }
}

test('slip route rejects streamed oversize and forged images before provider/storage, and still supports QR and valid files', async () => {
  const f = slipRoute()
  assert.equal((await f.post(streamed([new Uint8Array(security.UPLOAD_BODY_BYTES + 1)]).request)).status, 413)
  assert.equal(f.calls(), 0)
  assert.equal(f.reads(), 0)
  for (const input of [new File(['not image'], 'x.png', { type: 'image/png' }), new File([await png()], 'x.png', { type: 'image/png' }), null]) {
    const form = new FormData(); form.set('tenantId', tenant); if (input) form.set('file', input); else form.set('qr', 'test-qr')
    const result = await f.post(new Request('https://local.test/upload', { method: 'POST', body: form }))
    assert.equal(result.status, input?.size === 9 ? 415 : 200)
  }
  assert.equal(f.calls(), 2)
  const locked = slipRoute({ allowed: false }), form = new FormData(); form.set('tenantId', tenant); form.set('qr', 'qr')
  assert.equal((await locked.post(new Request('https://local.test/upload', { method: 'POST', body: form }))).status, 403)
  assert.equal(locked.calls(), 0)
})
