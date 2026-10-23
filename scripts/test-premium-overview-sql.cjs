// Isolated PostgreSQL; no .env, live Supabase, provider calls or production writes.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { PGlite } = require(process.argv[2] || '@electric-sql/pglite')
;(async () => {
  const db = new PGlite()
  let checks = 0
  try {
    let fixture = fs
      .readFileSync('scripts/test-smart-followups-sql.cjs', 'utf8')
      .split('await db.exec(`')[1]
      .split('`)')[0]
    fixture = fixture.replace(
      "name text default 'Shop',",
      "name text default 'Shop',slip_quota integer default 100,slip_quota_credits integer default 50,slip_used integer default 20,",
    )
    await db.exec(fixture)
    await db.exec(`alter table customers add column avatar_url text;alter table customers add column unread_count integer default 0;alter table customers add column assigned_user_id uuid;
 alter table slips add column status text default 'pending';alter table slips add column amount numeric;alter table slips add column approved_at timestamptz;alter table slips add column note text;
 create table agent_message_jobs(id uuid primary key default gen_random_uuid(),tenant_id uuid,customer_id uuid,route text,status text,created_at timestamptz default now());
 create table agent_ai_monthly_usage(tenant_id uuid,month date,used integer);create table agent_control_settings(tenant_id uuid,ai_monthly_limit integer);`)
    const migration = fs.readFileSync('supabase/premium-overview.sql', 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    const one = async (q, args = []) => (await db.query(q, args)).rows[0]
    const a = (await one("insert into tenants(name) values('Own shop') returning id")).id,
      b = (await one("insert into tenants(name) values('Foreign shop') returning id")).id
    const customer = async (t, name) =>
      (
        await one(
          'insert into customers(tenant_id,display_name,last_message_at,unread_count) values($1,$2,now(),3) returning id',
          [t, name],
        )
      ).id
    const ca = await customer(a, 'Own customer'),
      cb = await customer(b, 'Foreign customer')
    const from = new Date(Date.now() - 3 * 86400000).toISOString(),
      to = () => new Date(Date.now() + 1000).toISOString(),
      previous = new Date(Date.now() - 6 * 86400000).toISOString()
    const summary = async (
      t = a,
      { start = from, end = to(), prev = previous, page = 1, q = '' } = {},
    ) =>
      (
        await one('select premium_overview_summary($1,$2,$3,$4,$5,$6) data', [
          t,
          start,
          end,
          prev,
          page,
          q,
        ])
      ).data
    async function slip(
      t,
      c,
      status,
      amount,
      approved = false,
      at = new Date().toISOString(),
      note = '',
    ) {
      return (
        await one(
          'insert into slips(tenant_id,customer_id,status,amount,approved_at,created_at,note) values($1,$2,$3,$4,$5,$6,$7) returning id',
          [t, c, status, amount, approved ? at : null, at, note],
        )
      ).id
    }
    await slip(a, ca, 'valid', 9)
    await slip(a, ca, 'amount_mismatch', 19, true)
    await slip(a, ca, 'pending', 200)
    await slip(a, ca, 'wrong_receiver', 300)
    await slip(a, ca, 'duplicate', 999, true)
    await slip(a, ca, 'fake', 600)
    await slip(a, ca, 'error', 800)
    await slip(a, cb, 'valid', 2, false, undefined, 'Linked wrong tenant customer must stay hidden')
    await slip(b, cb, 'valid', 99999)
    await db.query(
      "insert into messages(customer_id,sender,body) values($1,'customer','Own last message'),($2,'customer','Foreign message')",
      [ca, cb],
    )
    const initial = await summary()
    assert.equal(initial.metrics.reconciledRevenue, null)
    assert.equal(initial.metrics.verifiedSlipAmount, 30)
    assert.equal(initial.metrics.totalSlips, 8)
    assert.equal(initial.metrics.approved, 3)
    assert.equal(initial.metrics.messages, 1)
    assert.equal(initial.metrics.slipCredits, 130)
    checks++
    assert.deepEqual(initial.results, { passed: 3, pending: 2, rejected: 2, error: 1 })
    assert.equal(
      Object.values(initial.results).reduce((a, b) => a + b, 0),
      initial.metrics.totalSlips,
    )
    assert.equal(
      initial.series.reduce((n, p) => n + p.count, 0),
      8,
    )
    assert.equal(
      initial.series.reduce((n, p) => n + p.amount, 0),
      30,
    )
    checks++
    assert.equal(initial.chats.length, 1)
    assert.equal(initial.chats[0].name, 'Own customer')
    assert.equal(initial.chats[0].body, 'Own last message')
    assert.equal(initial.chats[0].unread_count, 3)
    assert.equal(initial.slips.find((s) => s.amount === 2).customer, null)
    assert.ok(!JSON.stringify(initial).includes('Foreign'))
    checks++
    const past = new Date(Date.now() - 4 * 86400000).toISOString()
    await slip(a, ca, 'valid', 5, false, past)
    const compared = await summary()
    assert.equal(compared.previous.verifiedSlipAmount, 5)
    assert.equal(
      compared.series.reduce((n, p) => n + p.previousAmount, 0),
      5,
    )
    checks++
    const all = await summary(a, { start: null, prev: null })
    assert.equal(all.bucket, 'month')
    assert.equal(all.metrics.totalSlips, 9)
    assert.equal(all.metrics.verifiedSlipAmount, 35)
    assert.equal(all.previous, null)
    checks++
    const searched = await summary(a, { q: 'Linked wrong' })
    assert.equal(searched.slipMatches, 1)
    assert.equal(searched.slips.length, 1)
    assert.equal(searched.metrics.totalSlips, 8)
    assert.equal(searched.chatMatches, 0)
    const quoted = await summary(a, { q: "%' OR 1=1 --" })
    assert.equal(quoted.slipMatches, 0)
    checks++
    for (let i = 0; i < 12; i++) await slip(a, ca, 'pending', 1)
    const page1 = await summary(),
      page2 = await summary(a, { page: 2 })
    assert.equal(page1.slips.length, 10)
    assert.equal(page2.slips.length, 10)
    assert.equal(new Set([...page1.slips, ...page2.slips].map((s) => s.id)).size, 20)
    checks++
    await db.query(
      "insert into agent_message_jobs(tenant_id,customer_id,route,status) values($1,$2,'AI','sent'),($1,$2,'AI','draft'),($1,$2,'ADMIN','review'),($3,$4,'AI','sent')",
      [a, ca, b, cb],
    )
    await db.query(
      "insert into agent_ai_monthly_usage values($1,date_trunc('month',now() at time zone 'UTC')::date,7);",
      [a],
    )
    await db.query('insert into agent_control_settings values($1,100)', [a])
    const ai = (await summary()).ai
    assert.deepEqual(ai, { replies: 1, conversations: 1, handoffs: 1, usage: 7, limit: 100 })
    checks++
    const free = (await one("insert into tenants(plan) values('free') returning id")).id
    const locked = await summary(free)
    assert.equal(locked.metrics.totalSlips, null)
    assert.equal(locked.metrics.messages, null)
    assert.equal(locked.metrics.slipCredits, null)
    assert.deepEqual(locked.slips, [])
    assert.deepEqual(locked.chats, [])
    assert.equal(locked.ai, null)
    checks++
    const starter = (await one("insert into tenants(plan) values('starter') returning id")).id
    assert.equal((await summary(starter)).ai, null)
    assert.equal((await summary(starter)).metrics.totalSlips, 0)
    checks++
    await db.query("update tenants set plan_expires_at=now()-interval '1 day' where id=$1", [a])
    assert.equal((await summary()).metrics.totalSlips, null)
    await db.query("update tenants set plan_expires_at=now()+interval '1 day' where id=$1", [a])
    checks++
    await db.query('update tenants set slip_used=1000 where id=$1', [a])
    assert.equal((await summary()).metrics.slipCredits, 0)
    checks++
    for (const options of [
      { page: 0 },
      { page: 1001 },
      { q: 'a'.repeat(101) },
      { start: to(), end: from },
    ])
      await assert.rejects(summary(a, options), (e) => e.code === '22023')
    checks++
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role)
      await assert.rejects(summary(), /permission denied/)
      await db.exec('reset role')
    }
    checks++
    const boundaryTenant = (await one('insert into tenants default values returning id')).id,
      boundaryCustomer = await customer(boundaryTenant, 'Boundary customer')
    const bangkokDay = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
      boundary = new Date(new Date(bangkokDay + 'T00:00:00+07:00').getTime() - 2 * 86400000)
    await slip(boundaryTenant, boundaryCustomer, 'valid', 0.1, false, boundary.toISOString())
    await slip(
      boundaryTenant,
      boundaryCustomer,
      'valid',
      0.2,
      false,
      new Date(boundary.getTime() + 1000).toISOString(),
    )
    await slip(
      boundaryTenant,
      boundaryCustomer,
      'valid',
      999,
      false,
      new Date(boundary.getTime() - 1).toISOString(),
    )
    const exact = await summary(boundaryTenant, { start: boundary.toISOString(), prev: null })
    assert.equal(exact.metrics.verifiedSlipAmount, 0.3)
    assert.equal(exact.metrics.totalSlips, 2)
    assert.equal(
      exact.series[0].day,
      boundary.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
    )
    checks++
    await db.exec(
      'drop table agent_message_jobs;drop table agent_ai_monthly_usage;drop table agent_control_settings',
    )
    assert.equal((await summary()).ai, null)
    checks++
    await db.query('update tenants set is_active=false where id=$1', [a])
    await assert.rejects(summary(), (e) => e.code === '42501')
    checks++
    console.log(`PASS: ${checks} PostgreSQL Premium Overview scenarios`)
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
