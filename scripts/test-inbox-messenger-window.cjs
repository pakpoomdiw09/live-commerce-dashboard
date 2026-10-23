const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const load = require('./helpers/load-typescript.cjs')
const windows = load('lib/features/inbox/inbox-v2.ts')
const day = 86400000

class InboxError extends Error {
  constructor(message, status = 400, code = 'INBOX_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

test('countdown has strict 24-hour and seven-day boundaries and rejects missing/future evidence', () => {
  const now = Date.now()
  for (const timestamp of [null, 'invalid', new Date(now + 1).toISOString()]) {
    assert.equal(windows.messengerWindow(timestamp, now).allowed, false)
    assert.equal(windows.messengerWindow(timestamp, now).humanAllowed, false)
  }
  assert.equal(windows.messengerWindow(new Date(now - day + 1).toISOString(), now).allowed, true)
  assert.equal(windows.messengerWindow(new Date(now - day).toISOString(), now).allowed, false)
  assert.equal(windows.messengerWindow(new Date(now - day).toISOString(), now).humanAllowed, true)
  assert.equal(
    windows.messengerWindow(new Date(now - 7 * day + 1).toISOString(), now).humanAllowed,
    true,
  )
  assert.equal(
    windows.messengerWindow(new Date(now - 7 * day).toISOString(), now).humanAllowed,
    false,
  )
  assert.equal(windows.formatWindowCountdown(1001), '00:00:02')
  assert.equal(windows.formatWindowCountdown(day), '24:00:00')
})

function policyFixture({ age = day * 2, approved = true, verified = true, missing = false } = {}) {
  const filters = []
  const db = {
    from(table) {
      assert.equal(table, 'broadcast_messaging_events')
      const q = {
        select() {
          return q
        },
        eq(key, value) {
          filters.push([key, value])
          return q
        },
        order() {
          return q
        },
        limit() {
          return q
        },
        async maybeSingle() {
          return {
            data: missing ? null : { interacted_at: new Date(Date.now() - age).toISOString() },
            error: null,
          }
        },
      }
      return q
    },
  }
  const policy = load(
    'lib/features/inbox/inbox-policy-server.ts',
    {
      'server-only': {},
      '@/lib/features/inbox/inbox-v2': windows,
      '@/lib/features/inbox/inbox-server': { InboxError },
      '@/lib/integrations/facebook/client': {
        getPageTokenStatus: async () => (verified ? 'verified' : 'unverified'),
      },
    },
    { process: { env: { FB_HUMAN_AGENT_APPROVED: String(approved) } } },
  )
  return {
    db,
    policy,
    filters,
    check: (human) => policy.assertInboxPolicy(db, 'tenant', 'customer', 'page', 'token', human),
  }
}

test('only approved human replies use HUMAN_AGENT, automated requests never inherit the extension', async () => {
  const f = policyFixture()
  await assert.rejects(f.check(false), (error) => error.code === 'MESSAGING_WINDOW_CLOSED')
  assert.deepEqual(JSON.parse(JSON.stringify(await f.check(true))), { tag: 'HUMAN_AGENT' })
  for (const pair of [
    ['tenant_id', 'tenant'],
    ['customer_id', 'customer'],
    ['page_id', 'page'],
    ['kind', 'inbound_message'],
  ]) {
    assert.ok(f.filters.some((filter) => JSON.stringify(filter) === JSON.stringify(pair)))
  }
  assert.equal(await policyFixture({ age: 1000 }).check(false), 'RESPONSE')
  await assert.rejects(
    policyFixture({ approved: false }).check(true),
    (error) => error.code === 'HUMAN_AGENT_UNAVAILABLE',
  )
  await assert.rejects(
    policyFixture({ verified: false }).check(true),
    (error) => error.code === 'PAGE_NOT_READY',
  )
  for (const options of [{ age: 7 * day }, { missing: true }, { age: -10000 }]) {
    await assert.rejects(
      policyFixture(options).check(true),
      (error) => error.code === 'MESSAGING_WINDOW_CLOSED',
    )
  }
})

test('manual send requires ownership and consent, attaches the server tag, and rechecks before the durable send', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const clientId = '22222222-2222-4222-8222-222222222222'
  let assigned = 'actor',
    bot = false,
    checks = 0,
    sends = 0,
    leases = 0,
    releases = 0,
    inserted = 0,
    failSecond = false
  const db = {
    async rpc(name) {
      if (name === 'end_inbox_delivery') releases++
      else leases++
      return { data: 'lease', error: null }
    },
    from(table) {
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        insert() {
          inserted++
          return q
        },
        update() {
          return q
        },
        async maybeSingle() {
          return { data: null, error: null }
        },
        async single() {
          return {
            data: table === 'tenants' ? { page_id: 'page', page_access_token: 'token' } : { id },
            error: null,
          }
        },
        then(resolve) {
          return Promise.resolve({ error: null }).then(resolve)
        },
      }
      return q
    },
  }
  const api = load(
    'app/api/messages/send/route.ts',
    {
      'next/server': {
        NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) },
      },
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
      '@/lib/features/inbox/inbox-server': {
        InboxError,
        checkRpc(error) {
          if (error) throw error
        },
        inboxError: (error) => ({ status: error.status ?? 500, code: error.code }),
        inboxCustomer: async () => ({
          db,
          actor: { id: 'actor' },
          tenantId: 'tenant',
          customer: {
            id,
            assigned_user_id: assigned,
            bot_enabled: bot,
            conversation_status: 'open',
            platform_user_id: 'psid',
          },
        }),
      },
      '@/lib/features/inbox/inbox-policy-server': {
        assertInboxPolicy: async (_db, _tenant, _customer, _page, _token, human) => {
          checks++
          if (!human || (failSecond && checks % 2 === 0))
            throw new InboxError('expired', 409, 'MESSAGING_WINDOW_CLOSED')
          return { tag: 'HUMAN_AGENT' }
        },
      },
      '@/lib/integrations/facebook/client': {
        pageTokenFor: (page) => page.page_access_token,
        SendApiError: class extends Error {},
        isWindowOrTagError: () => false,
        sendMessageWithReceipt: async (_token, _psid, _message, type) => {
          assert.equal(type.tag, 'HUMAN_AGENT')
          sends++
          return 'receipt'
        },
      },
    },
    { process: { env: {} }, console },
  )
  const send = (humanAgent) =>
    api.POST({
      headers: { get: () => null },
      nextUrl: { origin: 'https://shop.test' },
      json: async () => ({ customerId: id, clientId, text: 'ช่วยดูแลปัญหาให้ค่ะ', humanAgent }),
    })
  assigned = 'another'
  assert.equal((await send(true)).status, 409)
  assigned = 'actor'
  bot = true
  assert.equal((await send(true)).status, 409)
  bot = false
  assert.equal((await send(false)).status, 409)
  assert.equal(sends, 0)
  assert.equal(leases, 0)
  checks = 0
  assert.equal((await send(true)).status, 200)
  assert.equal(checks, 2)
  assert.equal(sends, 1)
  assert.equal(releases, 1)
  checks = 0
  inserted = 0
  failSecond = true
  assert.equal((await send(true)).status, 409)
  assert.equal(sends, 1)
  assert.equal(inserted, 0)
  assert.equal(releases, 2)
})

