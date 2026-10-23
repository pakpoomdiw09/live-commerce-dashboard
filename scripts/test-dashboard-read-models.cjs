const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const load = require('./helpers/load-typescript.cjs')
const tenant = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const now = '2026-10-23T05:00:00Z'

test('directory validates URL filters and preserves them across pages without tenant overrides', async () => {
  const core = load(
    'lib/features/customers/customer-directory.ts',
    {
      '@/lib/status': { ORDER_STATUSES: ['new', 'pending_review', 'paid', 'approved', 'shipped'] },
    },
    { URLSearchParams },
  )
  for (const input of [
    { page: '0' },
    { page: '-1' },
    { page: '100001' },
    { page: '1.5' },
    { page: ['1', '2'] },
    { q: 'a'.repeat(101) },
    { status: 'toString' },
    { tag: 'a'.repeat(101) },
  ])
    assert.throws(() => core.customerFilters(input))
  const filters = core.customerFilters({
    page: '2',
    q: ' A&B ',
    status: 'paid',
    tag: 'VIP',
    tenantId: other,
  })
  const url = new URL(core.customerDirectoryUrl(filters, { page: 3 }), 'https://local.test')
  assert.equal(url.searchParams.get('page'), '3')
  assert.equal(url.searchParams.get('q'), 'A&B')
  assert.equal(url.searchParams.get('status'), 'paid')
  assert.equal(url.searchParams.get('tag'), 'VIP')
  assert.equal(url.searchParams.has('tenantId'), false)
  const api = load(
    'lib/features/customers/customer-directory-server.ts',
    { 'server-only': {} },
    { console: { error() {} } },
  )
  let calls = 0
  const receipt = { rows: [], tags: [], total: 0, page: 1, pages: 1, pageSize: 50, totalPaid: 0 }
  const db = {
    rpc: async (name, args) => {
      calls++
      assert.equal(name, 'customer_directory')
      assert.equal(args.p_tenant, tenant)
      assert.equal(args.p_page, 2)
      assert.equal(args.p_query, 'A&B')
      return { data: receipt, error: null }
    },
    from() {
      throw Error('Must not load slip rows')
    },
  }
  assert.equal((await api.loadCustomerDirectory(db, tenant, filters)).total, 0)
  assert.equal(calls, 1)
  for (const response of [
    { error: { code: 'PGRST202' } },
    { data: null },
    { data: { ...receipt, rows: Array(51).fill({}) } },
    { data: { ...receipt, totalPaid: null } },
  ])
    await assert.rejects(api.loadCustomerDirectory({ rpc: async () => response }, tenant, filters))
})

async function fixture() {
  const db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table tenants(id uuid primary key,is_active boolean default true);
    create table features(tenant_id uuid,feature text);
    create function has_tenant_feature(t uuid,f text) returns boolean language sql as 'select exists(select 1 from features where tenant_id=t and feature=f)';
    create table customers(id uuid primary key default gen_random_uuid(),tenant_id uuid,display_name text,avatar_url text,platform_user_id text,last_message_at timestamptz,phone text,address text,tags text[] default '{}',order_status text default 'new');
    create table slips(id uuid primary key default gen_random_uuid(),tenant_id uuid,customer_id uuid,amount numeric,status text,created_at timestamptz,approved_at timestamptz);
    create table agent_message_jobs(id uuid primary key default gen_random_uuid(),tenant_id uuid,customer_id uuid,route text,status text,created_at timestamptz,updated_at timestamptz);
    grant select on all tables in schema public to service_role;`)
  await db.query('insert into tenants values($1,true),($2,true)', [tenant, other])
  await db.query("insert into features values($1,'customer_management'),($1,'slip_auto_pilot')", [
    tenant,
  ])
  const sql = fs.readFileSync('supabase/dashboard-read-models.sql', 'utf8')
  await db.exec(sql)
  await db.exec(sql)
  const verification = await db.exec(
    fs.readFileSync('supabase/dashboard-read-models-check.sql', 'utf8'),
  )
  assert.equal(verification[0].rows.length, 3)
  assert.ok(
    verification[0].rows.every(
      (row) => row.installed && row.service_can_execute && !row.client_can_execute,
    ),
  )
  assert.equal(verification[1].rows.length, 5)
  assert.ok(verification[1].rows.every((row) => row.installed))
  const rpc = async (name, args) => {
    const result = await db.query(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) data`,
      args,
    )
    return result.rows[0].data
  }
  return { db, rpc }
}

