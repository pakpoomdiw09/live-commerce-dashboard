const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')
const fs = require('node:fs')

test('cumulative tabs atomically reopen, accept partials, charge shipping once and fence duplicate/foreign payments', async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create schema storage;create schema extensions;
   create table auth.users(id uuid primary key default gen_random_uuid(),email text);
   create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;create publication supabase_realtime;
   grant usage on schema public,auth,storage to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
   alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`)
    await db.exec(build().completeSql)
    await db.exec(fs.readFileSync('supabase/customer-tabs.sql', 'utf8'))
    const tenant = (
      await one("insert into tenants(name,page_id) values('Live shop','100') returning id")
    ).id
    const other = (
      await one("insert into tenants(name,page_id) values('Other shop','200') returning id")
    ).id
    const customer = (
      await one(
        "insert into customers(tenant_id,platform,platform_user_id,display_name) values($1,'facebook','900','สมชาย') returning id",
        [tenant],
      )
    ).id
    const stranger = (
      await one(
        "insert into customers(tenant_id,platform,platform_user_id) values($1,'facebook','901') returning id",
        [other],
      )
    ).id
    const bank = (
      await one(
        "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'KBANK','Shop','1234567890') returning id",
        [tenant],
      )
    ).id
    async function win(price, { shipping = 0, post = '456' } = {}) {
      const a = (
        await one(
          `insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,current_price,leading_bidder_id,leading_bidder_name,leading_comment_id,bank_account_id)
    values($1,'100',$2,$3,200,20,$4,$5,'900','สมชาย',$6,$7) returning id`,
          [tenant, post, `พระราคา ${price}`, shipping, price, randomUUID(), bank],
        )
      ).id
      const result = (await one('select finalize_live_auction($1,$2) result', [a, tenant])).result
      return one('select * from orders where id=$1', [result.orderId])
    }
    async function pay(tab, amount, ref = randomUUID(), owner = customer) {
      const claim = (
        await one('select claim_customer_tab_slip($1,$2,$3,null) result', [
          tab,
          owner,
          randomUUID(),
        ])
      ).result
      const result = (
        await one(
          `select complete_customer_tab_slip($1,$2,$3,'valid',$4,$5,clock_timestamp(),'{}',null) result`,
          [claim.slipId, tenant, owner, amount, ref],
        )
      ).result
      return { claim, result, ref }
    }
    const first = await win(200)
    const tab = first.customer_tab_id
    assert.ok(tab)
    assert.equal(Number(first.amount), 200)
    const paid = await pay(tab, 200)
    assert.equal(paid.result.remainingAmount, 0)
    assert.equal(paid.result.status, 'fully_paid')
    const second = await win(300)
    const third = await win(500)
    assert.equal(second.customer_tab_id, tab)
    assert.equal(third.customer_tab_id, tab)
    let bill = await one('select * from customer_tabs where id=$1', [tab])
    assert.equal(Number(bill.total_amount), 1000)
    assert.equal(Number(bill.paid_amount), 200)
    assert.equal(Number(bill.remaining_amount), 800)
    assert.equal(bill.status, 'pending_payment')
    const partial = await pay(tab, 250)
    assert.equal(partial.result.remainingAmount, 550)
    assert.equal(partial.result.paidAmount, 450)
    const replay = (
      await one(
        `select complete_customer_tab_slip($1,$2,$3,'valid',250,$4,clock_timestamp(),'{}',null) result`,
        [partial.claim.slipId, tenant, customer, partial.ref],
      )
    ).result
    assert.equal(replay.paidAmount, 450)
    assert.equal(
      (await one('select count(*)::int n from customer_tab_payments where tab_id=$1', [tab])).n,
      2,
    )
    await assert.rejects(pay(tab, 250, partial.ref), /Transfer already accepted|duplicate key/)
    await assert.rejects(pay(tab, 1, randomUUID(), stranger), /TAB_NOT_PAYABLE/)
    const rest = await pay(tab, 550)
    assert.equal(rest.result.remainingAmount, 0)
    assert.equal(
      (
        await one("select count(*)::int n from orders where customer_tab_id=$1 and status='paid'", [
          tab,
        ])
      ).n,
      3,
    )
    await assert.rejects(
      db.query('update slips set amount=1 where id=$1', [rest.claim.slipId]),
      /TAB_VERIFIED_PROOF_IMMUTABLE/,
    )
    // A different live has a different tab; both wins share exactly one shipping charge.
    const shipped1 = await win(200, { shipping: 50, post: '777' })
    const shipped2 = await win(300, { shipping: 50, post: '777' })
    assert.equal(shipped1.customer_tab_id, shipped2.customer_tab_id)
    assert.notEqual(shipped1.customer_tab_id, tab)
    bill = await one('select * from customer_tabs where id=$1', [shipped1.customer_tab_id])
    assert.equal(Number(bill.total_amount), 550)
    assert.equal(Number(bill.shipping_fee), 50)
    assert.equal(
      Number((await one('select sum(amount) n from orders where customer_tab_id=$1', [bill.id])).n),
      550,
    )
    const product = (
      await one(
        "insert into products(tenant_id,code,name,price,stock) values($1,'CF500','พระ CF',500,5) returning id",
        [tenant],
      )
    ).id
    const rule = (
      await one(
        "insert into comment_rules(tenant_id,name,page_ids,keywords,mode,live_product_id,live_post_id) values($1,'Live CF',array['100'],array['500'],'live_cf',$2,'777') returning id",
        [tenant, product],
      )
    ).id
    const cf = await one("select * from place_cf_order($1,$2,$3,'500','cf-comment','777','100')", [
      tenant,
      customer,
      rule,
    ])
    assert.equal(cf.r_status, 'created')
    assert.equal(
      (await one('select customer_tab_id from orders where id=$1', [cf.r_order_id]))
        .customer_tab_id,
      bill.id,
    )
    assert.equal(
      Number(
        (await one('select total_amount from customer_tabs where id=$1', [bill.id])).total_amount,
      ),
      1050,
    )
    // Replays cannot insert the CF item or shipping twice.
    await one("select * from place_cf_order($1,$2,$3,'500','cf-comment','777','100')", [
      tenant,
      customer,
      rule,
    ])
    assert.equal(
      Number(
        (await one('select total_amount from customer_tabs where id=$1', [bill.id])).total_amount,
      ),
      1050,
    )
    // Genuine overpayments remain visible as credit and offset the next win.
    await pay(bill.id, 1100)
    assert.equal(
      Number(
        (await one('select credit_amount from customer_tabs where id=$1', [bill.id])).credit_amount,
      ),
      50,
    )
    await win(200, { shipping: 50, post: '777' })
    assert.equal(
      Number(
        (await one('select remaining_amount from customer_tabs where id=$1', [bill.id]))
          .remaining_amount,
      ),
      150,
    )
    await assert.rejects(
      db.query(
        "update orders set status='paid' where id=(select order_id from customer_tab_items where tab_id=$1 order by closed_at desc limit 1)",
        [bill.id],
      ),
      /TAB_PAYMENT_NOT_COVERED/,
    )
    await one('select end_customer_tab_live($1,$2,true)', [bill.live_session_id, tenant])
    assert.equal(
      (await one('select count(*)::int n from customer_tab_reminders where tab_id=$1', [bill.id]))
        .n,
      2,
    )
    await one('select end_customer_tab_live($1,$2,true)', [bill.live_session_id, tenant])
    assert.equal(
      (await one('select count(*)::int n from customer_tab_reminders where tab_id=$1', [bill.id]))
        .n,
      2,
    )
    await assert.rejects(win(100, { post: '777' }), /LIVE_SESSION_ENDED/)
    const request = randomUUID()
    assert.equal(
      (await one('select queue_customer_tab_reminders($1,$2,$3) n', [tenant, customer, request])).n,
      1,
    )
    assert.equal(
      (await one('select queue_customer_tab_reminders($1,$2,$3) n', [tenant, customer, request])).n,
      0,
    )
    const job = await one('select * from claim_customer_tab_reminder()')
    assert.equal(job.tab_id, bill.id)
    assert.ok(job.claim_token)
    assert.equal(await one('select * from claim_customer_tab_reminder()'), undefined)
    await pay(bill.id, 150)
    assert.equal(
      (
        await one(
          "select count(*)::int n from customer_tab_reminders where tab_id=$1 and status='pending'",
          [bill.id],
        )
      ).n,
      0,
    )
    // Customer-selected CF variants still require confirmation, then permit partials.
    const variant = (
      await one(
        "insert into commerce_variants(tenant_id,product_id,label,price,stock,variant_code) values($1,$2,'Special',600,2,'VIP') returning id",
        [tenant, product],
      )
    ).id
    const variantRule = (
      await one(
        "insert into comment_rules(tenant_id,name,page_ids,keywords,mode,live_product_id,live_post_id,live_customer_select_variant) values($1,'Variant CF',array['100'],array['special'],'live_cf',$2,'999',true) returning id",
        [tenant, product],
      )
    ).id
    const selected = await one(
      "select * from place_cf_order($1,$2,$3,'special','variant-comment','999','100')",
      [tenant, customer, variantRule],
    )
    assert.equal(selected.r_status, 'created')
    await one('select confirm_live_cf_variant($1,$2)', [selected.r_order_id, variant])
    const variantTab = (
      await one('select customer_tab_id from orders where id=$1', [selected.r_order_id])
    ).customer_tab_id
    assert.equal(
      Number(
        (await one('select total_amount from customer_tabs where id=$1', [variantTab]))
          .total_amount,
      ),
      600,
    )
    assert.equal((await pay(variantTab, 100)).result.remainingAmount, 500)
    assert.equal((await pay(variantTab, 500)).result.remainingAmount, 0)
    assert.equal(
      (await one('select status from orders where id=$1', [selected.r_order_id])).status,
      'paid',
    )
    for (const table of [
      'customer_tabs',
      'customer_tab_items',
      'customer_tab_payments',
      'customer_tab_slip_attempts',
      'customer_tab_reminders',
      'live_sessions',
    ]) {
      assert.equal(
        (await one('select relrowsecurity from pg_class where oid=$1::regclass', [table]))
          .relrowsecurity,
        true,
      )
      assert.equal(
        (await one("select has_table_privilege('authenticated',$1,'insert') allowed", [table]))
          .allowed,
        false,
      )
    }
  } finally {
    await db.close()
  }
})
