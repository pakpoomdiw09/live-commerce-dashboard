const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { test } = require('node:test'),
  { PGlite } = require('@electric-sql/pglite')

const vm = require('node:vm'),
  ts = require('typescript')
function load(file, deps = {}, env = {}) {
  const c = {
    exports: {},
    Date,
    process: { env },
    require: (n) => {
      if (n === '@/lib/feature-flags') return load('lib/feature-flags.ts', {}, env)
      if (n in deps) return deps[n]
      throw Error(n)
    },
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    c,
  )
  return c.exports
}
test('window rejects missing, invalid, future and exact 24h; warns in final hour', () => {
  const { inboxWindow } = load('lib/features/inbox/inbox-v2.ts')
  const now = Date.now()
  for (const t of [
    null,
    'bad',
    new Date(now + 1).toISOString(),
    new Date(now - 86400000).toISOString(),
  ])
    assert.equal(inboxWindow(t, now).allowed, false)
  assert.equal(inboxWindow(new Date(now - 1).toISOString(), now).allowed, true)
  assert.equal(inboxWindow(new Date(now - 85000000).toISOString(), now).nearExpiry, true)
})
test('workspace migration: idempotence, tenant/package checks, personal stars, rate limit, no outbound messages', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      fs
        .readFileSync('scripts/test-smart-inbox-sql.cjs', 'utf8')
        .split('await db.exec(`')[1]
        .split('`)')[0],
    )
    await db.exec(fs.readFileSync('supabase/smart-inbox.sql', 'utf8'))
    const sql = fs.readFileSync('supabase/smart-inbox-v2.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    await db.exec('set role service_role')
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const a = (await one('insert into auth.users default values returning id')).id,
      b = (await one('insert into auth.users default values returning id')).id
    const shop = (await one('insert into tenants default values returning id')).id
    await db.query("insert into tenant_members values($1,$2,'owner')", [shop, a])
    const c = (await one('insert into customers(tenant_id) values($1) returning id', [shop])).id
    const act = (actor, action, key = crypto.randomUUID(), body = null) =>
      db.query('select manage_inbox_workspace($1,$2,$3,$4,$5)', [c, actor, action, key, body])
    await assert.rejects(act(b, 'note', crypto.randomUUID(), 'secret'), (e) => e.code === '42501')
    const key = crypto.randomUUID()
    await act(a, 'note', key, 'ทีมร้านเท่านั้น')
    await act(a, 'note', key, 'ทีมร้านเท่านั้น')
    assert.equal((await one('select count(*) n from inbox_internal_notes')).n, 1)
    await assert.rejects(act(a, 'note', key, 'changed'), (e) => e.code === '22023')
    await assert.rejects(act(a, 'note', crypto.randomUUID(), '  '), (e) => e.code === '22023')
    await act(a, 'star')
    await act(a, 'star')
    assert.equal((await one('select count(*) n from inbox_stars')).n, 1)
    await act(a, 'unstar')
    assert.equal((await one('select count(*) n from inbox_stars')).n, 0)
    for (let i = 0; i < 26; i++) await act(a, 'star')
    await assert.rejects(act(a, 'star'), (e) => e.code === 'P0429')
    assert.equal((await one('select count(*) n from messages')).n, 0)
    await db.exec('reset role;set role authenticated')
    await assert.rejects(db.query('select * from inbox_internal_notes'), (e) => e.code === '42501')
    await assert.rejects(act(a, 'star'), (e) => e.code === '42501')
  } finally {
    await db.close()
  }
})

