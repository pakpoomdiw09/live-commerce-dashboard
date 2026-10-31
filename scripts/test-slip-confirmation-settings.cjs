const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const load = require('./helpers/load-typescript.cjs')
const dependencies = require('./helpers/slip-confirmation-dependencies.cjs')
const template = dependencies['@/lib/features/slips/slip-confirmation-template']
const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'

test('default, empty, CRLF and repeated variables render exact plain text with literal Page names', () => {
  const expected =
    '✅ ชำระเงินสำเร็จ · เพจจริง\nทางร้านได้รับยอดชำระเงินเรียบร้อยแล้วครับ จำนวน 1.00 บาท 💸✨\nขอขอบพระคุณที่ไว้วางใจครับผม 🙏📦 ทางร้านจะรีบดำเนินการจัดส่งสินค้าให้โดยเร็วที่สุดครับ 🚚💨'
  for (const value of [null, '', ' \r\n '])
    assert.equal(template.renderSlipConfirmationTemplate(1, 'เพจจริง', value), expected)
  assert.equal(
    template.renderSlipConfirmationTemplate(
      1234.5,
      'Page $& {amount}',
      '{pageName}\r\n{amount}/{amount}',
    ),
    'Page $& {amount}\n1,234.50/1,234.50',
  )
  assert.throws(() => template.normalizeSlipConfirmationTemplate('{transRef}'), /เฉพาะ/)
  assert.throws(() => template.normalizeSlipConfirmationTemplate('x'.repeat(2001)), /2000/)
  assert.throws(
    () =>
      template.renderSlipConfirmationTemplate(
        1,
        'a long page name',
        'x'.repeat(1990) + '{pageName}',
      ),
    /TOO_LONG/,
  )
})

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

function apiFixture({ role = 'owner', who = { kind: 'user' }, dbError = null } = {}) {
  const records = new Map(),
    reads = [],
    writes = []
  let clients = 0
  const db = {
    from(table) {
      assert.equal(table, 'slip_settings')
      let scope
      const q = {
        select: () => q,
        eq(key, value) {
          assert.equal(key, 'tenant_id')
          scope = value
          return q
        },
        async maybeSingle() {
          reads.push(scope)
          return {
            data: records.has(scope) ? { slip_confirmation_template: records.get(scope) } : null,
            error: dbError,
          }
        },
        async upsert(row, options) {
          assert.equal(options.onConflict, 'tenant_id')
          if (!dbError) {
            records.set(row.tenant_id, row.slip_confirmation_template)
            writes.push(row)
          }
          return { error: dbError }
        },
      }
      return q
    },
  }
  const guard = load('lib/features/slips/slip-bank-server.ts', {
    'server-only': {},
    '@/lib/auth': {
      getActor: async () => who,
      canAccessTenant: async (_, id, need) =>
        id === tenantA && role !== 'foreign' && (need !== 'owner' || role === 'owner'),
    },
    '@/lib/supabase/server': {
      supabaseAdmin: () => {
        clients++
        return db
      },
    },
    '@/lib/features/inbox/inbox-server': errors,
    '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
    'promptpay-qr': {},
  })
  const route = load('app/api/slips/settings/route.ts', {
    ...dependencies,
    'next/server': {
      NextResponse: {
        json: (body, opts = {}) => ({ body, status: opts.status ?? 200, headers: opts.headers }),
      },
    },
    '@/lib/features/slips/slip-bank-server': guard,
    '@/lib/features/inbox/inbox-server': errors,
  })
  function req(input, tenant = tenantA, headers = {}) {
    return {
      nextUrl: new URL(`https://shop.test/api/slips/settings?tenantId=${tenant}`),
      headers: new Headers(headers),
      text: async () => JSON.stringify(input),
    }
  }
  return { route, req, records, reads, writes, clients: () => clients }
}

