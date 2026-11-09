const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const { build } = require('./build-full-database-setup.cjs')
const { completeSchema } = require('./lib/complete-schema.cjs')
const { fixture } = require('./helpers/auction-hardening-db.cjs')
const preflight = () => fs.readFileSync(process.env.AUCTION_PREFLIGHT_FILE ?? 'reports/auction-audit/preflight.sql', 'utf8')
const inspect = async db => (await db.exec(preflight())).flatMap(result => result.rows ?? [])
const assertStage = (rows, stage) => assert.deepEqual(rows.filter(row => row.stage === stage && row.status !== 'PASS'), [], stage)

test('read-only preflight reports absent prerequisites without crashing on a missing schema', async () => {
  const db = new PGlite()
  try {
    const before = (await db.query("select count(*)::int n from pg_class where relnamespace='public'::regnamespace")).rows[0]
    const rows = await inspect(db)
    assert.ok(rows.some(row => row.status === 'BLOCKED' && row.requirement === 'public.auctions'))
    assert.equal(rows.find(row => row.requirement === 'transaction_read_only').status, 'PASS')
    assert.deepEqual((await db.query("select count(*)::int n from pg_class where relnamespace='public'::regnamespace")).rows[0], before)
  } finally { await db.close() }
})

test('staging rehearsal upgrades a legacy comment flow through deadlines, audit 1, then audit 2 without premature orders', async () => {
  const result = build()
  const index = result.sources.indexOf('live-auction-deadlines.sql')
  assert.deepEqual(result.sources.slice(index), ['live-auction-deadlines.sql', 'live-auction-audit-hardening.sql', 'live-auction-audit-hardening-2.sql', 'live-auction-manual-host-close.sql', 'live-auction-auto-cycle.sql'])
  const prefix = n => completeSchema({ ...result, sections: result.sections.slice(0, n) })
  const f = await fixture(prefix(index))
  const captures = {}
  const signature = 'public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)'
  const definition = async () => (await f.one('select pg_get_functiondef($1::regprocedure) definition', [signature])).definition
  const orderCount = async a => (await f.one('select count(*)::int n from orders where source_id=$1', [a.id])).n
  try {
    // Controlled drift overlay reproduces the user-reported active legacy functions.
    // This is a local simulation, not a clone or inspection of production.
    const original = fs.readFileSync('supabase/live-auctions.sql', 'utf8')
    for (const name of ['finalize_live_auction', 'process_live_auction_comment']) {
      const source = original.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?end \\$\\$;'))?.[0]
      assert.ok(source, name)
      await f.db.exec(source)
    }
    captures.legacy = await definition()
    assert.ok(captures.legacy.includes('if sender is null or cid is null'))
    assert.ok(!captures.legacy.includes('confirmation_floor'))
    const initial = await inspect(f.db)
    assertStage(initial, '00_base')
    assert.equal(initial.find(row => row.requirement === 'public.auctions.ends_at').status, 'BLOCKED')
    assert.equal(initial.find(row => row.kind === 'function_body' && row.requirement === signature).status, 'BLOCKED')
    const legacy = await f.open()
    await f.receive(legacy, '900', '100')
    await f.receive(legacy, '999', 'close')
    assert.equal(await orderCount(legacy), 1, 'reproduce immediate-order legacy behavior')

    // Replay the complete registry prefix each time: the migration ledger skips unchanged history.
    await f.db.exec(prefix(index + 1))
    captures.deadlines = await definition()
    assertStage(await inspect(f.db), '10_before_audit_1')
    assert.equal((await f.one('select ends_at from auctions where id=$1', [legacy.id])).ends_at, null)
    await f.db.exec(prefix(index + 2))
    captures.audit1 = await definition()
    assertStage(await inspect(f.db), '20_before_audit_2')
    const a = await f.open(), second = Math.floor(Date.now() / 1000)
    await f.db.query('update auctions set created_at=to_timestamp($2) where id=$1', [a.id, second - 10])
    await f.receive(a, '900', '100')
    await f.receive(a, '901', '200')
    assert.equal((await f.receive(a, '999', 'close', second)).result.status, 'awaiting_confirmation')
    assert.equal(await orderCount(a), 0)
    const confirmation = await f.receive(a, '901', 'confirm', second)
    assert.equal(confirmation.result.status, 'stale', 'audit 1 still has the source-seconds race')
    await f.db.exec(prefix(index + 3))
    captures.audit2 = await definition()
    await f.db.exec(prefix(index + 5))
    captures.cycle = await definition()
    const final = await inspect(f.db)
    assert.deepEqual(final.filter(row => row.status !== 'PASS'), [])
    assert.equal((await f.processEvent(a, confirmation.event, confirmation.parsed)).status, 'confirmed')
    await f.processEvent(a, confirmation.event, confirmation.parsed)
    assert.equal(await orderCount(a), 1)
    assert.equal((await f.receive(a, '901', 'confirm', second - 20)).result.status, 'stale')
    assert.equal(await orderCount(legacy), 1, 'historical legacy order remains intact')
    const current = await fixture()
    try {
      const expected = await current.one('select pg_get_functiondef($1::regprocedure) definition', [signature])
      assert.equal(captures.cycle, expected.definition, 'no function drift versus fresh current installation')
    } finally { await current.db.close() }
    if (process.env.AUCTION_PREFLIGHT_EVIDENCE) {
      const folder = path.resolve(process.env.AUCTION_PREFLIGHT_EVIDENCE)
      fs.mkdirSync(folder, { recursive: true })
      for (const [stage, sql] of Object.entries(captures)) fs.writeFileSync(path.join(folder, stage + '.sql'), sql)
      fs.writeFileSync(path.join(folder, 'preflight-final.json'), JSON.stringify(final, null, 2))
      fs.writeFileSync(path.join(folder, 'preflight-baseline.json'), JSON.stringify(initial, null, 2))
    }
  } finally { await f.db.close() }
})

test('preflight blocks browser grants and missing reporting-RPC execution privileges without changing them', async () => {
  const f = await fixture()
  try {
    await f.db.exec('grant select on auction_poll_cursors to authenticated; revoke execute on function expire_live_auctions_report(uuid) from service_role;')
    const rows = await inspect(f.db)
    assert.equal(rows.find(row => row.requirement === 'public.auction_poll_cursors / authenticated').status, 'BLOCKED')
    assert.equal(rows.find(row => row.requirement === 'expire_live_auctions_report / service_role').status, 'BLOCKED')
    assert.equal((await f.one("select has_table_privilege('authenticated','auction_poll_cursors','SELECT') allowed")).allowed, true)
  } finally { await f.db.close() }
})