test('customer aggregation exceeds old limits, preserves lifetime totals and filters before pagination', async () => {
  const { db, rpc } = await fixture()
  try {
    await db.query(
      `insert into customers(tenant_id,display_name,platform_user_id,last_message_at,tags)
      select $1,'Buyer '||i,i::text,'2026-10-23'::timestamptz,array[case when i=1201 then 'rare' else 'regular' end] from generate_series(1,1201) i`,
      [tenant],
    )
    const first = (await db.query("select id from customers where display_name='Buyer 1'")).rows[0]
      .id
    await db.query(
      `insert into slips(tenant_id,customer_id,amount,status,created_at)
      select $1,$2,2,'valid','2020-01-01' from generate_series(1,6001)`,
      [tenant, first],
    )
    await db.query(
      "insert into slips(tenant_id,customer_id,amount,status) values($1,$3,999,'valid'),($2,$3,100,'fake')",
      [other, tenant, first],
    )
    const a = await rpc('customer_directory', [tenant, 1, '', 'all', ''])
    const b = await rpc('customer_directory', [tenant, 2, '', 'all', ''])
    assert.equal(a.total, 1201)
    assert.equal(a.rows.length, 50)
    assert.equal(a.pages, 25)
    assert.equal(a.totalPaid, 12002)
    assert.equal(b.totalPaid, 12002)
    assert.equal(new Set([...a.rows, ...b.rows].map((c) => c.id)).size, 100)
    assert.deepEqual(a.tags, ['rare', 'regular'])
    // Find the exact customer independently of UUID tie order and page position.
    const single = await rpc('customer_directory', [tenant, 1, '', 'all', 'rare'])
    assert.equal(single.total, 1)
    assert.equal(single.rows[0].display_name, 'Buyer 1201')
    await db.query("update customers set phone='unique-phone' where id=$1", [first])
    const exact = await rpc('customer_directory', [tenant, 1, 'unique-phone', 'all', ''])
    assert.equal(exact.rows[0].paidCount, 6001)
    assert.equal(exact.rows[0].paidTotal, 12002)
    assert.equal((await rpc('customer_directory', [tenant, 999, '', 'all', ''])).page, 25)
    assert.equal((await rpc('customer_directory', [tenant, 1, '%', 'all', ''])).total, 0)
    assert.equal((await rpc('customer_directory', [tenant, 1, '', 'paid', ''])).total, 0)
    assert.equal(
      (await rpc('customer_directory', [tenant, 1, '', 'all', 'missing'])).rows.length,
      0,
    )
    await assert.rejects(rpc('customer_directory', [tenant, 0, '', 'all', '']))
    await assert.rejects(rpc('customer_directory', [other, 1, '', 'all', '']))
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role)
      await assert.rejects(rpc('customer_directory', [tenant, 1, '', 'all', '']))
      await db.exec('reset role')
    }
  } finally {
    await db.close()
  }
})