test('settings GET defaults and PATCH persists per tenant, reloads, and resets blank to default', async () => {
  const f = apiFixture()
  f.records.set(tenantB, 'other shop')
  const initial = await f.route.GET(f.req())
  assert.equal(initial.body.slip_confirmation_template, template.DEFAULT_SLIP_CONFIRMATION_TEMPLATE)
  assert.equal(initial.body.canManage, true)
  assert.equal(initial.headers['Cache-Control'], 'private, no-store')
  const custom = 'รับยอด {amount} บาท\r\n{pageName}'
  assert.equal((await f.route.PATCH(f.req({ slip_confirmation_template: custom }))).status, 200)
  assert.equal(
    (await f.route.GET(f.req())).body.slip_confirmation_template,
    custom.replace('\r\n', '\n'),
  )
  assert.equal(f.records.get(tenantB), 'other shop')
  assert.equal(f.writes[0].tenant_id, tenantA)
  assert.ok(f.writes[0].updated_at)
  assert.equal(
    (await f.route.PATCH(f.req({ slip_confirmation_template: '' }))).body
      .slip_confirmation_template,
    template.DEFAULT_SLIP_CONFIRMATION_TEMPLATE,
  )
  assert.equal(f.records.get(tenantA), null)
})

test('settings requires membership for reads and owner for writes before database access', async () => {
  for (const [options, method, status] of [
    [{ who: null }, 'GET', 401],
    [{ who: { kind: 'internal' } }, 'PATCH', 401],
    [{ role: 'foreign' }, 'GET', 404],
    [{ role: 'staff' }, 'PATCH', 403],
  ]) {
    const f = apiFixture(options)
    assert.equal(
      (await f.route[method](f.req({ slip_confirmation_template: 'forged' }))).status,
      status,
    )
    assert.equal(f.clients(), 0)
  }
  const f = apiFixture({ role: 'staff' })
  assert.equal((await f.route.GET(f.req())).body.canManage, false)
  assert.equal((await f.route.GET(f.req(null, tenantB))).status, 404)
})

test('settings rejects invalid input, forged tenant/fields, cross-site requests and malformed JSON', async () => {
  const f = apiFixture()
  for (const input of [
    null,
    [],
    {},
    { slip_confirmation_template: 123 },
    { slip_confirmation_template: '{transRef}' },
    { slip_confirmation_template: 'x'.repeat(2001) },
    { slip_confirmation_template: 'text', tenant_id: tenantB },
    { slip_confirmation_template: 'text', auto_reply_enabled: true },
  ])
    assert.equal((await f.route.PATCH(f.req(input))).status, 400)
  assert.equal(
    (
      await f.route.PATCH(
        f.req({ slip_confirmation_template: 'text' }, tenantA, { origin: 'https://evil.test' }),
      )
    ).status,
    403,
  )
  const bad = f.req()
  bad.text = async () => '{'
  assert.equal((await f.route.PATCH(bad)).status, 400)
  assert.equal(f.writes.length, 0)
})

test('missing migration produces an actionable error without reporting a successful save', async () => {
  const f = apiFixture({ dbError: { code: 'PGRST205' } })
  assert.equal((await f.route.GET(f.req())).status, 503)
  const saved = await f.route.PATCH(f.req({ slip_confirmation_template: 'new' }))
  assert.equal(saved.status, 503)
  assert.match(saved.body.error, /slip-confirmation-template.sql/)
  assert.equal(f.writes.length, 0)
})

