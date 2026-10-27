const assert = require('node:assert/strict'),
  { test } = require('node:test'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
function load(file, deps = {}, globals = {}) {
  const ctx = {
    exports: {},
    console,
    Date,
    JSON,
    Math,
    Number,
    Object,
    Buffer,
    File,
    Blob,
    URL,
    AbortSignal,
    Uint8Array,
    crypto: require('node:crypto').webcrypto,
    process: { env: {} },
    require: (n) => {
      if (n === '@/lib/image-signature') return load('lib/image-signature.ts')
      if (n === '@/lib/single-flight') return load('lib/single-flight.ts')
      if (n in deps) return deps[n]
      if (n === '@/lib/full-access') return { temporaryFullAccess: false }
      throw Error('Unexpected dependency ' + n)
    },
    ...globals,
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    ctx,
  )
  return ctx.exports
}
const rules = load('lib/features/vision/image-rules.ts'),
  types = load('lib/features/vision/vision-types.ts', {
    '@/lib/features/vision/image-rules': rules,
  })
const tenant = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222'
const settings = {
  tenant_id: tenant,
  enabled: true,
  mode: 'rules',
  confidence_threshold: 0.8,
  handoff_enabled: true,
}
const rule = (id, priority, trigger = 'general') => ({
  id,
  tenant_id: tenant,
  name: 'Rule',
  trigger_type: trigger,
  response_text: 'Configured reply',
  media_url: null,
  is_active: true,
  priority,
})
const result = (category, confidence = 0.9, productId) => ({
  category,
  confidence,
  description: 'Observed image',
  productId,
})
test('one deterministic highest-priority active rule; ties sort by ID without mutating source', () => {
  const list = [rule('z', 10), rule('b', 20), rule('a', 20), { ...rule('x', 99), is_active: false }]
  assert.equal(rules.selectImageRule(list, 'general').id, 'a')
  assert.equal(list[0].id, 'z')
  assert.equal(rules.selectImageRule(list, 'product'), null)
  assert.ok(rules.imageRuleError({ ...rule('a', -1) }))
})
test('product, general and slip images reply from their matching configured rules', () => {
  for (const [category, trigger] of [
    ['PRODUCT', 'product'],
    ['GENERAL', 'general'],
    ['PAYMENT_SLIP', 'slip'],
  ]) {
    const reply = types.decideVisionAction(result(category), [rule('a', 1, trigger)])
    assert.equal(reply.action, 'RULE_REPLY')
    assert.equal(reply.responseText, 'Configured reply')
  }
  for (const image of [result('UNKNOWN'), result('PRODUCT', 0.79)])
    assert.equal(types.decideVisionAction(image, []).action, 'HUMAN_HANDOFF')
})
test('no matching rule hands off, including slips and catalog model IDs', () => {
  for (const category of ['PRODUCT', 'GENERAL', 'PAYMENT_SLIP']) {
    const reply = types.decideVisionAction(result(category, 0.99, 'forged'), [])
    assert.equal(reply.action, 'HUMAN_HANDOFF')
    assert.equal(reply.reason, 'NO_RULE')
  }
})

test('Vision uses the fixed 80 percent confidence floor', () => {
  assert.equal(
    types.decideVisionAction(result('GENERAL', 0.8), [rule('a', 1)]).action,
    'RULE_REPLY',
  )
  assert.equal(
    types.decideVisionAction(result('GENERAL', 0.79), [rule('a', 1)]).reason,
    'LOW_CONFIDENCE',
  )
})
test('untrusted provider output rejects invalid categories, confidence and non-JSON', () => {
  for (const value of [
    'bad',
    JSON.stringify({ category: 'paid', confidence: 1, description: 'paid' }),
    JSON.stringify({ category: 'GENERAL', confidence: 1.1, description: 'x' }),
    JSON.stringify({ category: 'GENERAL', confidence: '1', description: 'x' }),
  ])
    assert.throws(() => types.parseVisionResult(value))
  assert.equal(types.parseVisionResult(JSON.stringify(result('GENERAL'))).category, 'GENERAL')
})
const png = () =>
  new File([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'test.png', { type: 'image/png' })
test('file checks reject spoofed MIME, SVG, empty and oversized payloads', async () => {
  const image = load('lib/features/vision/vision-image.ts', { 'server-only': {} })
  assert.ok(await image.validateVisionFile(png()))
  for (const file of [
    new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }),
    new File(['not PNG'], 'x.png', { type: 'image/png' }),
    new File([], 'x.png', { type: 'image/png' }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' }),
  ])
    await assert.rejects(image.validateVisionFile(file))
})
test('webhook image downloader blocks private/arbitrary URLs and disallows CDN redirects', async () => {
  let calls = 0
  const image = load(
    'lib/features/vision/vision-image.ts',
    { 'server-only': {} },
    {
      fetch: async (url, options) => {
        calls++
        assert.equal(options.redirect, 'error')
        return new Response(png(), { headers: { 'Content-Type': 'image/png' } })
      },
    },
  )
  for (const url of [
    'http://localhost/a',
    'https://127.0.0.1/a',
    'https://fbcdn.net.evil.test/a',
    'https://user:secret@fbcdn.net/a',
    'https://fbcdn.net:8443/a',
  ])
    await assert.rejects(image.downloadVisionImage(url))
  assert.equal(calls, 0)
  assert.equal((await image.downloadVisionImage('https://scontent.fbcdn.net/a')).type, 'image/png')
  assert.equal(calls, 1)
})
test('real Gemini adapter sends image inline data and validates structured result', async () => {
  let request
  const adapter = load(
    'lib/features/vision/vision-provider.ts',
    {
      'server-only': {},
      '@google/genai': {
        GoogleGenAI: class {
          constructor() {
            this.models = {
              generateContent: async (value) => {
                request = value
                return { text: JSON.stringify(result('PRODUCT', 0.9, 'real')) }
              },
            }
          }
        },
      },
      '@/lib/features/agents/ai-agent': { aiModel: () => 'gemini-2.5-flash' },
      '@/lib/features/vision/vision-types': types,
      '@/lib/features/vision/vision-image': load('lib/features/vision/vision-image.ts', {
        'server-only': {},
      }),
    },
    { process: { env: { GEMINI_API_KEY: 'test-only-not-a-key' } } },
  )
  assert.equal(
    (await adapter.analyzeVision(png(), [{ id: 'real', name: 'Actual' }])).productId,
    'real',
  )
  assert.equal(request.contents[0].parts[1].inlineData.mimeType, 'image/png')
  assert.ok(request.contents[0].parts[1].inlineData.data)
  assert.match(request.contents[0].parts[0].text, /NEVER proof of payment/)
  assert.equal(request.config.responseMimeType, 'application/json')
})
function fixture({
  source = 'messenger',
  category = 'GENERAL',
  providerError = false,
  sendError = false,
  blocked = false,
  enabled = true,
  legacyEnabled = false,
  trigger = 'general',
  confidence = 0.95,
} = {}) {
  const job = {
    id,
    tenant_id: tenant,
    source,
    customer_id: source === 'test' ? null : 'customer',
    message_id: 'message',
    image_path: 'private/image',
    mime_type: 'image/png',
    claim_token: 'claim',
    status: 'pending',
  }
  const trace = [],
    writes = []
  let available = true,
    ai = 0,
    sends = 0,
    slips = 0,
    handoffs = 0
  const tableRows = {
    vision_settings: { ...settings, enabled, handoff_enabled: false, mode: 'catalog' },
    tenants: {
      id: tenant,
      plan: 'pro',
      auto_verify_enabled: true,
      name: 'Shop',
      page_id: 'page',
      page_access_token: 'private',
    },
    products: [{ id: 'real', code: 'A1', name: 'Actual', price: 1, stock: 2 }],
    image_response_rules: [rule('rule', 1, trigger)],
    customers: { id: 'customer', platform_user_id: 'psid' },
  }
  const db = {
    rpc: async (name, args) => {
      trace.push(name)
      if (name === 'claim_vision_job') {
        if (!available || (source === 'messenger' && !enabled)) return { data: [] }
        available = false
        job.status = 'processing'
        return { data: [{ ...job }] }
      }
      if (name === 'start_vision_analysis') return { data: !blocked }
      if (name === 'begin_vision_dispatch') return { data: true }
      if (name === 'handover_vision_job') {
        handoffs++
        Object.assign(job, { status: 'requires_review', reason: args.p_reason, claim_token: null })
        return { data: true }
      }
      return { data: true }
    },
    storage: { from: () => ({ download: async () => ({ data: png() }) }) },
    from(table) {
      let values,
        operation = 'select'
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        order() {
          return q
        },
        limit() {
          return q
        },
        update(v) {
          operation = 'update'
          values = v
          return q
        },
        single: async () => ({ data: tableRows[table] }),
        maybeSingle: async () => {
          if (table === 'vision_jobs' && operation === 'update') {
            writes.push(values)
            Object.assign(job, values)
            return { data: { id } }
          }
          return { data: Array.isArray(tableRows[table]) ? tableRows[table][0] : tableRows[table] }
        },
        then(resolve, reject) {
          return Promise.resolve({ data: tableRows[table] }).then(resolve, reject)
        },
      }
      return q
    },
  }
  const deps = {
    'server-only': {},
    '@/lib/feature-access': { hasFeature: async () => true, hasSlipAccess: async () => true },
    '@/lib/features/vision/vision-provider': {
      analyzeVision: async () => {
        ai++
        if (providerError) throw Error('timeout')
        return result(category, confidence, category === 'PRODUCT' ? 'real' : undefined)
      },
    },
    '@/lib/features/vision/vision-image': {
      validateVisionFile: async () => Buffer.from('image'),
      downloadVisionImage: async () => png(),
    },
    '@/lib/features/vision/vision-types': types,
    '@/lib/features/vision/image-rules': rules,
    '@/lib/features/slips/process': {
      processSlip: async () => {
        slips++
        return { id: 'slip', status: 'valid' }
      },
    },
    '@/lib/features/slips/notify': {
      deliverRichOnce: async () => {
        sends++
        if (sendError) throw Error('timeout')
      },
      notifySlipResult: async () => {
        sends++
      },
    },
    '@/lib/integrations/facebook/client': { pageTokenFor: () => 'private' },
    '@/lib/features/vision/vision-server': { defaultVisionSettings: () => settings },
  }
  const api = load('lib/features/vision/vision.ts', deps, {
    process: {
      env: {
        GEMINI_API_KEY: 'test-only',
        AI_VISION_AUTOMATION_ENABLED: legacyEnabled ? 'true' : 'false',
      },
    },
  })
  return { api, db, job, trace, writes, counts: () => ({ ai, sends, slips, handoffs }) }
}
test('two workers use one DB claim and one AI/send attempt', async () => {
  const f = fixture()
  await Promise.all([f.api.runVisionJob(f.db, id), f.api.runVisionJob(f.db, id)])
  assert.equal(f.counts().ai, 1)
  assert.equal(f.counts().sends, 1)
  assert.equal(f.job.status, 'completed')
  assert.ok(f.trace.indexOf('start_vision_analysis') < f.trace.indexOf('begin_vision_dispatch'))
})
test('real-image playground never verifies slips or messages customers', async () => {
  const f = fixture({ source: 'test', category: 'PAYMENT_SLIP' })
  await f.api.runVisionJob(f.db, id)
  assert.equal(f.counts().ai, 1)
  assert.equal(f.counts().sends, 0)
  assert.equal(f.counts().slips, 0)
  assert.equal(f.job.reason, 'PREVIEW_ONLY')
})
test('slip rule replies without verifying or marking an order paid', async () => {
  const f = fixture({ category: 'PAYMENT_SLIP', trigger: 'slip' })
  await f.api.runVisionJob(f.db, id)
  assert.equal(f.counts().slips, 0)
  assert.equal(f.job.reason, 'MATCHED_RULE')
  assert.equal(f.counts().sends, 1)
})
test('product image in rule mode uses only the product rule, otherwise safely hands off', async () => {
  const f = fixture({ category: 'PRODUCT' })
  await f.api.runVisionJob(f.db, id)
  assert.equal(f.job.decision.reason, 'NO_RULE')
  assert.equal(f.counts().handoffs, 1)
  assert.equal(f.counts().sends, 0)
})
test('low confidence and unknown images pause bot for human handoff without sending', async () => {
  for (const config of [{ category: 'UNKNOWN' }, { confidence: 0.4 }]) {
    const f = fixture(config)
    await f.api.runVisionJob(f.db, id)
    assert.equal(f.counts().handoffs, 1)
    assert.equal(f.counts().sends, 0)
    assert.equal(f.job.status, 'requires_review')
  }
})
test('AI failure and uncertain Messenger failure are durable review jobs, never automatically resent', async () => {
  for (const config of [{ providerError: true }, { sendError: true }]) {
    const f = fixture(config)
    await f.api.runVisionJob(f.db, id)
    await f.api.runVisionJob(f.db, id)
    assert.equal(f.counts().ai, 1)
    assert.equal(f.job.status, 'requires_review')
    assert.ok(f.counts().sends <= 1)
    assert.equal(f.counts().handoffs, 1)
  }
})
test('handoff or expiry immediately before provider start blocks AI and refunds only unstarted quota', async () => {
  const f = fixture({ blocked: true })
  await f.api.runVisionJob(f.db, id)
  assert.equal(f.counts().ai, 0)
  assert.equal(f.counts().sends, 0)
  assert.ok(f.trace.includes('refund_unstarted_vision'))
})
test('store Master Switch controls execution independently of the legacy rollout flag', async () => {
  const f = fixture({ enabled: false })
  assert.equal((await f.api.runVisionQueue(f.db)).processed, 0)
  assert.equal(f.counts().ai, 0)
  assert.equal(f.counts().sends, 0)
  const on = fixture({ enabled: true, legacyEnabled: false })
  assert.equal((await on.api.runVisionQueue(on.db)).processed, 1)
  assert.equal(on.counts().sends, 1)
  assert.equal(
    await f.api.queueMessengerVision(f.db, tenant, 'customer', 'message', [
      'https://scontent.fbcdn.net/photo.png',
    ]),
    'disabled',
  )
})
class InboxError extends Error {
  constructor(message, status = 400, code = 'INBOX_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}
const errors = {
    InboxError,
    inboxError: (e) => ({ status: e.status ?? 503, body: { code: e.code, error: e.message } }),
  },
  next = {
    NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) },
  }
