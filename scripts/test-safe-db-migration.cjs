const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const core = require('./lib/safe-db-migration.cjs')
const { connectionConfig } = require('./run-safe-db-migration.cjs')
const root = path.resolve(__dirname, '..')
const plan = core.buildPlan(root)
const idA = '11111111-1111-4111-8111-111111111111'
const idB = '22222222-2222-4222-8222-222222222222'

async function fixture() {
  const engine = new PGlite()
  await engine.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key);
    create table public.tenants(id uuid primary key);
    create table public.customers(id uuid primary key,last_message_at timestamptz);
    create table public.messages(id uuid primary key);
    create table public.slips(id uuid primary key,customer_id uuid,created_at timestamptz);
    create table public.comments(id uuid primary key,post_id text,created_at timestamptz);
    create table public.comment_rules(id uuid primary key,page_ids text[]);`)
  let inTransaction = false
  const statements = []
  const db = {
    async query(sql, params = []) {
      statements.push({ sql, params })
      const result = await engine.query(sql, params)
      if (/^begin$/i.test(sql)) inTransaction = true
      if (/^(commit|rollback)$/i.test(sql)) inTransaction = false
      return { ...result, rowCount: result.affectedRows ?? result.rows.length }
    },
  }
  return { engine, db, statements, inside: () => inTransaction }
}

test('splitter retains SQL bodies, quoted semicolons and nested comments as single statements', () => {
  const result = core.splitSql(`-- ignored ;
    select 'a;''b'; /* outer /* nested ; */ done */
    do $body$ begin perform 1; perform 'x;'; end $body$;
    select "a;b";`)
  assert.equal(result.length, 3)
  assert.ok(result[1].includes('perform 1;'))
  assert.throws(() => core.splitSql('do $$ unfinished'))
})

test('deadlock retry happens only after rollback, backs off, and never retries arbitrary SQL errors', async () => {
  const f = await fixture()
  try {
    const column = plan.find((item) => item.kind === 'column')
    let injected = false
    const db = {
      async query(sql, params) {
        const result = await f.db.query(sql, params)
        if (!injected && sql === column.sql[0]) {
          injected = true
          throw Object.assign(Error('injected deadlock after pending DDL'), { code: '40P01' })
        }
        return result
      },
    }
    const pauses = []
    await core.runDdl(db, column, {
      random: () => 0.5,
      log() {},
      sleepMs: async (ms) => {
        assert.equal(f.inside(), false)
        pauses.push(ms)
      },
    })
    assert.deepEqual(pauses, [250])
    assert.equal(await core.installed(f.db, column), true)
    const prior = f.statements.length
    assert.equal(await core.runDdl(f.db, column), 'skip')
    assert.ok(!f.statements.slice(prior).some((row) => /^begin|lock table/i.test(row.sql)))
    let attempts = 0
    const delays = []
    await core.retry(
      async () => {
        if (++attempts < 4) throw Object.assign(Error('busy'), { code: '55P03' })
        return true
      },
      { random: () => 0.5, log() {}, sleepMs: async (ms) => delays.push(ms) },
    )
    assert.deepEqual(delays, [250, 500, 1000])
    await assert.rejects(
      core.retry(
        async () => {
          throw Object.assign(Error('bad schema'), { code: '42703' })
        },
        { sleepMs: async () => assert.fail('must not retry') },
      ),
      (e) => e.code === '42703',
    )
  } finally {
    await f.engine.close()
  }
})

test('real PostgreSQL schema reruns skip existing functions; backfill commits every bounded batch', async () => {
  const f = await fixture()
  try {
    await f.db.query(
      'create function public.consume_slip_credit(p_tenant uuid) returns boolean language sql as $$ select true $$',
    )
    const before = (
      await f.db.query(
        "select pg_get_functiondef('public.consume_slip_credit(uuid)'::regprocedure) body",
      )
    ).rows[0].body
    for (const item of plan) await core.runDdl(f.db, item, { sleepMs: async () => {} })
    for (const item of plan) assert.equal(await core.runDdl(f.db, item), 'skip')
    assert.equal(
      (
        await f.db.query(
          "select pg_get_functiondef('public.consume_slip_credit(uuid)'::regprocedure) body",
        )
      ).rows[0].body,
      before,
    )
    await f.db.query('insert into tenants(id,page_id) values($1,$2),($3,$4)', [
      idA,
      '100',
      idB,
      '200',
    ])
    await f.db.query(
      "insert into comments(id,post_id) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'100_'||i from generate_series(1,501) i",
    )
    await f.db.query(
      "insert into comment_rules(id,page_ids) select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,array['100'] from generate_series(1,501) i",
    )
    await f.db.query(
      "insert into comments(id,post_id,tenant_id) values(gen_random_uuid(),'100_existing',$1),(gen_random_uuid(),'1000_wrong',null)",
      [idB],
    )
    const pauses = []
    for (const table of ['comments', 'comment_rules']) {
      assert.equal(
        await core.runBackfill(f.db, table, {
          batchSize: 100,
          sleepMs: async (ms) => {
            assert.equal(f.inside(), false)
            pauses.push(ms)
          },
        }),
        501,
      )
      assert.equal(
        await core.runBackfill(f.db, table, { batchSize: 100, sleepMs: async () => {} }),
        0,
      )
    }
    assert.ok(pauses.every((ms) => ms === 75))
    assert.ok(
      f.statements
        .filter((row) => row.sql.startsWith('with batch'))
        .every((row) => row.params[0] === 100),
    )
    assert.equal(
      (await f.db.query("select tenant_id from comments where post_id='100_existing'")).rows[0]
        .tenant_id,
      idB,
    )
    assert.equal(
      (await f.db.query("select tenant_id from comments where post_id='1000_wrong'")).rows[0]
        .tenant_id,
      null,
    )
    assert.ok(f.statements.some((row) => /^create index concurrently/i.test(row.sql)))
  } finally {
    await f.engine.close()
  }
})

test('zero-row SKIP LOCKED batch checks pending rows and retries instead of declaring completion', async () => {
  let updates = 0,
    checks = 0,
    committed = false
  const db = {
    async query(sql) {
      if (sql === 'begin') committed = false
      if (sql === 'commit') committed = true
      if (sql.startsWith('with batch')) {
        updates++
        return { rowCount: updates === 2 ? 1 : 0 }
      }
      if (sql.startsWith('select exists')) return { rows: [{ remaining: ++checks === 1 }] }
      return { rows: [] }
    },
  }
  assert.equal(
    await core.runBackfill(db, 'comments', { sleepMs: async () => assert.equal(committed, true) }),
    1,
  )
  assert.equal(updates, 3)
})

test('failed concurrent index creation removes only its own invalid OID before retry', async () => {
  const f = await fixture()
  try {
    const item = plan.find((row) => row.kind === 'index')
    const columnItems = plan.filter((row) => row.kind === 'column' && row.table === item.table)
    for (const column of columnItems) await core.runDdl(f.db, column)
    let fail = true
    const db = {
      async query(sql, params) {
        const result = await f.db.query(sql, params)
        if (fail && sql === item.sql[0]) {
          fail = false
          await f.db.query(
            'update pg_index set indisvalid=false where indexrelid=to_regclass($1)',
            ['public.' + item.name],
          )
          throw Object.assign(Error('failed build'), { code: '40P01' })
        }
        return result
      },
    }
    await core.runDdl(db, item, { log() {}, sleepMs: async () => {} })
    assert.equal(await core.installed(f.db, item), true)
    assert.equal(f.statements.filter((row) => /^drop index concurrently/i.test(row.sql)).length, 1)
    await f.db.query('update pg_index set indisvalid=false where indexrelid=to_regclass($1)', [
      'public.' + item.name,
    ])
    await assert.rejects(core.runDdl(f.db, item), (e) => e.code === 'INVALID_INDEX')
    assert.equal(f.statements.filter((row) => /^drop index concurrently/i.test(row.sql)).length, 1)
  } finally {
    await f.engine.close()
  }
})

test('manual one-shot SQL runs as individual psql-style commands, including top-level procedure commits', async () => {
  const f = await fixture()
  try {
    const rendered = core.renderManual(plan)
    assert.doesNotMatch(rendered, /create\s+(?:unique\s+)?index\s+concurrently\b/i)
    assert.equal(
      fs
        .readFileSync(path.join(root, 'supabase/safe_full_setup.sql'), 'utf8')
        .replace(/\r\n/g, '\n'),
      rendered,
    )
    const statements = core.splitSql(rendered)
    for (let round = 0; round < 2; round++) for (const sql of statements) await f.db.query(sql)
    await f.db.query('insert into tenants(id,page_id) values($1,$2)', [idA, '100'])
    await f.db.query(
      "insert into comments(id,post_id) select gen_random_uuid(),'100_'||i from generate_series(1,501) i",
    )
    await f.db.query('call pg_temp.safe_platform_backfill()')
    assert.equal(
      (await f.db.query('select count(*)::int n from comments where tenant_id=$1', [idA])).rows[0]
        .n,
      501,
    )
  } finally {
    await f.engine.close()
  }
})

test('connection configuration rejects missing credentials, transaction poolers and insecure remote TLS', () => {
  assert.throws(() => connectionConfig({}), /Missing DIRECT_URL/)
  assert.throws(() => connectionConfig({ DIRECT_URL: 'https://example.test' }), /PostgreSQL/)
  assert.throws(
    () => connectionConfig({ DIRECT_URL: 'postgresql://u:p@x.pooler.supabase.com:6543/postgres' }),
    /Transaction Pooler/,
  )
  assert.throws(
    () => connectionConfig({ DIRECT_URL: 'postgresql://u:p@db.example.test/db?sslmode=disable' }),
    /verified TLS/,
  )
  const config = connectionConfig({
    DIRECT_URL: 'postgresql://u:p@db.example.test/db?sslmode=require',
  })
  assert.equal(config.ssl.rejectUnauthorized, true)
  assert.ok(!config.connectionString.includes('sslmode='))
})