test('AI SQL matches reference statistics including Bangkok midnight, lifetime distinct and empty periods', async () => {
  const { db, rpc } = await fixture()
  const core = load('lib/features/agents/agent-overview-core.ts')
  try {
    const customer = '33333333-3333-4333-8333-333333333333'
    const jobs = [
      ['AI', 'sent', '2026-10-22T17:00:00Z', '2026-10-22T17:00:04Z'],
      ['AI', 'sent', '2026-10-22T16:59:59Z', '2026-10-22T17:00:01Z'],
      ['AI', 'failed', now, now],
      ['AI', 'review', now, now],
      ['ADMIN', 'sent', now, now],
      ['AI', 'draft', now, now],
      ['AI', 'sent', '2020-01-01', '2020-01-01'],
      ['AI', 'sent', '2027-01-01', '2027-01-01'],
      ['AI', 'sent', '2026-10-23T01:00:00Z', '2026-10-22T01:00:00Z'],
    ]
    const reference = []
    for (const [i, [route, status, created_at, updated_at]] of jobs.entries()) {
      const customerId = i === 6 ? other : customer
      await db.query(
        'insert into agent_message_jobs(tenant_id,customer_id,route,status,created_at,updated_at) values($1,$2,$3,$4,$5,$6)',
        [tenant, customerId, route, status, created_at, updated_at],
      )
      reference.push({
        id: String(i),
        customer_id: customerId,
        route,
        status,
        created_at,
        updated_at,
      })
    }
    await db.query(
      "insert into agent_message_jobs(tenant_id,customer_id,route,status,created_at,updated_at) values($1,$1,'AI','sent',$2,$2)",
      [other, now],
    )
    for (const days of [7, 30, 90]) {
      const { recent, ...actual } = await rpc('agent_overview_stats', [tenant, days, now])
      const expected = core.summarizeAgentJobs(reference, days, new Date(now))
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)))
      assert.ok(recent.length <= 10)
    }
    const empty = await rpc('agent_overview_stats', [other, 7, '2010-01-01'])
    assert.equal(empty.customersTotal, 0)
    assert.equal(empty.successRate, null)
    assert.equal(empty.averageSeconds, null)
    assert.equal(empty.points.length, 7)
    assert.equal(empty.recent.length, 0)
    await assert.rejects(rpc('agent_overview_stats', [tenant, 1, now]))
    await db.exec('set role authenticated')
    await assert.rejects(rpc('agent_overview_stats', [tenant, 7, now]))
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})

test('basic slip summary returns exact SQL totals over 5000 rows with only eight attention records', async () => {
  const { db, rpc } = await fixture()
  try {
    await db.query(
      `insert into slips(tenant_id,amount,status,created_at)
      select $1,1,'valid','2026-10-23T01:00:00Z' from generate_series(1,6001)`,
      [tenant],
    )
    await db.query(
      `insert into slips(tenant_id,amount,status,created_at,approved_at) values
      ($1,10,'fake','2026-10-23T01:00:00Z',$2),($1,99,'duplicate','2026-10-23T01:00:00Z',$2),
      ($1,100,'valid','2026-10-09T16:59:59Z',null),($1,100,'valid','2027-01-01',null),
      ($3,100,'valid','2026-10-23T01:00:00Z',null)`,
      [tenant, now, other],
    )
    await db.query(
      `insert into slips(tenant_id,amount,status,created_at)
      select $1,1,'pending','2026-10-22T16:59:59Z' from generate_series(1,12)`,
      [tenant],
    )
    const data = await rpc('basic_overview_stats', [tenant, now])
    assert.equal(data.totalSlips, 6015)
    assert.equal(data.periodTotal, 6011)
    assert.equal(data.attentionCount, 12)
    assert.equal(data.attention.length, 8)
    assert.equal(data.points.length, 14)
    assert.equal(data.points[0].day, '2026-10-10')
    assert.equal(data.points.at(-1).amount, 6011)
    assert.equal(data.points.at(-1).count, 6002)
    assert.equal(data.byStatus.valid, 6001)
    await db.exec('set role authenticated')
    await assert.rejects(rpc('basic_overview_stats', [tenant, now]))
    await db.exec('reset role')
    await db.query('update tenants set is_active=false where id=$1', [tenant])
    await assert.rejects(rpc('agent_overview_stats', [tenant, 7, now]))
    await assert.rejects(rpc('customer_directory', [tenant, 1, '', 'all', '']))
    await assert.rejects(rpc('basic_overview_stats', [tenant, now]))
  } finally {
    await db.close()
  }
})
