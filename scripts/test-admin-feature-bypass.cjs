// Isolated PostgreSQL tests; no live auth, .env, payments or messaging.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite')
async function main() {
  const db = new PGlite()
  const sql = (name) => readFileSync(join(__dirname, '../supabase', name), 'utf8')
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key default gen_random_uuid(), raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
      create table tenants(id uuid primary key default gen_random_uuid(), slip_quota integer default 2, slip_used integer default 0);
      create table platform_admins(user_id uuid primary key references auth.users(id));
      create table tenant_members(tenant_id uuid references tenants(id), user_id uuid references auth.users(id), role text);
      create table slips(id uuid primary key default gen_random_uuid(), status text, trans_ref text);
      create table bot_settings(tenant_id uuid primary key references tenants(id), reply_mode text);
      create function consume_slip_credit(p_tenant uuid) returns boolean language sql as $$
        with taken as (update tenants set slip_used=slip_used+1 where id=p_tenant and slip_used<slip_quota returning 1)
        select exists(select 1 from taken)$$;
      create function refund_slip_credit(p_tenant uuid) returns void language sql as $$
        update tenants set slip_used=slip_used-1 where id=p_tenant and slip_used>0$$;
      grant usage on schema public to service_role, authenticated;
      grant all on tenants, slips, bot_settings to service_role;
      grant all on bot_settings to authenticated;
    `)
    await db.exec(sql('billing.sql').replace(/^do \$\$ begin alter publication.*$/gm, ''))
    await db.exec(sql('payments.sql'))
    await db.exec(sql('ai-agent-gate.sql'))
    await db.exec(sql('admin-feature-bypass.sql'))
    await db.exec(sql('admin-feature-bypass.sql'))
    const user = async (app = {}, meta = {}) =>
      (
        await db.query(
          'insert into auth.users(raw_app_meta_data,raw_user_meta_data) values ($1,$2) returning id',
          [app, meta],
        )
      ).rows[0].id
    const regular = await user({}, { role: 'superadmin' })
    const admin = await user({ role: 'admin' })
    const superadmin = await user({ role: 'superadmin' })
    const tableAdmin = await user()
    await db.query('insert into platform_admins values ($1)', [tableAdmin])
    const tenant = async () =>
      (await db.query('insert into tenants default values returning id')).rows[0].id
    const customerShop = await tenant()
    const adminShop = await tenant()
    await db.query("insert into tenant_members values ($1,$2,'owner'),($3,$4,'owner')", [
      customerShop,
      regular,
      adminShop,
      admin,
    ])
    async function identity(id = '') {
      await db.query("select set_config('test.user_id',$1,false)", [id])
    }
    const isAdmin = async () =>
      (await db.query('select is_platform_admin() as value')).rows[0].value
    await identity(regular)
    assert.equal(await isAdmin(), false) // self-editable metadata cannot grant privileges
    for (const id of [admin, superadmin]) {
      await identity(id)
      assert.equal(await isAdmin(), false)
    }
    await db.query('insert into platform_admins values ($1),($2)', [admin, superadmin])
    for (const id of [admin, superadmin, tableAdmin]) {
      await identity(id)
      assert.equal(await isAdmin(), true)
    }
    await identity()
    await db.exec('set role service_role')
    assert.equal(
      (await db.query('select tenant_has_feature_bypass($1) as value', [customerShop])).rows[0]
        .value,
      false,
    )
    assert.equal(
      (await db.query('select tenant_has_feature_bypass($1) as value', [adminShop])).rows[0].value,
      true,
    )
    const consume = async (id) =>
      (await db.query('select consume_slip_credit($1) as value', [id])).rows[0].value
    assert.equal(await consume(customerShop), true)
    assert.equal(await consume(customerShop), true)
    assert.equal(await consume(customerShop), false)
    for (let i = 0; i < 4; i++) assert.equal(await consume(adminShop), true)
    await db.query('select refund_slip_credit($1)', [adminShop])
    assert.equal(
      (await db.query('select slip_used from tenants where id=$1', [adminShop])).rows[0].slip_used,
      0,
    )
    const reserve = async (id) =>
      (await db.query('select * from reserve_broadcast_credits($1,999)', [id])).rows[0]
    assert.deepEqual(await reserve(customerShop), { monthly: 200, topup: 0 })
    assert.deepEqual(await reserve(customerShop), { monthly: 0, topup: 0 })
    assert.deepEqual(await reserve(adminShop), { monthly: 999, topup: 0 })
    await db.query('select refund_broadcast_credits($1,999,999)', [adminShop])
    assert.equal(
      (await db.query('select broadcast_credits from tenants where id=$1', [adminShop])).rows[0]
        .broadcast_credits,
      200,
    )
    await db.query("insert into bot_settings values ($1,'ai')", [customerShop])
    await db.query('delete from bot_settings where tenant_id=$1', [customerShop])
    await db.query("insert into bot_settings values ($1,'ai')", [adminShop])
    // Signed-in admin may operate a customer shop without deducting its credits.
    await identity(superadmin)
    assert.equal(await consume(customerShop), true)
    assert.deepEqual(await reserve(customerShop), { monthly: 999, topup: 0 })
    await db.query("insert into bot_settings values ($1,'ai')", [customerShop])
    await db.exec('reset role')
    await identity(regular)
    await db.exec('set role authenticated')
    await assert.rejects(
      db.query('select consume_slip_credit($1)', [customerShop]),
      /permission denied/,
    )
    await assert.rejects(
      db.query('select consume_slip_credit_metered($1)', [customerShop]),
      /permission denied/,
    )
    await db.query("update bot_settings set reply_mode='ai' where tenant_id=$1", [customerShop])
    await db.exec('reset role')
    // Reinstalling upstream billing then bypass safely recaptures the metered implementation.
    await db.exec(sql('billing.sql').replace(/^do \$\$ begin alter publication.*$/gm, ''))
    await db.exec(sql('payments.sql'))
    await db.exec(sql('admin-feature-bypass.sql'))
    await identity()
    assert.deepEqual(await reserve(adminShop), { monthly: 999, topup: 0 })
    await db.exec(
      "alter table bot_settings add column followup_enabled boolean default false; alter table bot_settings add column followup_steps jsonb default '[]';",
    )
    await db.exec(sql('followup-plan-gate.sql'))
    await db.exec(sql('followup-plan-gate.sql'))
    await db.query("update bot_settings set reply_mode='keyword' where tenant_id=$1", [
      customerShop,
    ])
    await assert.rejects(
      db.query('update bot_settings set followup_enabled=true where tenant_id=$1', [customerShop]),
      /อัปเกรด/,
    )
    await db.query('update bot_settings set followup_enabled=true where tenant_id=$1', [adminShop])
    await db.query(
      "update tenants set plan='starter', plan_expires_at=now()+interval '1 day' where id=$1",
      [customerShop],
    )
    await db.query('update bot_settings set followup_enabled=true where tenant_id=$1', [
      customerShop,
    ])
    await db.query("update tenants set plan_expires_at=now()-interval '1 day' where id=$1", [
      customerShop,
    ])
    await assert.rejects(
      db.query('update bot_settings set followup_enabled=true where tenant_id=$1', [customerShop]),
      /อัปเกรด/,
    )
    await identity(superadmin)
    await db.query('update bot_settings set followup_enabled=true where tenant_id=$1', [
      customerShop,
    ])
    console.log(
      'Admin bypass passed: trusted roles, metadata spoof rejected, customer metering, admin no charges/refunds, AI gates, permissions, reruns.',
    )
  } finally {
    await db.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
