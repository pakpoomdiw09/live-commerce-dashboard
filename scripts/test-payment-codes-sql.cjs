const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { test } = require('node:test'),
  { PGlite } = require('@electric-sql/pglite')
test('receiving codes: repeatable migration, immutable order snapshot, tenant/owner gates, idempotency, audit and no payment side effects', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      fs
        .readFileSync('scripts/test-bank-accounts-sql.cjs', 'utf8')
        .split('await db.exec(`')[1]
        .split('`)')[0],
    )
    await db.exec(
      "create table auth.users(id uuid primary key default gen_random_uuid());alter table tenants add column plan text default 'starter';create table orders(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),amount numeric,status text default 'pending_payment');create function has_tenant_feature(p_tenant uuid,p_feature text) returns boolean language sql as $$select is_active and plan in ('starter','pro') from tenants where id=p_tenant$$;",
    )
    await db.exec(fs.readFileSync('supabase/bank-accounts.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/slip-bank-controls.sql', 'utf8'))
    const sql = fs.readFileSync('supabase/payment-receiving-codes.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    const one = async (q, args = []) => (await db.query(q, args)).rows[0],
      owner = (await one('insert into auth.users default values returning id')).id,
      staff = (await one('insert into auth.users default values returning id')).id
    const shop = (await one('insert into tenants default values returning id')).id,
      other = (await one('insert into tenants default values returning id')).id,
      free = (await one("insert into tenants(plan) values('free') returning id")).id
    await db.query(
      "insert into tenant_members values($1,$2,'owner'),($1,$3,'staff'),($4,$2,'owner')",
      [shop, owner, staff, free],
    )
    const account = (
      await one(
        "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'PROMPTPAY','Offline owner','0812345678') returning id",
        [shop],
      )
    ).id
    const order = (
        await one('insert into orders(tenant_id,amount) values($1,125) returning id', [shop])
      ).id,
      key = crypto.randomUUID(),
      payload = require('promptpay-qr')('0812345678', { amount: 125 })
    const save = (actor = owner, tenant = shop, amount = 12500, id = key) =>
      one('select save_payment_receiving_code($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id', [
        tenant,
        actor,
        id,
        account,
        'Test QR',
        payload,
        '0812345678',
        amount,
        order,
        'generated',
      ])
    await assert.rejects(save(staff), (error) => error.code === '42501')
    await assert.rejects(save(owner, other), (error) => error.code === '42501')
    await assert.rejects(save(owner, free), (error) => error.code === '42501')
    await assert.rejects(save(owner, shop, 1), (error) => error.code === '40001')
    const first = await save()
    assert.deepEqual(await save(), first)
    assert.equal((await one('select count(*)::int n from payment_receiving_audit')).n, 1)
    assert.equal(
      (await one('select status from orders where id=$1', [order])).status,
      'pending_payment',
    )
    await assert.rejects(save(owner, shop, 12400), (error) => error.code === '22023')
    await db.query("update bank_accounts set account_number='0899999999' where id=$1", [account])
    await assert.rejects(
      save(owner, shop, 12500, crypto.randomUUID()),
      (error) => error.code === '40001',
    )
    await db.query("update bank_accounts set account_number='0812345678' where id=$1", [account])
    const toggle = (active, actor = owner) =>
      db.query('select set_payment_receiving_code_active($1,$2,$3,$4)', [
        shop,
        actor,
        first.id,
        active,
      ])
    await toggle(false)
    await toggle(false)
    assert.equal((await one('select count(*)::int n from payment_receiving_audit')).n, 2)
    await assert.rejects(toggle(true, staff), (error) => error.code === '42501')
    await db.query("update orders set status='paid' where id=$1", [order])
    await assert.rejects(
      save(owner, shop, 12500, crypto.randomUUID()),
      (error) => error.code === '40001',
    )
    await db.exec(sql)
    assert.equal(
      (await one('select is_active from payment_receiving_codes where id=$1', [first.id]))
        .is_active,
      false,
    )
    await db.exec('set role authenticated')
    await assert.rejects(
      db.query('select * from payment_receiving_codes'),
      (error) => error.code === '42501',
    )
    await assert.rejects(toggle(true), (error) => error.code === '42501')
  } finally {
    await db.close()
  }
})