test('V2 policy fails closed for missing signed evidence and unverified page permissions', async () => {
  const window = load('lib/features/inbox/inbox-v2.ts')
  let timestamp = null,
    status = 'verified',
    calls = 0
  class InboxError extends Error {
    constructor(message, status, code) {
      super(message)
      this.status = status
      this.code = code
    }
  }
  const db = {
    from: () => {
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
        maybeSingle: async () => ({
          data: timestamp ? { interacted_at: timestamp } : null,
          error: null,
        }),
      }
      return q
    },
  }
  const policy = load('lib/features/inbox/inbox-policy-server.ts', {
    'server-only': {},
    '@/lib/features/inbox/inbox-v2': window,
    '@/lib/features/inbox/inbox-server': { InboxError },
    '@/lib/integrations/facebook/client': {
      getPageTokenStatus: async () => {
        calls++
        return status
      },
    },
  })
  await assert.rejects(
    policy.assertInboxPolicy(db, 'tenant', 'customer', 'page', 'token'),
    (e) => e.code === 'MESSAGING_WINDOW_CLOSED',
  )
  assert.equal(calls, 0)
  timestamp = new Date().toISOString()
  for (status of ['limited', 'invalid', 'unverified'])
    await assert.rejects(
      policy.assertInboxPolicy(db, 'tenant', 'customer', 'page', 'token'),
      (e) => e.code === 'PAGE_NOT_READY',
    )
  status = 'verified'
  await policy.assertInboxPolicy(db, 'tenant', 'customer', 'page', 'token')
})
test('workspace API keeps authentication and cross-site protection without an opt-in flag', async () => {
  let guarded = 0,
    mutations = 0
  class InboxError extends Error {
    constructor(message, status) {
      super(message)
      this.status = status
    }
  }
  const deps = {
    'next/server': {
      NextResponse: { json: (body, opts = {}) => ({ body, status: opts.status ?? 200 }) },
    },
    '@/lib/features/inbox/inbox-policy-server': {},
    '@/lib/features/inbox/inbox-v2': load('lib/features/inbox/inbox-v2.ts'),
    '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
    '@/lib/features/inbox/inbox-server': {
      InboxError,
      inboxError: (e) => ({ status: e.status ?? 503 }),
      inboxCustomer: async () => {
        guarded++
        throw new InboxError('Forbidden', 403)
      },
      checkRpc: () => {
        mutations++
      },
    },
  }
  const api = load('app/api/inbox/conversations/[id]/workspace/route.ts', deps),
    ctx = { params: Promise.resolve({ id: 'customer' }) },
    req = { headers: { get: () => null }, nextUrl: { origin: 'https://shop.test' } }
  assert.equal((await api.GET(req, ctx)).status, 403)
  assert.equal(guarded, 1)
  assert.equal(
    (
      await api.POST(
        { ...req, headers: { get: (k) => (k === 'origin' ? 'https://evil.test' : null) } },
        ctx,
      )
    ).status,
    403,
  )
  assert.equal(guarded, 1)
  assert.equal(mutations, 0)
})

test('list filters exclude unknown state, match real order IDs, assignments and completed conversations', () => {
  const { matchesInboxFilter: match } = load('lib/features/inbox/inbox-list.ts')
  const state = {
    id: 'a',
    assigned_user_id: null,
    conversation_status: 'open',
    conversation_version: 1,
    inbound_seq: 1,
    bot_enabled: false,
    unread_count: 2,
    inbox_stage: 'UNASSIGNED',
  }
  const check = (filter, s = state) => match(filter, 'a', s, 'owner', ['a'], ['a'])
  assert.equal(check('waiting'), true)
  assert.equal(check('unread'), true)
  assert.equal(match('waiting', 'a', undefined, 'owner', [], []), false)
  assert.equal(check('payment'), true)
  assert.equal(match('payment', 'b', state, 'owner', ['a'], []), false)
  assert.equal(check('starred'), true)
  assert.equal(check('mine'), false)
  assert.equal(check('mine', { ...state, assigned_user_id: 'owner' }), true)
  assert.equal(check('progress', { ...state, inbox_stage: 'ASSIGNED' }), true)
  assert.equal(check('resolved', { ...state, conversation_status: 'closed' }), true)
  assert.equal(check('waiting', { ...state, bot_enabled: true }), false)
})