test('Vision tenant guard requires user session, membership and database feature before returning service client', async () => {
  for (const [actor, access, feature, status] of [
    [null, true, true, 401],
    [{ kind: 'internal' }, true, true, 401],
    [{ kind: 'user' }, false, true, 404],
    [{ kind: 'user' }, true, false, 403],
  ]) {
    let clients = 0
    const guards = load('lib/features/vision/vision-server.ts', {
      'server-only': {},
      '@/lib/features/vision/vision-types': types,
      '@/lib/auth': { getActor: async () => actor, canAccessTenant: async () => access },
      '@/lib/feature-access': { hasFeature: async () => feature },
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/supabase/server': {
        supabaseAdmin: () => {
          clients++
          return {}
        },
      },
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
    })
    await assert.rejects(guards.visionTenant({}, tenant), (e) => e.status === status)
    if (status !== 403) assert.equal(clients, 0)
  }
})
test('all public Vision routes reject direct unauthorized calls before storage or provider work', async () => {
  const guard = {
    visionTenant: async () => {
      throw new InboxError('locked', 403, 'FEATURE_LOCKED')
    },
  }
  for (const [file, method] of [
    ['app/api/chatbot/vision/route.ts', 'GET'],
    ['app/api/chatbot/vision/route.ts', 'PATCH'],
    ['app/api/chatbot/vision/test/route.ts', 'POST'],
    ['app/api/chatbot/vision/jobs/[id]/retry/route.ts', 'POST'],
    ['app/api/chatbot/vision/jobs/[id]/image/route.ts', 'GET'],
  ]) {
    const api = load(file, {
      'next/server': next,
      '@/lib/features/vision/vision-types': types,
      '@/lib/features/vision/vision-server': guard,
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/features/vision/vision': {},
      '@/lib/features/vision/vision-image': {},
      '@/lib/utils': { UUID: /./ },
    })
    const response = await api[method](
      {
        json: async () => ({ tenantId: tenant }),
        nextUrl: { searchParams: new URLSearchParams({ tenantId: tenant }) },
      },
      { params: Promise.resolve({ id }) },
    )
    assert.equal(response.status, 403, file)
    assert.equal(response.body.code, 'FEATURE_LOCKED')
  }
})
test('Master Switch API locks rule replies, 0.8 confidence and automatic handover', async () => {
  let saved
  const api = load('app/api/chatbot/vision/route.ts', {
    'next/server': next,
    '@/lib/features/vision/vision-types': types,
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/features/vision/vision-server': {
      visionTenant: async () => ({
        actor: { id },
        tenantId: tenant,
        db: {
          rpc: async (_, args) => {
            saved = args
            return { error: null }
          },
        },
      }),
      visionOverview: async () => ({ settings }),
    },
  })
  const response = await api.PATCH({
    json: async () => ({
      ...settings,
      tenantId: tenant,
      mode: 'catalog',
      handoff_enabled: false,
      confidence_threshold: 0.99,
    }),
  })
  assert.equal(response.status, 200)
  assert.equal(saved.p_confidence, 0.8)
  assert.equal(saved.p_mode, 'rules')
  assert.equal(saved.p_handoff, true)
  const toggleOnly = await api.PATCH({ json: async () => ({ tenantId: tenant, enabled: false }) })
  assert.equal(toggleOnly.status, 200)
  assert.equal(saved.p_enabled, false)
})

