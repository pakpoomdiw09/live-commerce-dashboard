const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const load = require('./helpers/load-typescript.cjs')
const flag = load('lib/full-access.ts')
const read = (name) => fs.readFileSync('supabase/' + name, 'utf8')
function definition(file, name) {
  const pattern = new RegExp(
    'create or replace function (?:public\\.)?' + name + '\\b[\\s\\S]*?\\$\\$;',
    'i',
  )
  const match = read(file).match(pattern)
  assert.ok(match, name)
  return match[0]
}

test('temporary mode unlocks client helpers and exhausted capability entitlements', () => {
  assert.equal(flag.temporaryFullAccess, true)
  const deps = { '@/lib/full-access': flag }
  const plans = load('lib/features/billing/plans.ts', deps)
  const billing = { plan: 'free', planExpiresAt: null }
  assert.equal(plans.canUseAiAgent(billing), true)
  assert.equal(plans.canUseFollowUps(billing), true)
  assert.equal(plans.canUseAutoSlip(billing, 0), true)
  const core = load('lib/features/agents/agent-overview-core.ts', deps)
  const entitlements = core.agentCapabilityEntitlements(
    { ai: false, slips: false, followup: false },
    0,
    0,
  )
  assert.ok(Object.values(entitlements).every((value) => value.allowed && value.code === null))
})

test('server feature helpers bypass package and slip balances but reject inactive or absent shops', async () => {
  const access = load('lib/feature-access.ts', {
    'server-only': {},
    'next/server': {},
    '@/lib/full-access': flag,
  })
  for (const active of [true, false]) {
    const query = {
      select() {
        return this
      },
      eq() {
        return this
      },
      async maybeSingle() {
        return { data: active ? { id: 'shop' } : null, error: null }
      },
    }
    const db = {
      from: () => query,
      rpc() {
        throw Error('Package lookup must be bypassed')
      },
    }
    assert.equal(await access.hasFeature(db, 'shop', 'ai_agent'), active)
    assert.equal(await access.hasSlipAccess(db, 'shop'), active)
  }
})

