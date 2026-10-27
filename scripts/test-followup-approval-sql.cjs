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
    const credits = fs.readFileSync('supabase/free-message-quota.sql', 'utf8')
    await db.exec(
      credits.slice(
        credits.indexOf('create or replace function public.refresh_broadcast_credits'),
        credits.indexOf('create or replace function public.platform_update_tenant'),
      ),
    )
    for (const file of [
      'smart-follow-ups.sql',
      'smart-follow-up-presend.sql',
      'manual-follow-ups.sql',
      'follow-up-simplified.sql',
      'follow-up-step-settings.sql',
      'follow-up-24h-window.sql',
    ])
      await db.exec(fs.readFileSync('supabase/' + file, 'utf8'))
    const migration = fs.readFileSync('supabase/follow-up-approval-mode.sql', 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const owner = (await one('insert into auth.users default values returning id')).id
    const stranger = (await one('insert into auth.users default values returning id')).id
    const tenant = (await one('insert into tenants default values returning id')).id
    await db.query("insert into tenant_members values($1,$2,'owner')", [tenant, owner])
    // The minimal evidence fixture replaces broadcast-policy.sql; retain its service grant.
    await db.exec('grant all on broadcast_messaging_events to service_role;set role service_role')
    async function customer() {
      const c = (await one('insert into customers(tenant_id) values($1) returning id', [tenant])).id
      await db.query(
        "insert into broadcast_messaging_events values($1,$2,'page','inbound_message',now()-interval '1 minute')",
        [tenant, c],
      )
      return c
    }
    const mode = (value, actor = owner) =>
      one('select set_follow_up_approval_mode($1,$2,$3) r', [tenant, actor, value])
    const add = (c) =>
      one("select * from add_manual_follow_up($1,$2,$3,'payment',null)", [tenant, owner, c])
    const get = (id) => one('select * from follow_up_jobs where id=$1', [id])
    const retry = (id, actor = owner) =>
      one('select retry_rejected_follow_up($1,$2,$3) r', [id, tenant, actor])
    const prepare = async (id) => {
      await db.query("update follow_up_jobs set run_at=now()-interval '1 minute' where id=$1", [id])
      const claimed = await one('select * from claim_follow_up_jobs($1,1)', [tenant])
      assert.equal(claimed.id, id)
      const result = (await one('select prepare_follow_up($1,$2) r', [id, claimed.claim_token])).r
      return { claimed, result }
    }
    const authorize = async (j) =>
      (await one('select authorize_follow_up_dispatch($1,$2) r', [j.id, j.claim_token])).r
    const complete = async (j, status, reason, provider = null) => {
      assert.equal(
        (
          await one('select complete_follow_up($1,$2,$3,$4,$5) r', [
            j.id,
            j.claim_token,
            status,
            provider,
            reason,
          ])
        ).r,
        true,
      )
    }

    // No policy row is equivalent to Manual Review, for manual and non-AI workflows.
    const draft = await add(await customer())
    assert.equal(draft.status, 'requires_review')
    assert.equal(draft.reason, 'ai_draft')
    assert.equal(draft.ai_approved, false)
    assert.equal((await add(draft.customer_id)).id, draft.id)
    assert.equal(await one('select * from claim_follow_up_jobs($1,1)', [tenant]), undefined)
    await assert.rejects(mode('auto_approve', stranger), (e) => e.code === '42501')
    await assert.rejects(mode('invalid'), (e) => e.code === '22023')
    await mode('auto_approve')
    assert.equal(
      (await get(draft.id)).ai_approved,
      false,
      'changing mode never approves old drafts',
    )

    const automatic = async (useAi = false) => {
      const c = await customer()
      await db.query(
        "update follow_up_workflows set enabled=true,use_ai=$2 where tenant_id=$1 and kind='payment'",
        [tenant, useAi],
      )
      const o = await one(
        "insert into orders(tenant_id,customer_id,confirmed_at) values($1,$2,now()-interval '2 minutes') returning id",
        [tenant, c],
      )
      return one('select * from follow_up_jobs where order_id=$1', [o.id])
    }
    const autoJob = await automatic(true)
    assert.equal(autoJob.status, 'pending')
    assert.equal(autoJob.ai_approved, true)
    const autoReady = await prepare(autoJob.id)
    assert.equal(autoReady.result.status, 'ready')
    assert.equal((await authorize(autoReady.claimed)).status, 'ready')
    await complete(autoReady.claimed, 'sent', null, 'receipt-automatic')
    await assert.rejects(retry(autoJob.id), (e) => e.code === '40001')

    await mode('manual_review')
    const automaticDraft = await automatic()
    assert.equal(automaticDraft.status, 'requires_review')
    assert.equal(automaticDraft.reason, 'ai_draft')
    await db.query("select act_follow_up_job($1,$2,$3,'approve','Reviewed reminder')", [
      automaticDraft.id,
      tenant,
      owner,
    ])
    const approved = await prepare(automaticDraft.id)
    assert.equal(approved.result.status, 'ready')
    await complete(approved.claimed, 'sent', null, 'receipt-reviewed')

    await mode('auto_approve')
    // Automatic approval does not require enabling chatbot replies for a manual job.
    await db.query('update tenants set auto_reply_enabled=false where id=$1', [tenant])
    const manual = await add(await customer())
    assert.equal(manual.ai_approved, true)
    assert.equal(manual.status, 'pending')
    assert.equal(manual.reason, null)
    // A new setting change applies only to jobs created after it.
    await mode('manual_review')
    assert.equal((await get(manual.id)).ai_approved, true)
    const first = await prepare(manual.id)
    assert.equal(first.result.status, 'ready')
    assert.equal((await authorize(first.claimed)).status, 'ready')
    await complete(first.claimed, 'failed', 'page_restricted')
    const failed = await get(manual.id)
    assert.equal(failed.reserved_monthly + failed.reserved_topup, 0)
    await assert.rejects(retry(manual.id, stranger), (e) => e.code === '42501')
    assert.equal((await retry(manual.id)).r, 'pending')
    const reset = await get(manual.id)
    assert.equal(reset.ai_approved, true)
    assert.equal(reset.dispatch_started_at, null)
    assert.equal(reset.send_authorized_at, null)
    assert.equal(reset.message_id, null)
    const oldMessage = await one('select * from messages where id=$1', [failed.message_id])
    assert.equal(oldMessage.delivery_status, 'failed')
    assert.match(oldMessage.external_id, /:rejected:/)
    await assert.rejects(
      retry(manual.id),
      (e) => e.code === '40001',
      'double clicks never reset pending jobs',
    )
    const second = await prepare(manual.id)
    assert.equal(
      second.result.status,
      'ready',
      'old failed message must not block the new dispatch',
    )
    assert.equal((await authorize(second.claimed)).status, 'ready')
    await complete(second.claimed, 'sent', null, 'receipt-retried')
    assert.notEqual((await get(manual.id)).message_id, failed.message_id)
    await assert.rejects(retry(manual.id), (e) => e.code === '40001')

    await mode('auto_approve')
    const unknown = await add(await customer())
    const uncertain = await prepare(unknown.id)
    await complete(uncertain.claimed, 'requires_review', 'delivery_unknown')
    await assert.rejects(retry(unknown.id), (e) => e.code === '40001')

    const expired = await add(await customer())
    const expiring = await prepare(expired.id)
    await complete(expiring.claimed, 'failed', 'api_rejected')
    await db.query(
      "update broadcast_messaging_events set interacted_at=now()-interval '25 hours' where customer_id=$1",
      [expired.customer_id],
    )
    assert.equal((await retry(expired.id)).r, 'cancelled')
    assert.equal((await get(expired.id)).reason, 'outside_24h_window')

    const stopped = await add(await customer())
    await db.query('update customers set followup_opted_out=true where id=$1', [
      stopped.customer_id,
    ])
    assert.equal(
      (await get(stopped.id)).status,
      'cancelled',
      'auto approval never bypasses opt-out',
    )
    await db.exec('set role authenticated')
    await assert.rejects(
      db.query('select set_follow_up_approval_mode($1,$2,$3)', [tenant, owner, 'auto_approve']),
      (e) => e.code === '42501',
    )
    await assert.rejects(
      db.query('select retry_rejected_follow_up($1,$2,$3)', [manual.id, tenant, owner]),
      (e) => e.code === '42501',
    )
    console.log(
      'Follow-up approval/retry SQL: passed (manual + automatic creation, dispatch, mode isolation, refusal retry, window, opt-out and permissions)',
    )
  } finally {
    await db.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