test('cron requires configured bearer secret before worker access', async () => {
  let called = 0
  const api = load('app/api/cron/vision/route.ts', {
    'next/server': next,
    '@/lib/supabase/server': {
      supabaseAdmin: () => {
        called++
        return {}
      },
    },
    '@/lib/features/vision/vision': {
      runVisionQueue: async () => {
        called++
      },
    },
  })
  assert.equal((await api.POST({ headers: new Headers() })).status, 401)
  assert.equal(called, 0)
})
test('multipart playground validates a bounded real image, ignores forged plan/credits and returns preview only', async () => {
  let queued = 0,
    ran = 0
  const query = {
    select() {
      return query
    },
    eq() {
      return query
    },
    single: async () => ({ data: { id, status: 'completed', reason: 'PREVIEW_ONLY' } }),
  }
  const image = load('lib/features/vision/vision-image.ts', { 'server-only': {} })
  const api = load(
    'app/api/chatbot/vision/test/route.ts',
    {
      'next/server': next,
      '@/lib/features/vision/vision-server': {
        visionTenant: async () => ({ db: { from: () => query }, tenantId: tenant }),
      },
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/features/vision/vision-image': image,
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
      '@/lib/features/vision/vision': {
        enqueueVision: async (db, input) => {
          queued++
          assert.equal(input.source, 'test')
          assert.equal(input.tenantId, tenant)
          assert.equal(input.key, id)
          assert.equal(input.file.type, 'image/png')
          assert.equal('plan' in input, false)
          return id
        },
        runVisionJob: async () => {
          ran++
        },
      },
    },
    { Request, process: { env: { GEMINI_API_KEY: 'test-only' } } },
  )
  const form = new FormData()
  form.set('file', png())
  form.set('requestId', id)
  form.set('plan', 'pro')
  form.set('credits', '999999')
  const req = new Request('http://localhost/api/chatbot/vision/test', {
    method: 'POST',
    body: form,
  })
  req.nextUrl = { searchParams: new URLSearchParams({ tenantId: tenant }) }
  const response = await api.POST(req)
  assert.equal(response.status, 200)
  assert.equal(response.body.previewOnly, true)
  assert.equal(queued, 1)
  assert.equal(ran, 1)
})
test('multipart playground enforces body size even when Content-Length is omitted', async () => {
  let queued = 0
  const api = load(
    'app/api/chatbot/vision/test/route.ts',
    {
      'next/server': next,
      '@/lib/features/vision/vision-server': {
        visionTenant: async () => ({ db: {}, tenantId: tenant }),
      },
      '@/lib/features/inbox/inbox-server': errors,
      '@/lib/features/vision/vision-image': { VISION_MAX_BYTES: 10 },
      '@/lib/utils': { UUID: /./ },
      '@/lib/features/vision/vision': { enqueueVision: async () => queued++ },
    },
    { Request, process: { env: { GEMINI_API_KEY: 'test-only' } } },
  )
  const req = new Request('http://localhost/upload', {
    method: 'POST',
    body: new Uint8Array(65536 + 11),
  })
  req.nextUrl = { searchParams: new URLSearchParams({ tenantId: tenant }) }
  const response = await api.POST(req)
  assert.equal(response.status, 413)
  assert.equal(queued, 0)
})