test('SQL bypass unlocks real reads and usage, preserves isolation and restores installed definitions', async () => {
  const db = new PGlite()
  try {
    let fixture = fs
      .readFileSync('scripts/test-smart-followups-sql.cjs', 'utf8')
      .split('await db.exec(`')[1]
      .split('`)')[0]
    fixture = fixture
      .replace(
        "name text default 'Shop',",
        "name text default 'Shop',auto_verify_enabled boolean default false,slip_quota integer default 0,slip_used integer default 0,slip_quota_credits integer default 0,",
      )
      .replace(
        "reply_mode text default 'keyword',",
        "reply_mode text default 'keyword',ai_instructions text,",
      )
    await db.exec(fixture)
    await db.exec(`create function is_platform_admin() returns boolean language sql as $$select false$$;
      create function tenant_has_feature_bypass(uuid) returns boolean language sql as $$select false$$;
      create table comments(id uuid primary key,tenant_id uuid);
      create table image_response_rules(id uuid primary key,tenant_id uuid);
      create table bank_accounts(tenant_id uuid,is_active boolean default true);
      create table chat_rules(id uuid primary key default gen_random_uuid(),tenant_id uuid);
      create table commerce_limits(plan text,max_products integer,max_pages integer,checkout boolean,reports boolean,advanced_templates boolean);
      insert into commerce_limits values('free',null,1,false,false,false),('pro',null,10,true,true,true);
      create table billing_requests(id uuid primary key default gen_random_uuid(),tenant_id uuid,item text,status text,price_baht integer);`)
    for (const name of [
      'feature-access.sql',
      'smart-inbox.sql',
      'smart-follow-ups.sql',
      'agent-control.sql',
      'ai-paid-access.sql',
      'agent-overview.sql',
      'keyword-reply-limits.sql',
      'followup-plan-gate.sql',
      'ai-vision.sql',
    ])
      await db.exec(read(name))
    await db.exec(definition('commerce-v2.sql', 'commerce_plan'))
    await db.exec(definition('free-message-quota.sql', 'reserve_broadcast_credits'))
    await db.exec(definition('free-message-quota.sql', 'refund_broadcast_credits'))
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const tenant = (
      await one(
        "insert into tenants(plan,plan_expires_at) values('free',now()-interval '1 day') returning id",
      )
    ).id
    const inactive = (
      await one("insert into tenants(plan,is_active) values('pro',false) returning id")
    ).id
    const owner = (await one('insert into auth.users default values returning id')).id
    await db.query("insert into tenant_members values($1,$2,'owner')", [tenant, owner])
    await db.query('insert into agent_control_settings(tenant_id,ai_monthly_limit) values($1,0)', [
      tenant,
    ])
    assert.equal(
      (await one("select has_tenant_feature($1,'ai_agent') allowed", [tenant])).allowed,
      false,
    )
    // Production may have a different function body, not just different spacing.
    // Installation must not inspect or search the old implementation.
    await db.exec(`create or replace function public.set_agent_overview_capability(
      p_tenant uuid,p_actor uuid,p_capability text,p_enabled boolean
    ) returns void language plpgsql set search_path=pg_catalog,public as $$
    begin
      raise exception 'LEGACY_QUOTA_IMPLEMENTATION';
    end $$;`)
    const activation = read('full-access.sql')
    assert.ok(
      !/pg_temp|full_access_replace|\bexecute\b\s+(body|definition)|\breplace\s*\(|\bstrpos\s*\(/i.test(
        activation,
      ),
    )
    await db.exec(activation)
    await db.exec(activation) // Rerunning never captures the bypass as the backup.
    for (const feature of [
      'ai_agent',
      'slip_auto_pilot',
      'customer_management',
      'customer_follow_up',
      'image_assistant',
    ]) {
      assert.equal(
        (await one('select has_tenant_feature($1,$2) allowed', [tenant, feature])).allowed,
        true,
      )
      assert.equal(
        (await one('select has_tenant_feature($1,$2) allowed', [inactive, feature])).allowed,
        false,
      )
    }
    assert.equal(
      (await one("select has_tenant_feature($1,'unknown') allowed", [tenant])).allowed,
      false,
    )
    assert.equal((await one('select consume_slip_credit($1) allowed', [tenant])).allowed, true)
    assert.equal((await one('select slip_used from tenants where id=$1', [tenant])).slip_used, 1)
    assert.equal((await one('select consume_slip_credit($1) allowed', [inactive])).allowed, false)
    const before = await one(
      'select broadcast_credits,broadcast_topup_credits,plan,plan_expires_at from tenants where id=$1',
      [tenant],
    )
    assert.equal(
      (await one('select * from reserve_broadcast_credits($1,10000)', [tenant])).monthly,
      10000,
    )
    await db.query('select refund_broadcast_credits($1,10000,0)', [tenant])
    assert.deepEqual(
      await one(
        'select broadcast_credits,broadcast_topup_credits,plan,plan_expires_at from tenants where id=$1',
        [tenant],
      ),
      before,
    )
    const key = randomUUID()
    assert.ok((await one('select start_agent_ai_call($1,$2) result', [tenant, key])).result.id)
    assert.equal(
      (await one('select start_agent_ai_call($1,$2) result', [tenant, key])).result.reason,
      'DUPLICATE_AI_INVOCATION',
    )
    assert.equal(
      (
        await one('select start_agent_ai_call($1,$2,$3) result', [
          tenant,
          randomUUID(),
          randomUUID(),
        ])
      ).result.reason,
      'CUSTOMER_UNAVAILABLE',
    )
    await db.query('select set_agent_overview_capability($1,$2,$3,true)', [tenant, owner, 'master'])
    await assert.rejects(
      db.query('select set_agent_overview_capability($1,$2,$3,true)', [
        tenant,
        randomUUID(),
        'master',
      ]),
      (e) => e.code === '42501',
    )
    assert.equal(
      (await one('select (commerce_plan($1)).advanced_templates allowed', [tenant])).allowed,
      true,
    )
    assert.equal(
      (
        await one(
          "select has_function_privilege('authenticated','start_agent_ai_call(uuid,uuid,uuid,uuid,uuid)','execute') allowed",
        )
      ).allowed,
      false,
    )
    await db.query('update agent_control_settings set requests_per_minute=1 where tenant_id=$1', [
      tenant,
    ])
    assert.equal(
      (await one('select start_agent_ai_call($1,$2) result', [tenant, randomUUID()])).result.reason,
      'AI_RATE_LIMIT',
    )
    await db.exec(read('full-access-rollback.sql'))
    assert.equal(
      (await one("select has_tenant_feature($1,'ai_agent') allowed", [tenant])).allowed,
      false,
    )
    assert.equal(
      (
        await one(
          'select bool_and(pg_get_functiondef(signature::regprocedure)=definition) restored from full_access_function_backup',
        )
      ).restored,
      true,
    )
  } finally {
    await db.close()
  }
})