test('database guards use tenant/page evidence and separate automated 24-hour from manual seven-day leases', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      fs
        .readFileSync('scripts/test-smart-inbox-sql.cjs', 'utf8')
        .split('await db.exec(`')[1]
        .split('`)')[0],
    )
    await db.exec(fs.readFileSync('supabase/smart-inbox.sql', 'utf8'))
    await db.exec(`alter table tenants add column page_id text;
   create table broadcast_messaging_events(tenant_id uuid,customer_id uuid,page_id text,kind text,interacted_at timestamptz);
   create table agent_message_jobs(id uuid primary key default gen_random_uuid(),tenant_id uuid,customer_id uuid,dispatch_started_at timestamptz);
   grant all on broadcast_messaging_events,agent_message_jobs to service_role;`)
    const migration = fs.readFileSync('supabase/inbox-messenger-window.sql', 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
    const actor = (await one('insert into auth.users default values returning id')).id
    const tenant = (await one("insert into tenants(page_id) values('page') returning id")).id
    await db.query("insert into tenant_members values($1,$2,'owner')", [tenant, actor])
    const customer = (
      await one('insert into customers(tenant_id,last_message_at) values($1,now()) returning id', [
        tenant,
      ])
    ).id
    const dispatch = () => db.query('select start_inbox_delivery($1)', [customer])
    await assert.rejects(dispatch(), (error) => error.code === 'P0424')
    await db.query(
      "insert into broadcast_messaging_events values($1,$2,'wrong-page','inbound_message',now())",
      [tenant, customer],
    )
    await assert.rejects(dispatch(), (error) => error.code === 'P0424')
    await db.query(
      "insert into broadcast_messaging_events values($1,$2,'page','inbound_message',clock_timestamp()-interval '2 days')",
      [tenant, customer],
    )
    await assert.rejects(dispatch(), (error) => error.code === 'P0424')
    await db.query('update customers set bot_enabled=false,assigned_user_id=$2 where id=$1', [
      customer,
      actor,
    ])
    await db.query('select start_inbox_delivery($1,$2)', [customer, actor])
    await assert.rejects(
      db.query('update customers set bot_enabled=true where id=$1', [customer]),
      (error) => error.code === 'P0424',
    )
    await db.query('update customers set outbound_lock_until=null where id=$1', [customer])
    await db.query(
      "update broadcast_messaging_events set interacted_at=clock_timestamp()-interval '7 days' where page_id='page'",
    )
    await assert.rejects(
      db.query('select start_inbox_delivery($1,$2)', [customer, actor]),
      (error) => error.code === 'P0424',
    )
    await db.query(
      "update broadcast_messaging_events set interacted_at=clock_timestamp()-interval '1 second' where page_id='page'",
    )
    await db.query('update customers set bot_enabled=true,assigned_user_id=null where id=$1', [
      customer,
    ])
    await dispatch()
    const job = (
      await one(
        'insert into agent_message_jobs(tenant_id,customer_id) values($1,$2) returning id',
        [tenant, customer],
      )
    ).id
    await db.query(
      "update broadcast_messaging_events set interacted_at=clock_timestamp()-interval '1 day' where page_id='page'",
    )
    await assert.rejects(
      db.query('update agent_message_jobs set dispatch_started_at=clock_timestamp() where id=$1', [
        job,
      ]),
      (error) => error.code === 'P0424',
    )
    await db.query(
      "update customers set last_message_at=clock_timestamp()-interval '1 day' where id=$1",
      [customer],
    )
    assert.equal(
      (await one('select expire_inbox_automation($1) changed', [customer])).changed,
      true,
    )
    const paused = await one('select bot_enabled,conversation_version from customers where id=$1', [
      customer,
    ])
    assert.equal(paused.bot_enabled, false)
    assert.equal(
      (await one('select expire_inbox_automation($1) changed', [customer])).changed,
      false,
    )
    assert.equal(
      (await one('select conversation_version from customers where id=$1', [customer]))
        .conversation_version,
      paused.conversation_version,
    )
    assert.equal(
      (
        await one(
          "select count(*) n from conversation_events where customer_id=$1 and action='pause'",
          [customer],
        )
      ).n,
      1,
    )
    await db.query(
      "update broadcast_messaging_events set interacted_at=clock_timestamp()-interval '1 second' where page_id='page'",
    )
    await db.query('update customers set bot_enabled=true where id=$1', [customer])
    assert.equal(
      (await one('select expire_inbox_automation_windows(1) n')).n,
      0,
      'Fresh signed evidence must not be paused by the sweeper',
    )
    assert.equal(
      (await one('select inbox_automation_window_open($1,$2) allowed', [customer, tenant])).allowed,
      true,
    )
    assert.equal(
      (await one('select inbox_automation_window_open($1,gen_random_uuid()) allowed', [customer]))
        .allowed,
      false,
    )
    await db.exec('set role authenticated')
    await assert.rejects(dispatch(), (error) => error.code === '42501')
    await assert.rejects(
      db.query('select expire_inbox_automation($1)', [customer]),
      (error) => error.code === '42501',
    )
  } finally {
    await db.close()
  }
})
