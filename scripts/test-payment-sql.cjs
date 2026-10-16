// Run: node scripts/test-payment-sql.cjs <path-to-@electric-sql/pglite>
// Isolated PostgreSQL fixture; never reads .env or contacts Supabase/SlipOK.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite')

async function main() {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create table public.tenants (id uuid primary key default gen_random_uuid(), is_active boolean default true, slip_quota integer default 500, slip_used integer default 0);
      create table public.slips (id uuid primary key default gen_random_uuid(), trans_ref text, status text default 'pending');
      create unique index slips_one_valid_per_ref on public.slips(trans_ref) where status = 'valid';
      grant usage on schema public to service_role, anon, authenticated;
      grant all on public.tenants, public.slips to service_role;
    `)
    const sql = name => readFileSync(join(__dirname, '..', 'supabase', name), 'utf8')
    await db.exec(sql('billing.sql').replace(/^do \$\$ begin alter publication.*$/gm, ''))
    await db.exec(sql('payments.sql'))
    await db.exec(sql('payments.sql'))
    const tenant = (await db.query('insert into tenants default values returning id')).rows[0].id
    async function session(plan = 'starter', price = 390, credits = 1500) {
      return (await db.query(`insert into payment_sessions
        (tenant_id, plan, price_baht, credits, receiver_promptpay_id, receiver_account_no,
         receiver_account_name, receiver_bank_name, receiver_bank_code)
        values ($1,$2,$3,$4,'0812345678','1234567890','Test','KBANK','004') returning id`,
      [tenant, plan, price, credits])).rows[0].id
    }
    async function receipt(id, ref, hash = 'a', amount = 390) {
      return db.query(`insert into payment_receipts(session_id,trans_ref,image_sha256,amount,paid_at)
        values ($1,$2,$3,$4,now())`, [id, ref, hash.repeat(64), amount])
    }
    const billing = async id => (await db.query('select activate_payment($1) as value', [id])).rows[0].value
    const first = await session()
    await assert.rejects(billing(first), /proof required/)
    await assert.rejects(receipt(first, 'wrong', 'f', 990), /amount/)
    await receipt(first, 'starter-ref')
    const before = await billing(first)
    assert.equal(before.monthly, 1600)
    assert.deepEqual(await billing(first), before)
    await db.query("update tenants set broadcast_period='2000-01', broadcast_topup_credits=80 where id=$1", [tenant])
    await db.query('select refresh_broadcast_credits($1)', [tenant])
    assert.equal((await billing(first)).monthly, 1600)
    const reserve = (await db.query('select * from reserve_broadcast_credits($1,1800)', [tenant])).rows[0]
    assert.deepEqual(reserve, { monthly: 1600, topup: 80 })
    await db.query('select refund_broadcast_credits($1,1600,80)', [tenant])
    assert.equal((await billing(first)).monthly, 1600) // no allowance cap (1500)
    const second = await session('pro', 990, 7500)
    await assert.rejects(receipt(second, 'starter-ref', 'b', 990), /unique|accepted/)
    await assert.rejects(receipt(second, 'different-ref', 'a', 990), /unique/)
    await assert.rejects(db.query("insert into slips(trans_ref,status) values ('starter-ref','valid')"), /accepted/)
    await db.exec("insert into slips(trans_ref,status) values ('sale-ref','valid')")
    await assert.rejects(receipt(second, 'sale-ref', 'b', 990), /accepted/)
    await receipt(second, 'pro-ref', 'b', 990)
    // Saved proof remains usable if activation was delayed past the QR's expiry.
    await db.query("update payment_sessions set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' where id=$1", [second])
    const upgraded = await billing(second)
    assert.equal(upgraded.monthly, 9100)
    assert.equal(upgraded.topup, 80)
    assert.equal(upgraded.plan, 'pro')
    const extension = Date.parse(upgraded.planExpiresAt) - Date.parse(before.planExpiresAt)
    assert.equal(extension, 30 * 86400000)
    await assert.rejects(db.query("update payment_receipts set trans_ref='tampered' where session_id=$1", [first]), /immutable/)
    const third = await session()
    await db.query("update payment_sessions set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' where id=$1", [third])
    await assert.rejects(receipt(third, 'expired-ref', 'c'), /window/)
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select activate_payment($1)', [first]), /permission denied/)
    await assert.rejects(db.query('select * from payment_receipts'), /permission denied/)
    await db.exec('reset role; set role service_role')
    assert.equal((await billing(second)).monthly, 9100)
    await db.exec('reset role')
    const manual = (await db.query(`insert into billing_requests(tenant_id,item,price_baht,credits)
      values ($1,'starter',390,1500) returning id`, [tenant])).rows[0].id
    await db.query('select approve_billing_request($1,null)', [manual])
    assert.equal((await db.query('select broadcast_credit_mode from tenants where id=$1', [tenant])).rows[0].broadcast_credit_mode, 'purchased')
    await db.query("update tenants set plan_expires_at=now()-interval '1 minute' where id=$1", [tenant])
    await db.query('select refresh_broadcast_credits($1)', [tenant])
    const expired = (await db.query('select plan,broadcast_credits,broadcast_topup_credits,slip_used from tenants where id=$1', [tenant])).rows[0]
    assert.deepEqual(expired, { plan: 'free', broadcast_credits: 100, broadcast_topup_credits: 80, slip_used: 0 })
    await db.query('delete from tenants where id=$1', [tenant])
    assert.equal((await db.query('select count(*)::integer as n from payment_receipts')).rows[0].n, 2)
    await db.exec("delete from slips where trans_ref='sale-ref'")
    await assert.rejects(db.exec("insert into slips(trans_ref,status) values ('sale-ref','valid')"), /accepted/)
    console.log('Payment SQL checks passed: rerun, proof, duplicates, retry, credit arithmetic, renewal, expiry, permissions, retained ledger.')
  } finally { await db.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
