// Real PostgreSQL sandbox: never loads .env, calls AI, sends Messenger or touches Supabase.
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
    fixture = fixture
      .replace(
        "name text default 'Shop',",
        "name text default 'Shop',slip_quota integer default 10,slip_used integer default 0,slip_quota_credits integer default 0,",
      )
      .replace(
        "reply_mode text default 'keyword',",
        "reply_mode text default 'keyword',ai_instructions text,",
      )
    await db.exec(fixture)
    await db.exec(
      'create table comments(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));create table image_response_rules(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));',
    )
    const sql = (name) => fs.readFileSync('supabase/' + name, 'utf8')
    await db.exec(sql('feature-access.sql'))
    await db.exec(sql('smart-inbox.sql'))
    await db.exec(sql('smart-follow-ups.sql'))
    const one = async (query, args = []) => (await db.query(query, args)).rows[0]
    const owner = (await one('insert into auth.users default values returning id')).id,
      staff = (await one('insert into auth.users default values returning id')).id
    const legacy = (await one('insert into tenants default values returning id')).id
    await db.query(
      "insert into bot_settings(tenant_id,ai_instructions) values($1,'Original prompt')",
      [legacy],
    )
    const migration = sql('agent-control.sql')
    await db.exec(migration)
    await db.exec(migration)
    assert.equal(
      (await one('select count(*)::int n from agent_prompt_versions where tenant_id=$1', [legacy]))
        .n,
      1,
    )
    assert.equal(
      (await one('select ai_instructions from bot_settings where tenant_id=$1', [legacy]))
        .ai_instructions,
      'Original prompt',
    )
    checks++
    const flags = {
      agent_control_center_enabled: true,
      agent_orchestrator_enabled: true,
      agent_knowledge_base_enabled: true,
      agent_playground_enabled: true,
      agent_analytics_enabled: true,
      agent_advanced_guardrails_enabled: true,
    }
    async function setup(plan = 'pro', limit = 2, rate = 10) {
      const tenant = (await one('insert into tenants(plan) values($1) returning id', [plan])).id
      await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')", [
        tenant,
        owner,
        staff,
      ])
      await db.query(
        'insert into agent_control_settings(tenant_id,flags,ai_monthly_limit,requests_per_minute) values($1,$2,$3,$4)',
        [tenant, JSON.stringify(flags), limit, rate],
      )
      await db.query("insert into bot_settings(tenant_id,reply_mode) values($1,'keyword')", [
        tenant,
      ])
      await db.query('insert into follow_up_policies(tenant_id,enabled) values($1,true)', [tenant])
      await db.query(
        'insert into follow_up_workflows(tenant_id,kind,enabled,steps) values($1,\'payment\',true,\'[{"delay_minutes":1,"text":"Please pay"}]\')',
        [tenant],
      )
      const customer = (
        await one('insert into customers(tenant_id) values($1) returning id', [tenant])
      ).id
      const message = (
        await one(
          "insert into messages(customer_id,sender,body,external_id) values($1,'customer','hello',$2) returning id",
          [customer, crypto.randomUUID()],
        )
      ).id
      const order = (
        await one(
          'insert into orders(tenant_id,customer_id,message_id) values($1,$2,$3) returning id',
          [tenant, customer, message],
        )
      ).id
      return { tenant, customer, message, order }
    }
    const claim = async (s) =>
      one('select * from claim_agent_message($1,$2,$3)', [s.tenant, s.customer, s.message])
    const invocation = async (s, job = null, key = crypto.randomUUID()) =>
      (
        await one('select start_agent_ai_call($1,$2,$3,$4,$5) result', [
          s.tenant,
          key,
          s.customer,
          job?.id ?? null,
          job?.claim_token ?? null,
        ])
      ).result
    const used = async (s) =>
      (
        await one(
          'select coalesce(sum(used),0)::int n from agent_ai_monthly_usage where tenant_id=$1',
          [s.tenant],
        )
      ).n
    const dispatch = async (j) =>
      (await one('select begin_agent_dispatch($1,$2) ok', [j.id, j.claim_token])).ok
    await db.exec('set role service_role')
    const s = await setup(),
      j = await claim(s)
    assert.ok(j)
    assert.equal(await claim(s), undefined)
    const requestKey = crypto.randomUUID(),
      ticket = await invocation(s, j, requestKey)
    assert.ok(ticket.id)
    assert.equal((await invocation(s, j, requestKey)).reason, 'DUPLICATE_AI_INVOCATION')
    assert.equal(await used(s), 1)
    checks++
    await db.query("update agent_message_jobs set route='AI' where id=$1", [j.id])
    assert.equal(await dispatch(j), true)
    assert.equal(await dispatch(j), false)
    checks++
    for (const plan of ['free', 'starter']) {
      const free = await setup(plan)
      assert.equal((await invocation(free)).reason, 'FEATURE_LOCKED')
      assert.equal(await used(free), 0)
      assert.ok(await claim(free))
      checks++
    }
    const expired = await setup()
    await db.query("update tenants set plan_expires_at=now()-interval '1 second' where id=$1", [
      expired.tenant,
    ])
    assert.equal((await invocation(expired)).reason, 'FEATURE_LOCKED')
    assert.equal(await used(expired), 0)
    checks++
    const zero = await setup('pro', 0)
    assert.equal((await invocation(zero)).reason, 'AI_QUOTA_EXHAUSTED')
    assert.equal(await used(zero), 0)
    checks++
    const quota = await setup()
    assert.ok((await invocation(quota)).id)
    assert.ok((await invocation(quota)).id)
    assert.equal((await invocation(quota)).reason, 'AI_QUOTA_EXHAUSTED')
    assert.equal(await used(quota), 2)
    checks++
    const rate = await setup('pro', 10, 1)
    assert.ok((await invocation(rate)).id)
    assert.equal((await invocation(rate)).reason, 'AI_RATE_LIMIT')
    assert.equal(await used(rate), 1)
    checks++
    const pending = await setup(),
      p = await claim(pending)
    const newMessage = (
      await one(
        "insert into messages(customer_id,sender,body) values($1,'customer','second message') returning id",
        [pending.customer],
      )
    ).id
    assert.equal(await dispatch(p), false)
    assert.equal((await invocation(pending, p)).reason, 'CONVERSATION_CHANGED')
    assert.ok(await claim({ ...pending, message: newMessage }))
    checks++
    const human = await setup(),
      h = await claim(human),
      version = (
        await one('select conversation_version from customers where id=$1', [human.customer])
      ).conversation_version
    await db.query("select manage_inbox_conversation($1,$2,'claim',$3,null)", [
      human.customer,
      owner,
      version,
    ])
    assert.equal(await dispatch(h), false)
    assert.equal((await invocation(human, h)).reason, 'CONVERSATION_CHANGED')
    assert.equal(
      (await one('select status from follow_up_jobs where order_id=$1', [human.order])).status,
      'cancelled',
    )
    checks++
    const opt = await setup()
    await db.query("insert into messages(customer_id,sender,body) values($1,'customer','STOP')", [
      opt.customer,
    ])
    assert.equal(
      (await one('select agent_opted_out from customers where id=$1', [opt.customer]))
        .agent_opted_out,
      true,
    )
    await assert.rejects(
      db.query('update customers set bot_enabled=true where id=$1', [opt.customer]),
      (e) => e.code === '42501',
    )
    assert.equal(await claim(opt), undefined)
    assert.equal((await invocation(opt)).reason, 'CUSTOMER_UNAVAILABLE')
    assert.equal(
      (await one('select status from follow_up_jobs where order_id=$1', [opt.order])).status,
      'cancelled',
    )
    await db.query("insert into messages(customer_id,sender,body) values($1,'customer','START')", [
      opt.customer,
    ])
    assert.equal(
      (await one('select agent_opted_out,bot_enabled from customers where id=$1', [opt.customer]))
        .agent_opted_out,
      false,
    )
    assert.equal(
      (await one('select bot_enabled from customers where id=$1', [opt.customer])).bot_enabled,
      false,
    )
    checks++
    const foreign = await setup()
    assert.equal(await claim({ ...foreign, customer: s.customer, message: s.message }), undefined)
    assert.equal(
      (await invocation({ ...foreign, customer: s.customer })).reason,
      'CUSTOMER_UNAVAILABLE',
    )
    assert.equal(await used(foreign), 0)
    checks++
    const knowledge = {
      kind: 'shipping',
      title: 'Shipping',
      content: 'Delivery fee 50 THB',
      is_active: true,
    }
    const kid = (
      await one("select manage_agent_knowledge($1,$2,'save',null,$3) id", [
        s.tenant,
        owner,
        JSON.stringify(knowledge),
      ])
    ).id
    await assert.rejects(
      db.query("select manage_agent_knowledge($1,$2,'save',null,$3)", [
        s.tenant,
        staff,
        JSON.stringify(knowledge),
      ]),
      (e) => e.code === '42501',
    )
    await assert.rejects(
      db.query("select manage_agent_knowledge($1,$2,'save',$3,$4)", [
        foreign.tenant,
        owner,
        kid,
        JSON.stringify(knowledge),
      ]),
      (e) => e.code === 'P0002',
    )
    checks++
    await db.query("select manage_agent_knowledge($1,$2,'save',$3,$4)", [
      s.tenant,
      owner,
      kid,
      JSON.stringify({ ...knowledge, is_active: false }),
    ])
    assert.equal(
      (await one('select is_active from agent_knowledge_sources where id=$1', [kid])).is_active,
      false,
    )
    await db.query("select manage_agent_knowledge($1,$2,'delete',$3,'{}')", [s.tenant, owner, kid])
    assert.equal(
      (await one('select count(*)::int n from agent_knowledge_sources where id=$1', [kid])).n,
      0,
    )
    assert.equal(
      (
        await one(
          "select count(*)::int n from agent_control_audit where tenant_id=$1 and event like 'knowledge_%' and actor_id=$2",
          [s.tenant, owner],
        )
      ).n,
      3,
    )
    checks++
    await db.query("select save_agent_prompt($1,$2,'Prompt A')", [s.tenant, owner])
    await db.query("select save_agent_prompt($1,$2,'Prompt B')", [s.tenant, owner])
    const versions = (
      await db.query('select * from agent_prompt_versions where tenant_id=$1 order by version', [
        s.tenant,
      ])
    ).rows
    const va = versions.find((v) => v.instructions === 'Prompt A')
    await db.query('select restore_agent_prompt($1,$2,$3)', [s.tenant, owner, va.version])
    assert.equal(
      (await one('select ai_instructions from bot_settings where tenant_id=$1', [s.tenant]))
        .ai_instructions,
      'Prompt A',
    )
    assert.equal(
      (
        await one(
          'select actor_id from agent_prompt_versions where tenant_id=$1 order by version desc limit 1',
          [s.tenant],
        )
      ).actor_id,
      owner,
    )
    assert.ok(
      (
        await one('select count(*)::int n from agent_prompt_versions where tenant_id=$1', [
          s.tenant,
        ])
      ).n > versions.length,
    )
    await assert.rejects(
      db.query("select save_agent_prompt($1,$2,'Bad')", [s.tenant, staff]),
      (e) => e.code === '42501',
    )
    checks++
    const restart = await setup(),
      r = await claim(restart)
    const started = await invocation(restart, r)
    assert.ok(started.id)
    await db.query(
      "update agent_message_jobs set claim_until=now()-interval '1 minute' where id=$1",
      [r.id],
    )
    assert.equal((await one('select recover_agent_jobs() n')).n, 1)
    assert.equal(
      (await one('select status from agent_message_jobs where id=$1', [r.id])).status,
      'review',
    )
    assert.equal(
      (await one('select status from agent_ai_usage where id=$1', [started.id])).status,
      'review',
    )
    assert.equal(await claim(restart), undefined)
    assert.equal(await used(restart), 1)
    checks++
    const disabled = await setup()
    await db.query("update agent_control_settings set flags='{}' where tenant_id=$1", [
      disabled.tenant,
    ])
    assert.equal(await claim(disabled), undefined)
    assert.equal((await invocation(disabled)).reason, 'ORCHESTRATOR_DISABLED')
    checks++
    await db.exec('reset role')
    await db.query("select set_config('test.user',$1,false)", [owner])
    await db.exec('set role authenticated')
    assert.ok(
      (await db.query('select id from agent_message_jobs where tenant_id=$1', [s.tenant])).rows
        .length,
    )
    await assert.rejects(
      db.query('select claim_token from agent_message_jobs'),
      /permission denied/,
    )
    await assert.rejects(
      db.query('select instructions from agent_prompt_versions'),
      /permission denied/,
    )
    await assert.rejects(db.query('select recover_agent_jobs()'), /permission denied/)
    await assert.rejects(db.query('update agent_ai_monthly_usage set used=0'), /permission denied/)
    await assert.rejects(
      db.query("update agent_control_settings set flags='{}'"),
      /permission denied/,
    )
    checks++
    await db.query("select set_config('test.user',$1,false)", [
      '99999999-9999-4999-8999-999999999999',
    ])
    assert.equal((await db.query('select id from agent_message_jobs')).rows.length, 0)
    checks++
    await db.exec('reset role')
    await db.exec(migration)
    assert.equal(
      (
        await one('select ai_monthly_limit from agent_control_settings where tenant_id=$1', [
          quota.tenant,
        ])
      ).ai_monthly_limit,
      2,
    )
    assert.equal(await used(quota), 2)
    checks++
    await db.exec(sql('agent-control-rollback.sql'))
    assert.equal(await used(quota), 2)
    assert.equal(
      (
        await one('select ai_monthly_limit from agent_control_settings where tenant_id=$1', [
          quota.tenant,
        ])
      ).ai_monthly_limit,
      2,
    )
    assert.ok(
      (
        await one('select count(*)::int n from agent_prompt_versions where tenant_id=$1', [
          s.tenant,
        ])
      ).n > 0,
    )
    assert.equal(
      (
        await one(
          "select flags->>'agent_orchestrator_enabled' enabled from agent_control_settings where tenant_id=$1",
          [quota.tenant],
        )
      ).enabled,
      'false',
    )
    checks++
    console.log(
      `PASS: ${checks} PostgreSQL Agent Control scenarios: real package gates, prompt versions, atomic knowledge/audit, quotas, rate limits, idempotency, concurrent messages, Inbox ownership, opt-out, follow-up cancellation, restart, tenant isolation, restricted columns and safe reruns`,
    )
  } finally {
    await db.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
