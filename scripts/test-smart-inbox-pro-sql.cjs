const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { test } = require('node:test'),
  { PGlite } = require('@electric-sql/pglite')
test('Pro workflow: idempotent actions, racing admins, close reasons, reopen, tenant isolation, rate and real reporting', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      fs
        .readFileSync('scripts/test-smart-inbox-sql.cjs', 'utf8')
        .split('await db.exec(`')[1]
        .split('`)')[0],
    )
    await db.exec(fs.readFileSync('supabase/smart-inbox.sql', 'utf8'))
    const sql = fs.readFileSync('supabase/smart-inbox-pro.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    await db.exec('set role service_role')
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const owner = (await one('insert into auth.users default values returning id')).id,
      staff = (await one('insert into auth.users default values returning id')).id,
      foreign = (await one('insert into auth.users default values returning id')).id
    const shop = (await one('insert into tenants default values returning id')).id,
      other = (await one('insert into tenants default values returning id')).id
    await db.query(
      "insert into tenant_members values($1,$2,'owner'),($1,$3,'staff'),($4,$5,'owner')",
      [shop, owner, staff, other, foreign],
    )
    await db.query("insert into bot_settings values($1,'keyword')", [shop])
    const customer = (await one('insert into customers(tenant_id) values($1) returning id', [shop]))
      .id
    const state = () => one('select * from customers where id=$1', [customer])
    const act = (
      actor,
      action,
      version,
      key = crypto.randomUUID(),
      reason = null,
      assignee = null,
    ) =>
      one('select manage_inbox_pro($1,$2,$3,$4,$5,$6,$7) result', [
        customer,
        actor,
        action,
        version,
        key,
        reason,
        assignee,
      ])
    const key = crypto.randomUUID()
    const outcomes = await Promise.allSettled([act(owner, 'claim', 0, key), act(staff, 'claim', 0)])
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal((await state()).bot_enabled, false)
    assert.equal((await state()).inbox_stage, 'ASSIGNED')
    assert.deepEqual(await act(owner, 'claim', 0, key), outcomes[0].value)
    assert.equal((await one('select count(*)::int n from conversation_events')).n, 1)
    await assert.rejects(act(owner, 'close', 0, key, 'reuse'), (e) => e.code === '22023')
    await assert.rejects(
      act(foreign, 'close', 1, crypto.randomUUID(), 'forged'),
      (e) => e.code === '42501',
    )
    await assert.rejects(act(staff, 'release', 1), (e) => e.code === '42501')
    await act(owner, 'transfer', 1, crypto.randomUUID(), null, staff)
    await act(staff, 'start', 2)
    assert.equal((await state()).inbox_stage, 'IN_PROGRESS')
    await act(staff, 'resolve', 3)
    assert.equal((await state()).inbox_stage, 'RESOLVED')
    const msg = (
      await one(
        "insert into messages(customer_id,sender,created_at) values($1,'customer',now()-interval '30 seconds') returning id",
        [customer],
      )
    ).id
    assert.equal((await state()).inbox_stage, 'IN_PROGRESS')
    await assert.rejects(
      act(staff, 'close', (await state()).conversation_version),
      (e) => e.code === '22023',
    )
    const closeVersion = (await state()).conversation_version,
      closeKey = crypto.randomUUID()
    await act(staff, 'close', closeVersion, closeKey, 'resolved for customer')
    await act(staff, 'close', closeVersion, closeKey, 'resolved for customer')
    assert.equal((await state()).close_reason, 'resolved for customer')
    assert.equal((await state()).closed_by, staff)
    assert.ok((await state()).closed_at)
    assert.equal(
      (await one("select count(*)::int n from conversation_events where action='close'")).n,
      1,
    )
    await assert.rejects(
      act(staff, 'close', (await state()).conversation_version, crypto.randomUUID(), 'again'),
      (e) => e.code === '40001',
    )
    await act(staff, 'reopen', (await state()).conversation_version)
    assert.equal((await state()).closed_at, null)
    assert.equal((await state()).inbox_stage, 'ASSIGNED')
    await act(staff, 'release', (await state()).conversation_version)
    assert.equal((await state()).assigned_user_id, null)
    assert.equal((await state()).bot_enabled, false)
    assert.equal((await state()).inbox_stage, 'UNASSIGNED')
    await db.query(
      "insert into messages(customer_id,sender,delivery_status) values($1,'agent','sent')",
      [customer],
    )
    const report = (await one('select inbox_pro_overview($1) result', [shop])).result
    assert.equal(report.counts.total, 1)
    assert.equal(report.counts.waiting, 1)
    assert.equal(report.responseSamples, 1)
    assert.ok(report.averageResponseSeconds >= 0)
    assert.equal(
      (await one('select inbox_pro_overview($1) result', [other])).result.counts.total,
      0,
    )
    await db.exec('reset role')
    await db.exec(sql)
    await db.exec('set role service_role')
    assert.equal((await state()).inbox_stage, 'UNASSIGNED')
    const beforeReplay = (await one('select count(*)::int n from conversation_events')).n
    await act(owner, 'claim', 0, key)
    assert.equal((await one('select count(*)::int n from conversation_events')).n, beforeReplay)
    assert.equal((await state()).inbox_stage, 'UNASSIGNED')
    await db.query(
      "insert into inbox_action_receipts(tenant_id,actor_id,request_id,customer_id,payload,result) select $1,$2,gen_random_uuid(),$3,'{}','{}' from generate_series(1,30)",
      [shop, owner, customer],
    )
    await assert.rejects(
      act(owner, 'claim', (await state()).conversation_version),
      (e) => e.code === 'P0429',
    )
    await db.exec('set role authenticated')
    await assert.rejects(
      db.query('select inbox_pro_overview($1)', [shop]),
      (e) => e.code === '42501',
    )
    await assert.rejects(db.query('select * from inbox_action_receipts'), (e) => e.code === '42501')
    await assert.rejects(
      db.query('select manage_inbox_pro($1,$2,$3,0,$4,null,null)', [
        customer,
        owner,
        'claim',
        crypto.randomUUID(),
      ]),
      (e) => e.code === '42501',
    )
    assert.ok(msg)
  } finally {
    await db.close()
  }
})