test('SQL is rerunnable, preserves templates, enforces length and tenant RLS, and denies browser writes', async () => {
  const { PGlite } = require('@electric-sql/pglite')
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public.tenants(id uuid primary key);
      insert into public.tenants values('${tenantA}'),('${tenantB}');
      create function public.can_access_tenant(id uuid) returns boolean language sql stable as
        $$ select id::text = current_setting('test.tenant', true) $$;
    `)
    const sql = readFileSync('supabase/slip-confirmation-template.sql', 'utf8')
    await db.exec(sql)
    await db.exec(
      `insert into public.slip_settings(tenant_id,slip_confirmation_template) values('${tenantA}','A {amount}'),('${tenantB}','B {amount}')`,
    )
    await db.exec(sql)
    assert.equal(
      (await db.query('select count(*)::int as n from public.slip_settings')).rows[0].n,
      2,
    )
    await assert.rejects(
      db.query('update public.slip_settings set slip_confirmation_template=$1 where tenant_id=$2', [
        'x'.repeat(2001),
        tenantA,
      ]),
    )
    await db.exec(`set role authenticated; set test.tenant='${tenantA}';`)
    assert.deepEqual(
      (await db.query('select slip_confirmation_template from public.slip_settings')).rows,
      [{ slip_confirmation_template: 'A {amount}' }],
    )
    await assert.rejects(
      db.exec(`update public.slip_settings set slip_confirmation_template='hacked'`),
      /permission denied/,
    )
    await db.exec('reset role; set role anon;')
    await assert.rejects(db.exec('select * from public.slip_settings'), /permission denied/)
  } finally {
    await db.close()
  }
})

function uiFixture({ readFails = false, canManage = true, saveFails = false } = {}) {
  const state = [],
    refs = [],
    effects = [],
    requests = []
  let cursor = 0,
    refCursor = 0,
    effectMounted = false,
    resolveRead
  const read = new Promise((resolve) => {
    resolveRead = resolve
  })
  const jsx = (type, props) => ({ type, props })
  const context = {
    exports: {},
    AbortController,
    encodeURIComponent,
    fetch: async (url, opts = {}) => {
      requests.push({ url, ...opts })
      if (!opts.method) {
        await read
        return {
          ok: !readFails,
          json: async () =>
            readFails
              ? { error: 'load failed' }
              : { slip_confirmation_template: 'stored {amount}', canManage },
        }
      }
      return {
        ok: !saveFails,
        json: async () => (saveFails ? { error: 'save failed' } : JSON.parse(opts.body)),
      }
    },
    require(name) {
      if (name === 'react')
        return {
          useId: () => 'template-id',
          useState(value) {
            const index = cursor++
            if (!(index in state)) state[index] = value
            return [
              state[index],
              (next) => {
                state[index] = typeof next === 'function' ? next(state[index]) : next
              },
            ]
          },
          useRef(value) {
            const index = refCursor++
            return (refs[index] ??= { current: value })
          },
          useEffect(fn) {
            if (!effectMounted) effects.push(fn)
          },
        }
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name in dependencies) return dependencies[name]
      if (name.endsWith('/button')) return { Button: 'button' }
      if (name.endsWith('/feedback')) return { ErrorMessage: 'error', SuccessToast: 'success' }
      throw Error('Unexpected dependency ' + name)
    },
  }
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync('components/slips/SlipConfirmationTemplateSettings.tsx', 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    context,
  )
  function render() {
    cursor = 0
    refCursor = 0
    return context.exports.SlipConfirmationTemplateSettings({ tenantId: tenantA })
  }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    for (const child of [node.props?.children].flat(Infinity)) {
      const match = find(child, predicate)
      if (match) return match
    }
    return null
  }
  return {
    render,
    find,
    requests,
    start: () => {
      render()
      effects.forEach((fn) => fn())
      effectMounted = true
    },
    ready: async () => {
      resolveRead()
      await new Promise((r) => setImmediate(r))
    },
  }
}

test('UI loads stored template before editing, saves only template, and prevents repeated clicks', async () => {
  const f = uiFixture()
  f.start()
  assert.equal(f.find(f.render(), (n) => n.type === 'textarea').props.disabled, true)
  await f.ready()
  const input = f.find(f.render(), (n) => n.type === 'textarea')
  assert.equal(input.props.value, 'stored {amount}')
  input.props.onChange({ target: { value: 'new {pageName} {amount}' } })
  const save = f.find(
    f.render(),
    (n) => n.type === 'button' && n.props.children === 'บันทึกข้อความ',
  )
  save.props.onClick()
  save.props.onClick()
  await new Promise((r) => setImmediate(r))
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[1].url, `/api/slips/settings?tenantId=${tenantA}`)
  assert.deepEqual(JSON.parse(f.requests[1].body), {
    slip_confirmation_template: 'new {pageName} {amount}',
  })
  assert.ok(f.find(f.render(), (n) => n.type === 'success'))
})

test('UI blocks overwriting after load failure and read-only staff access; save failure shows no success', async () => {
  for (const options of [{ readFails: true }, { canManage: false }]) {
    const f = uiFixture(options)
    f.start()
    await f.ready()
    assert.equal(f.find(f.render(), (n) => n.type === 'textarea').props.disabled, true)
    const save = f.find(
      f.render(),
      (n) => n.type === 'button' && n.props.children === 'บันทึกข้อความ',
    )
    save.props.onClick()
    await new Promise((r) => setImmediate(r))
    assert.equal(f.requests.length, 1)
  }
  const f = uiFixture({ saveFails: true })
  f.start()
  await f.ready()
  f.find(
    f.render(),
    (n) => n.type === 'button' && n.props.children === 'บันทึกข้อความ',
  ).props.onClick()
  await new Promise((r) => setImmediate(r))
  assert.ok(f.find(f.render(), (n) => n.type === 'error'))
  assert.equal(
    f.find(f.render(), (n) => n.type === 'success'),
    null,
  )
})
