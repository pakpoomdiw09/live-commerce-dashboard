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
    await db.exec(
      "alter table tenants add column page_id text default 'page';create table broadcast_messaging_events(tenant_id uuid,customer_id uuid,page_id text,kind text,interacted_at timestamptz)",
    )
    await db.exec(fs.readFileSync('supabase/smart-inbox.sql', 'utf8'))
    const credit = fs.readFileSync('supabase/free-message-quota.sql', 'utf8')
    await db.exec(
      credit.slice(
        credit.indexOf('create or replace function public.refresh_broadcast_credits'),
        credit.indexOf('create or replace function public.platform_update_tenant'),
      ),
    )
    for (const file of [
      'smart-follow-ups.sql',
      'smart-follow-up-presend.sql',
      'manual-follow-ups.sql',
      'follow-up-simplified.sql',
      'follow-up-step-settings.sql',
      'follow-up-manual-dispatch-fix.sql',
      'follow-up-manual-dispatch-fix.sql',
      'follow-up-simplified.sql',
      'follow-up-step-settings.sql',
    ])
      await db.exec(fs.readFileSync('supabase/' + file, 'utf8'))
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const owner = (await one('insert into auth.users default values returning id')).id
    const tenant = (await one('insert into tenants default values returning id')).id
    await db.query("insert into tenant_members values($1,$2,'owner')", [tenant, owner])
    const customer = (
      await one('insert into customers(tenant_id) values($1) returning id', [tenant])
    ).id
    // No policy, no order, disabled workflow: manual enrollment still succeeds and deduplicates.
    const add = () =>
      db.query("select * from add_manual_follow_up($1,$2,$3,'payment',null)", [
        tenant,
        owner,
        customer,
      ])
    const job = (await add()).rows[0]
    assert.ok(job)
    assert.equal(job.status, 'pending')
    // The manual action does not require enabling automatic chat replies.
    await db.query('update tenants set auto_reply_enabled=false where id=$1', [tenant])
    assert.equal((await add()).rows[0].id, job.id)
    assert.equal(
      await one('select * from follow_up_policies where tenant_id=$1', [tenant]),
      undefined,
    )
    const claim = async () => one('select * from claim_follow_up_jobs($1,1)', [tenant])
    const prepare = async (j) =>
      (await one('select prepare_follow_up($1,$2) result', [j.id, j.claim_token])).result
    await db.query(
      "insert into broadcast_messaging_events values($1,$2,'page','inbound_message',now()-interval '1 minute')",
      [tenant, customer],
    )
    await db.query("update follow_up_jobs set run_at=now()-interval '1 minute' where id=$1", [
      job.id,
    ])
    const review = await claim()
    assert.equal((await prepare(review)).reason, 'ai_draft')
    await db.query("select act_follow_up_job($1,$2,$3,'approve','Manual approved reminder')", [
      job.id,
      tenant,
      owner,
    ])
    // Old quiet hours and caps cannot defer/skip this job.
    await db.query(
      'insert into follow_up_policies(tenant_id,enabled,quiet_enabled,quiet_start,quiet_end,max_per_customer,max_per_order) values($1,false,true,0,0,1,1)',
      [tenant],
    )
    await db.query(
      "insert into follow_up_jobs(tenant_id,customer_id,kind,step,text,run_at,status,dispatch_started_at) values($1,$2,'payment',1,'history',now(),'sent',now())",
      [tenant, customer],
    )
    const ready = await claim()
    assert.equal((await prepare(ready)).status, 'ready')
    assert.equal(
      (await one('select authorize_follow_up_dispatch($1,$2) r', [ready.id, ready.claim_token])).r
        .status,
      'ready',
    )
    assert.equal(
      (
        await one("select complete_follow_up($1,$2,'sent','provider-receipt',null) ok", [
          ready.id,
          ready.claim_token,
        ])
      ).ok,
      true,
    )
    const completed = await one(
      'select status,sent_at,provider_message_id,message_id from follow_up_jobs where id=$1',
      [ready.id],
    )
    assert.equal(completed.status, 'sent')
    assert.ok(completed.sent_at)
    assert.equal(completed.provider_message_id, 'provider-receipt')
    assert.equal(
      (await one('select delivery_status from messages where id=$1', [completed.message_id]))
        .delivery_status,
      'sent',
    )
    // An automatic job still respects the disabled switches.
    const automatic = await one(
      "insert into follow_up_jobs(tenant_id,customer_id,kind,workflow_id,workflow_version,step,text,run_at,source_seq,status) values($1,$2,'payment',$3,$4,1,'Automatic reminder',now()-interval '1 minute',0,'pending') returning id",
      [tenant, customer, job.workflow_id, job.workflow_version],
    )
    assert.equal((await prepare(await claim())).reason, 'disabled')
    assert.equal(
      (await one('select status from follow_up_jobs where id=$1', [automatic.id])).status,
      'cancelled',
    )
    // A new outgoing/customer summary timestamp must not extend the verified inbound window.
    await db.query("update broadcast_messaging_events set interacted_at=now()-interval '25 hours'")
    assert.equal((await one('select follow_up_window_open($1,$2) r', [tenant, customer])).r, false)
    await db.query("update broadcast_messaging_events set interacted_at=now()+interval '1 minute'")
    assert.equal((await one('select follow_up_window_open($1,$2) r', [tenant, customer])).r, false)
    await db.query("update broadcast_messaging_events set interacted_at=now()-interval '24 hours'")
    assert.equal((await one('select follow_up_window_open($1,$2) r', [tenant, customer])).r, false)
    // A single-step edit preserves the other step and all other workflows.
    const wf = await one(
      "select * from follow_up_workflows where tenant_id=$1 and kind='payment'",
      [tenant],
    )
    await db.query(
      'update follow_up_workflows set steps=\'[{"delay_minutes":2,"text":"first"},{"delay_minutes":10,"text":"second"}]\' where id=$1',
      [wf.id],
    )
    const config = JSON.stringify({ enabled: true, use_ai: false, stop_on_reply: true })
    const saved = (
      await one("select save_follow_up_workflow($1,$2,'payment',$3,0,$4,$5) r", [
        tenant,
        owner,
        wf.version,
        JSON.stringify([{ delay_minutes: 3, text: 'edited' }]),
        config,
      ])
    ).r
    assert.equal(saved.steps[0].delay_minutes, 3)
    assert.equal(saved.steps[1].text, 'second')
    await assert.rejects(
      db.query("select save_follow_up_workflow($1,$2,'payment',$3,0,$4,$5)", [
        tenant,
        owner,
        wf.version,
        JSON.stringify([{ delay_minutes: 4, text: 'stale' }]),
        config,
      ]),
      (e) => e.code === '40001',
    )
    await assert.rejects(
      db.query("select save_follow_up_workflow($1,$2,'payment',$3,0,$4,$5)", [
        tenant,
        customer,
        saved.version,
        JSON.stringify([{ delay_minutes: 4, text: 'unauthorized' }]),
        config,
      ]),
      (e) => e.code === '42501',
    )
    const lateCustomer = (
      await one('insert into customers(tenant_id) values($1) returning id', [tenant])
    ).id
    await db.query(
      "insert into broadcast_messaging_events values($1,$2,'page','inbound_message',now())",
      [tenant, lateCustomer],
    )
    const lateJob = (
      await db.query("select * from add_manual_follow_up($1,$2,$3,'payment',null)", [
        tenant,
        owner,
        lateCustomer,
      ])
    ).rows[0]
    await db.query("update follow_up_jobs set run_at=now()-interval '1 minute' where id=$1", [
      lateJob.id,
    ])
    assert.equal((await prepare(await claim())).reason, 'ai_draft')
    await db.query("select act_follow_up_job($1,$2,$3,'approve','Check late window')", [
      lateJob.id,
      tenant,
      owner,
    ])
    const lateClaim = await claim()
    assert.equal((await prepare(lateClaim)).status, 'ready')
    await db.query(
      "update broadcast_messaging_events set interacted_at=now()-interval '25 hours' where customer_id=$1",
      [lateCustomer],
    )
    const expired = (
      await one('select authorize_follow_up_dispatch($1,$2) r', [
        lateClaim.id,
        lateClaim.claim_token,
      ])
    ).r
    assert.equal(expired.reason, 'window_closed')
    assert.equal(expired.status, 'requires_review')
    // Scheduling stores an absolute instant: Bangkok and UTC sessions claim at the same moment.
    await db.exec("set time zone 'Asia/Bangkok'")
    await db.query(
      'update follow_up_workflows set steps=\'[{"delay_minutes":2,"text":"Two minute test"}]\' where id=$1',
      [wf.id],
    )
    const clockCustomer = (
      await one('insert into customers(tenant_id) values($1) returning id', [tenant])
    ).id
    const clockJob = (
      await db.query("select * from add_manual_follow_up($1,$2,$3,'payment',null)", [
        tenant,
        owner,
        clockCustomer,
      ])
    ).rows[0]
    assert.equal(
      Number(
        (
          await one(
            'select extract(epoch from (run_at-anchor_at)) elapsed from follow_up_jobs where id=$1',
            [clockJob.id],
          )
        ).elapsed,
      ),
      120,
    )
    assert.equal(await claim(), undefined)
    await db.exec("set time zone 'UTC'")
    assert.equal(await claim(), undefined)
    await db.query(
      "update follow_up_jobs set run_at=clock_timestamp()-interval '1 second' where id=$1",
      [clockJob.id],
    )
    assert.equal((await claim()).id, clockJob.id)
    await db.exec(fs.readFileSync('supabase/follow-up-worker-diagnostics.sql', 'utf8'))
    console.log(
      'PASS: migration rerun, manual enrollment without policy/order, duplicate prevention, approval, ignored quiet hours and caps, verified 24h boundary/future timestamps, per-step persistence, conflict and authorization',
    )
  } finally {
    await db.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
