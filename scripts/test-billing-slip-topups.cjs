// Isolated PostgreSQL fixture; never reads .env or connects to live services.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite')
const sql = (name) => readFileSync(join(__dirname, '../supabase', name), 'utf8')
const ts = require('typescript')
const catalog = { exports: {} }
new Function(
  'exports',
  ts.transpileModule(readFileSync(join(__dirname, '../lib/features/billing/plans.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(catalog.exports)
for (const [id, price, credits, slip] of [
  ['topup_s', 100, 400, false],
  ['topup_m', 300, 1500, false],
  ['topup_l', 500, 3000, false],
  ['slip_topup_s', 100, 500, true],
  ['slip_topup_m', 300, 2000, true],
  ['slip_topup_l', 600, 5000, true],
]) {
  assert.equal(catalog.exports.BILLING_ITEMS[id].price, price)
  assert.equal(catalog.exports.BILLING_ITEMS[id].credits, credits)
  assert.equal(catalog.exports.isTopup(id), true) // both groups use the API's paid-plan gate
  assert.equal(catalog.exports.isSlipTopup(id), slip)
  assert.equal(catalog.exports.billingUnit(id), slip ? 'รายการตรวจสลิป' : 'ข้อความบรอดแคสต์')
}
async function main() {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, raw_app_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table tenants(id uuid primary key default gen_random_uuid(), slip_quota integer default 2, slip_used integer default 0);
      create table platform_admins(user_id uuid);
      create table tenant_members(tenant_id uuid, user_id uuid, role text);
      create table bot_settings(tenant_id uuid, reply_mode text);
      create table slips(id uuid primary key, status text, trans_ref text);
      create function consume_slip_credit(p_tenant uuid) returns boolean language sql as $$
        with taken as (update tenants set slip_used=slip_used+1 where id=p_tenant and slip_used<slip_quota returning 1)
        select exists(select 1 from taken)$$;
      create function refund_slip_credit(p_tenant uuid) returns void language sql as $$
        update tenants set slip_used=slip_used-1 where id=p_tenant and slip_used>0$$;
    `)
    // Start with the old approval implementation, including an existing admin wrapper.
    let legacy = sql('billing.sql').replace(/^do \$\$ begin alter publication.*$/gm, '')
    legacy = legacy.replace(
      /    if r.item in \('slip_topup_s'[\s\S]*?    end if;/,
      '    update tenants set broadcast_topup_credits = broadcast_topup_credits + r.credits where id = r.tenant_id;',
    )
    await db.exec(legacy)
    await db.exec(sql('payments.sql'))
    await db.exec(sql('admin-feature-bypass.sql'))
    await db.exec(sql('billing-slip-topups.sql'))
    await db.exec(sql('billing-slip-topups.sql'))
    const tenant = (
      await db.query("insert into tenants(plan,slip_used) values ('starter',2) returning id")
    ).rows[0].id
    const balance = async () =>
      (
        await db.query(
          'select broadcast_credits,broadcast_topup_credits,slip_quota_credits,slip_used from tenants where id=$1',
          [tenant],
        )
      ).rows[0]
    const buy = async (item, price, credits) =>
      (
        await db.query(
          'insert into billing_requests(tenant_id,item,price_baht,credits) values ($1,$2,$3,$4) returning id',
          [tenant, item, price, credits],
        )
      ).rows[0].id
    const approve = async (id) =>
      (await db.query('select approve_billing_request($1,null) as result', [id])).rows[0].result
    for (const [item, price, credits] of [
      ['slip_topup_s', 100, 500],
      ['slip_topup_m', 300, 2000],
      ['slip_topup_l', 600, 5000],
    ]) {
      const before = await balance(),
        id = await buy(item, price, credits)
      assert.equal(await approve(id), null)
      const after = await balance()
      assert.equal(after.slip_quota_credits, before.slip_quota_credits + credits)
      assert.equal(after.broadcast_credits, before.broadcast_credits)
      assert.equal(after.broadcast_topup_credits, before.broadcast_topup_credits)
      assert.equal(await approve(id), null)
      assert.deepEqual(await balance(), after)
    }
    for (const [item, price, credits] of [
      ['topup_s', 100, 400],
      ['topup_m', 300, 1500],
      ['topup_l', 500, 3000],
    ]) {
      const before = await balance()
      assert.equal(await approve(await buy(item, price, credits)), null)
      const after = await balance()
      assert.equal(after.broadcast_topup_credits, before.broadcast_topup_credits + credits)
      assert.equal(after.slip_quota_credits, before.slip_quota_credits)
    }
    await db.query('update tenants set slip_used=slip_quota+slip_quota_credits-1 where id=$1', [
      tenant,
    ])
    const consume = async () =>
      (await db.query('select consume_slip_credit($1) as ok', [tenant])).rows[0].ok
    assert.equal(await consume(), true)
    assert.equal(await consume(), false)
    await db.query('select refund_slip_credit($1)', [tenant])
    assert.equal(await consume(), true)
    const beforeRerun = await balance()
    await db.exec(sql('billing-slip-topups.sql'))
    await db.exec(sql('admin-feature-bypass.sql'))
    assert.deepEqual(await balance(), beforeRerun)
    assert.equal(await consume(), false)
    const free = (await db.query('insert into tenants default values returning id')).rows[0].id
    const blocked = (
      await db.query(
        "insert into billing_requests(tenant_id,item,price_baht,credits) values ($1,'slip_topup_s',100,500) returning id",
        [free],
      )
    ).rows[0].id
    assert.equal(await approve(blocked), null)
    console.log(
      'PASS: separate approval balances, duplicate approvals, slip exhaustion/refund, migration reruns and Free-plan gate',
    )
  } finally {
    await db.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
