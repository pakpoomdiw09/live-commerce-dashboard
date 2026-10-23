const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { PGlite } = require('@electric-sql/pglite')
;(async () => {
  const db = new PGlite()
  try {
    const fixture = fs
      .readFileSync('scripts/test-smart-followups-sql.cjs', 'utf8')
      .split('await db.exec(`')[1]
      .split('`)')[0]
    await db.exec(fixture)
    await db.exec(fs.readFileSync('supabase/smart-inbox.sql', 'utf8'))
    const creditSql = fs.readFileSync('supabase/free-message-quota.sql', 'utf8')
    await db.exec(
      creditSql.slice(
        creditSql.indexOf('create or replace function public.refresh_broadcast_credits'),
        creditSql.indexOf('create or replace function public.platform_update_tenant'),
      ),
    )
    await db.exec(fs.readFileSync('supabase/smart-follow-ups.sql', 'utf8'))
    const addon = fs.readFileSync('supabase/smart-follow-up-presend.sql', 'utf8')
    await db.exec(addon)
    await db.exec(addon)
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const owner = (await one('insert into auth.users default values returning id')).id
    async function setup(manual = false) {
      const tenant = (await one('insert into tenants default values returning id')).id
      await db.query("insert into tenant_members values($1,$2,'owner')", [tenant, owner])
      await db.query('insert into follow_up_policies(tenant_id,enabled) values($1,true)', [tenant])
      const workflow = (
        await one(
          `insert into follow_up_workflows(tenant_id,kind,enabled,stop_on_reply,steps) values($1,'payment',true,false,'[{"delay_minutes":1,"text":"First"},{"delay_minutes":2,"text":"Second"}]') returning id`,
          [tenant],
        )
      ).id
      const customer = (
        await one('insert into customers(tenant_id) values($1) returning id', [tenant])
      ).id
      const message = (
        await one(
          "insert into messages(customer_id,sender,body) values($1,'customer','order') returning id",
          [customer],
        )
      ).id
      const order = (
        await one(
          'insert into orders(tenant_id,customer_id,message_id) values($1,$2,$3) returning id',
          [tenant, customer, manual ? null : message],
        )
      ).id
      await db.query(
        "update follow_up_jobs set run_at=now()-interval '1 minute' where tenant_id=$1",
        [tenant],
      )
      return { tenant, customer, order, workflow }
    }
    const claim = async (s) => one('select * from claim_follow_up_jobs($1,1)', [s.tenant])
    const prepare = async (j) =>
      (await one('select prepare_follow_up($1,$2) result', [j.id, j.claim_token])).result
    const authorize = async (j) =>
      (await one('select authorize_follow_up_dispatch($1,$2) result', [j.id, j.claim_token])).result
    const credits = async (s) =>
      (await one('select broadcast_credits from tenants where id=$1', [s.tenant])).broadcast_credits
    const slip = async (s, time = 'now()') =>
      db.query(`insert into slips(tenant_id,customer_id,created_at) values($1,$2,${time})`, [
        s.tenant,
        s.customer,
      ])
    const jobs = async (s) =>
      (await db.query('select status,reason from follow_up_jobs where tenant_id=$1', [s.tenant]))
        .rows
    await db.exec(fs.readFileSync('supabase/manual-follow-ups.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/manual-follow-ups.sql', 'utf8'))
    const withoutOrder = await setup(true)
    await db.query('delete from orders where id=$1', [withoutOrder.order])
    const created = (
      await db.query("select * from add_manual_follow_up($1,$2,$3,'payment',null)", [
        withoutOrder.tenant,
        owner,
        withoutOrder.customer,
      ])
    ).rows
    assert.equal(created.length, 2)
    assert.ok(created.every((j) => j.status === 'pending' && j.order_id === null))
    await db.query(
      "update follow_up_jobs set run_at=now()-interval '1 minute' where tenant_id=$1",
      [withoutOrder.tenant],
    )
    const toReview = await claim(withoutOrder)
    assert.equal((await prepare(toReview)).reason, 'ai_draft')
    await db.query("select act_follow_up_job($1,$2,$3,'approve','Checked without an order')", [
      toReview.id,
      withoutOrder.tenant,
      owner,
    ])
    await db.query(
      "update follow_up_jobs set run_at=now()+interval '1 day' where tenant_id=$1 and id<>$2",
      [withoutOrder.tenant, toReview.id],
    )
    const approvedManual = await claim(withoutOrder)
    assert.equal((await prepare(approvedManual)).status, 'ready')
    assert.equal((await authorize(approvedManual)).status, 'ready')
    assert.equal((await authorize(approvedManual)).status, 'skipped')
    // Submitting a slip immediately holds every unstarted step, without claiming payment succeeded.
    const submitted = await setup()
    await slip(submitted)
    assert.ok(
      (await jobs(submitted)).every(
        (j) => j.status === 'requires_review' && j.reason === 'slip_received',
      ),
    )
    assert.equal(
      (await one('select status from orders where id=$1', [submitted.order])).status,
      'pending_payment',
    )
    assert.equal(await claim(submitted), undefined)
    assert.equal(await credits(submitted), 100)
    // A slip arriving after prepare is caught by the second gate; reservation and lease are released.
    const late = await setup(),
      lateJob = await claim(late)
    assert.equal((await prepare(lateJob)).status, 'ready')
    assert.equal(await credits(late), 99)
    await slip(late)
    assert.equal((await authorize(lateJob)).reason, 'slip_received')
    assert.equal(await credits(late), 100)
    assert.equal(
      (
        await one('select delivery_status from messages where external_id=$1', [
          'followup:' + lateJob.id,
        ])
      ).delivery_status,
      'failed',
    )
    assert.equal(
      (await one('select outbound_lock_until from customers where id=$1', [late.customer]))
        .outbound_lock_until,
      null,
    )
    assert.equal((await authorize(lateJob)).status, 'skipped')
    assert.equal(await credits(late), 100)
    // Paid/cancelled order changes after prepare are also caught and refunded.
    for (const [status, reason] of [
      ['paid', 'paid'],
      ['cancelled', 'order_cancelled'],
    ]) {
      const s = await setup(),
        j = await claim(s)
      await prepare(j)
      await db.query('update orders set status=$2 where id=$1', [s.order, status])
      assert.equal((await authorize(j)).reason, reason)
      assert.equal(await credits(s), 100)
    }
    // Fresh opt-out, handoff, expired claim/window and master changes all cancel an already reserved delivery.
    for (const [change, reason] of [
      ['update follow_up_policies set enabled=false where tenant_id=$1', 'disabled'],
      ['update customers set followup_opted_out=true where tenant_id=$1', 'opt_out'],
      ['update customers set bot_enabled=false where tenant_id=$1', 'handover'],
      [
        "update customers set last_message_at=now()-interval '25 hours' where tenant_id=$1",
        'window_closed',
      ],
      [
        "update follow_up_jobs set claim_until=now()-interval '1 minute' where tenant_id=$1",
        'claim_expired',
      ],
      ["update follow_up_jobs set run_at=now()+interval '1 hour' where tenant_id=$1", 'not_due'],
    ]) {
      const s = await setup(),
        j = await claim(s)
      assert.equal((await prepare(j)).status, 'ready')
      await db.query(change, [s.tenant])
      assert.equal((await authorize(j)).reason, reason)
      assert.equal(await credits(s), 100)
    }
    // Historical slips and slips belonging to another tenant do not suppress a new unpaid order.
    const unpaid = await setup(),
      other = await setup()
    await slip(unpaid, "now()-interval '1 day'")
    await slip(other)
    const unpaidJob = await claim(unpaid)
    assert.equal((await prepare(unpaidJob)).status, 'ready')
    assert.equal((await authorize(unpaidJob)).status, 'ready')
    assert.equal((await authorize(unpaidJob)).status, 'skipped')
    // Detect a slip sent between order creation and a later manual confirmation.
    const manual = await setup(true)
    await db.query("update orders set created_at=now()-interval '5 minutes' where id=$1", [
      manual.order,
    ])
    await slip(manual, "now()-interval '3 minutes'")
    await db.query('select confirm_follow_up_order($1,$2,$3)', [manual.order, manual.tenant, owner])
    await db.query(
      "update follow_up_jobs set run_at=now()-interval '1 minute' where tenant_id=$1",
      [manual.tenant],
    )
    assert.equal((await prepare(await claim(manual))).reason, 'slip_received')
    // A due time changed after claiming can never dispatch early.
    const early = await setup(),
      earlyJob = await claim(early)
    await db.query("update follow_up_jobs set run_at=now()+interval '1 hour' where id=$1", [
      earlyJob.id,
    ])
    assert.equal((await prepare(earlyJob)).reason, 'not_due')
    assert.equal(await credits(early), 100)
    // The master switch synchronizes payment only, and preserves other workflow choices.
    const master = await setup()
    await db.query(
      'insert into follow_up_workflows(tenant_id,kind,enabled,steps) values($1,\'interested\',false,\'[{"delay_minutes":1,"text":"x"}]\')',
      [master.tenant],
    )
    await db.query('update follow_up_policies set enabled=false where tenant_id=$1', [
      master.tenant,
    ])
    assert.equal(
      (await one('select enabled from follow_up_workflows where id=$1', [master.workflow])).enabled,
      false,
    )
    await db.query('update follow_up_policies set enabled=true where tenant_id=$1', [master.tenant])
    assert.equal(
      (await one('select enabled from follow_up_workflows where id=$1', [master.workflow])).enabled,
      true,
    )
    assert.equal(
      (
        await one(
          "select enabled from follow_up_workflows where tenant_id=$1 and kind='interested'",
          [master.tenant],
        )
      ).enabled,
      false,
    )
    // Saving through the real versioned RPC still works with policy-trigger version changes.
    await db.query(
      'insert into follow_up_workflows(tenant_id,kind,enabled,steps) values($1,\'after_sales\',false,\'[{"delay_minutes":1,"text":"x"}]\')',
      [master.tenant],
    )
    for (const enabled of [false, true]) {
      const policy = await one('select * from follow_up_policies where tenant_id=$1', [
        master.tenant,
      ])
      policy.enabled = enabled
      const workflows = (
        await db.query('select * from follow_up_workflows where tenant_id=$1', [master.tenant])
      ).rows
      workflows.find((w) => w.kind === 'payment').enabled = enabled
      await db.query('select save_smart_follow_up($1,$2,$3,$4)', [
        master.tenant,
        owner,
        JSON.stringify(policy),
        JSON.stringify(workflows),
      ])
      assert.equal(
        (await one('select enabled from follow_up_workflows where id=$1', [master.workflow]))
          .enabled,
        enabled,
      )
    }
    assert.ok(
      (
        await one(
          "select count(*)::int n from follow_up_execution_logs where tenant_id=$1 and status='precheck_blocked' and reason='slip_received'",
          [late.tenant],
        )
      ).n > 0,
    )
    assert.ok(
      (
        await one(
          "select count(*)::int n from follow_up_execution_logs where tenant_id=$1 and status='precheck_passed' and reason='unpaid_confirmed'",
          [unpaid.tenant],
        )
      ).n > 0,
    )
    await db.exec('set role authenticated')
    await assert.rejects(authorize(unpaidJob), (e) => e.code === '42501')
    console.log(
      'PASS: immediate slip hold, real-time late slip/paid/cancel checks, reservation refunds, lease release, historical/foreign slip isolation, pre-confirmation slips, due-time changes, single master switch, durable logs, duplicate authorization and restricted RPC',
    )
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
