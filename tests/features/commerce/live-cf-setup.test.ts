import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { matchesCfCode, matchOrderCode } from '../../../lib/features/commerce/cf-code'
import { createMockLiveCfMetaAdapter } from '../../../lib/integrations/facebook/live-cf-adapter'
import { quickLiveProduct } from '../../../lib/features/commerce/live-cf-setup'
import { liveRuleCode } from '../../../lib/features/comments/comment-rules'

const tenant = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'
const customer = '33333333-3333-4333-8333-333333333333'
const psid = 'live-cf-user'

async function database(stock = 1) {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table tenants(id uuid primary key,is_active boolean not null default true,plan text not null default 'starter',plan_expires_at timestamptz not null default now()+interval '1 month',page_id text);
    create table tenant_members(tenant_id uuid,user_id uuid,role text); create table platform_admins(user_id uuid);
    create table customers(id uuid primary key,tenant_id uuid,platform text not null,platform_user_id text not null,unique(platform,platform_user_id));
    create table slips(id uuid primary key default gen_random_uuid(),tenant_id uuid,customer_id uuid,status text default 'pending',amount numeric,created_at timestamptz default clock_timestamp());
    create table products(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),code text not null,name text not null,price numeric(12,2) not null,stock integer not null,is_active boolean not null default true,description text,image_url text,created_at timestamptz not null default now());
    create unique index products_tenant_code on products(tenant_id,lower(code));
    create table orders(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,customer_id uuid not null references customers(id),product_id uuid references products(id),product_name text not null,amount numeric(12,2) not null,message_id uuid unique,status text not null default 'pending_payment',slip_id uuid references slips(id),created_at timestamptz default clock_timestamp());
    create table bank_accounts(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),bank_code text not null,account_name text not null,account_number text not null,is_active boolean not null default true);
    create table comment_rules(
      id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),name text not null,
      page_ids text[] not null default '{}',match_type text not null default 'keyword',keywords text[] not null default '{}',
      reply_enabled boolean not null default true,reply_text text,inbox_enabled boolean not null default false,
      inbox_type text not null default 'text',inbox_text text,inbox_image_url text,is_active boolean not null default true,
      created_at timestamptz not null default now()
    );
  `)
  await db.exec(await readFile('supabase/commerce-v2.sql', 'utf8'))
  await db.exec(await readFile('supabase/live-cf-variants.sql', 'utf8'))
  await db.exec(await readFile('supabase/live-cf-mode.sql', 'utf8'))
  await db.exec(await readFile('supabase/live-cf-setup.sql', 'utf8'))
  await db.exec(await readFile('supabase/live-cf-customer-variants.sql', 'utf8'))
  await db.query('insert into tenants(id,page_id) values($1,$2)', [tenant, 'page-1'])
  await db.query("insert into tenant_members values($1,$2,'owner')", [tenant, actor])
  await db.query(
    'insert into customers(id,tenant_id,platform,platform_user_id) values($1,$2,$3,$4)',
    [customer, tenant, 'facebook', psid],
  )
  await db.query('select commerce_save_product($1,$2,null,$3::jsonb)', [
    tenant,
    actor,
    JSON.stringify({
      code: '159',
      name: 'สินค้าไลฟ์',
      price: 159,
      stock,
      description: '',
      images: [],
      category_id: null,
      compare_price: null,
      cost: null,
      featured: false,
      is_active: true,
      variants: [],
    }),
  ])
  return db
}

async function place(db: PGlite, commentId: string) {
  const result = await db.query<{ r_status: string; r_order_id: string | null }>(
    'select * from place_cf_order($1,$2,$3,$4,$5)',
    [tenant, '159', psid, 'facebook_comment', commentId],
  )
  return result.rows[0]
}

test('quick-created products are active on the sales page with the submitted code, price and stock', async () => {
  const db = await database()
  try {
    const value = quickLiveProduct({
      name: 'สินค้าเพิ่มจากไลฟ์',
      price: '259.50',
      stock: '12',
      cf_code: 'A1',
    })
    const result = await db.query<{ id: string }>(
      'select commerce_save_product($1,$2,null,$3::jsonb) id',
      [tenant, actor, JSON.stringify(value)],
    )
    const row = (
      await db.query<{
        code: string
        price: string
        stock: number
        is_active: boolean
        commerce_archived: boolean
      }>(
        'select code,price,stock,is_active,commerce_archived from products where id=$1 and tenant_id=$2',
        [result.rows[0].id, tenant],
      )
    ).rows[0]
    assert.equal(row.code, 'A1')
    assert.equal(Number(row.price), 259.5)
    assert.equal(row.stock, 12)
    assert.equal(row.is_active, true)
    assert.equal(row.commerce_archived, false)
    await assert.rejects(
      db.query('select commerce_save_product($1,$2,null,$3::jsonb)', [
        tenant,
        actor,
        JSON.stringify(value),
      ]),
      (error: unknown) => (error as { code: string }).code === '23505',
    )
  } finally {
    await db.close()
  }
})

test('full quick products persist category, image metadata, flags and exact variant IDs atomically', async () => {
  const db = await database()
  try {
    const category = '77777777-7777-4777-8777-777777777777'
    const variantId = '88888888-8888-4888-8888-888888888888'
    await db.query('insert into commerce_categories(id,tenant_id,name) values($1,$2,$3)', [
      category,
      tenant,
      'พระเครื่อง',
    ])
    const value = quickLiveProduct({
      name: 'พระเครื่อง',
      price: '159',
      stock: '',
      cf_code: 'AM1',
      category_id: category,
      description: 'รายละเอียดพระเครื่อง',
      images: ['https://storage.example/one.webp', 'https://storage.example/two.webp'],
      featured: true,
      is_active: false,
      variants: [
        { id: variantId, label: 'เนื้อเงิน', variant_code: 'AM1-S', price: '259.50', stock: '3' },
      ],
    })
    const result = await db.query<{ id: string }>(
      'select commerce_save_product($1,$2,null,$3::jsonb) id',
      [tenant, actor, JSON.stringify(value)],
    )
    const id = result.rows[0].id
    const row = (
      await db.query<{
        commerce_category_id: string
        commerce_images: string[]
        image_url: string
        description: string
        commerce_featured: boolean
        is_active: boolean
        commerce_cost: null
        commerce_compare_price: null
        stock: number
      }>('select * from products where id=$1', [id])
    ).rows[0]
    assert.equal(row.commerce_category_id, category)
    assert.deepEqual(row.commerce_images, value.images)
    assert.equal(row.image_url, value.images[0])
    assert.equal(row.description, value.description)
    assert.equal(row.commerce_featured, true)
    assert.equal(row.is_active, false)
    assert.equal(row.commerce_cost, null)
    assert.equal(row.commerce_compare_price, null)
    assert.equal(row.stock, 3)
    const variant = (
      await db.query<{
        id: string
        tenant_id: string
        variant_code: string
        price: string
        stock: number
      }>('select * from commerce_variants where product_id=$1', [id])
    ).rows[0]
    assert.equal(variant.id, variantId)
    assert.equal(variant.tenant_id, tenant)
    assert.equal(variant.variant_code, 'AM1-S')
    assert.equal(Number(variant.price), 259.5)
    assert.equal(variant.stock, 3)
    // A conflicting variant code must roll back the parent insertion as well.
    const conflict = {
      ...value,
      code: 'AM2',
      variants: [{ ...value.variants[0], id: '99999999-9999-4999-8999-999999999999' }],
    }
    await assert.rejects(
      db.query('select commerce_save_product($1,$2,null,$3::jsonb)', [
        tenant,
        actor,
        JSON.stringify(conflict),
      ]),
      (error: unknown) => (error as { code: string }).code === '23505',
    )
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from products where code='AM2'"))
        .rows[0].n,
      0,
    )
  } finally {
    await db.close()
  }
})

test('all saved aliases route real live comments to the same product and retain stock/idempotency guards', async () => {
  const db = await database(5)
  try {
    const product = (await db.query<{ id: string }>('select id from products limit 1')).rows[0].id
    const aliases = ['cf159', '01', 'จอง', 'b2', 'รับ1']
    const rule = (
      await db.query<{ id: string; keywords: string[]; match_type: 'keyword' }>(
        `insert into comment_rules(tenant_id,name,page_ids,keywords,match_type,mode,live_product_id,live_stock_limit,is_active)
      values($1,'หลายรหัส',array['page-1'],$2,'keyword','live_cf',$3,5,true) returning id,keywords,match_type`,
        [tenant, aliases, product],
      )
    ).rows[0]
    assert.deepEqual(new Set(rule.keywords), new Set(aliases))
    for (const [index, alias] of aliases.entries()) {
      const comment = ['เอา cf 159?!', 'รับ01ครับ', 'อยากจองสินค้าค่ะ', 'xxB 2yy!', 'ปิดรับ 1.'][
        index
      ]
      const matched = liveRuleCode(rule, comment)
      assert.equal(matched, alias)
      const args = [tenant, customer, rule.id, matched, `multi-${index}`, null, 'page-1']
      const order = (
        await db.query<{ r_status: string; r_order_id: string }>(
          'select * from place_cf_order($1,$2,$3,$4,$5,$6,$7)',
          args,
        )
      ).rows[0]
      assert.equal(order.r_status, 'created')
      const replay = (
        await db.query<{ r_order_id: string }>(
          'select * from place_cf_order($1,$2,$3,$4,$5,$6,$7)',
          args,
        )
      ).rows[0]
      assert.equal(replay.r_order_id, order.r_order_id)
    }
    assert.equal(
      (await db.query<{ stock: number }>('select stock from products where id=$1', [product]))
        .rows[0].stock,
      0,
    )
    assert.equal((await db.query<{ n: number }>('select count(*)::int n from orders')).rows[0].n, 5)
  } finally {
    await db.close()
  }
})

test('quick product edits update the existing row and variants and reject inventory changes made after loading', async () => {
  const db = await database()
  try {
    const variantId = '88888888-8888-4888-8888-888888888888'
    const value = quickLiveProduct({
      name: 'เสื้อ',
      cf_code: 'EDIT1',
      price: '159',
      stock: '3',
      images: ['https://cdn.example/one.webp', 'https://cdn.example/two.webp'],
      cost: 50,
      compare_price: 299,
      featured: true,
      variants: [
        { id: variantId, label: 'สี: ขาว', variant_code: 'WHITE', price: '199', stock: '3' },
      ],
    })
    const created = (
      await db.query<{ id: string }>('select commerce_save_product($1,$2,null,$3::jsonb) id', [
        tenant,
        actor,
        JSON.stringify(value),
      ])
    ).rows[0].id
    const version = (
      await db.query<{ commerce_version: number }>(
        'select commerce_version from products where id=$1',
        [created],
      )
    ).rows[0].commerce_version
    const updated = {
      ...value,
      name: 'เสื้อแก้ไข',
      code: 'EDIT2',
      stock: 4,
      variants: [{ ...value.variants[0], stock: 4, price: 219 }],
    }
    const saved = await db.query<{ id: string }>(
      'select commerce_save_product($1,$2,$3,$4::jsonb,$5) id',
      [tenant, actor, created, JSON.stringify(updated), version],
    )
    assert.equal(saved.rows[0].id, created)
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from products where code in ('EDIT1','EDIT2')",
        )
      ).rows[0].n,
      1,
    )
    const row = (await db.query<any>('select * from products where id=$1', [created])).rows[0]
    assert.equal(row.name, 'เสื้อแก้ไข')
    assert.equal(Number(row.commerce_cost), 50)
    assert.equal(Number(row.commerce_compare_price), 299)
    assert.equal(row.commerce_featured, true)
    assert.deepEqual(row.commerce_images, value.images)
    const variant = (
      await db.query<any>('select * from commerce_variants where product_id=$1 and is_active', [
        created,
      ])
    ).rows[0]
    assert.equal(variant.id, variantId)
    assert.equal(variant.variant_code, 'WHITE')
    assert.equal(variant.stock, 4)
    await db.query('update products set stock=stock-1 where id=$1', [created])
    await assert.rejects(
      db.query('select commerce_save_product($1,$2,$3,$4::jsonb,$5)', [
        tenant,
        actor,
        created,
        JSON.stringify(updated),
        row.commerce_version,
      ]),
      /COMMERCE_CHANGED/,
    )
    assert.equal(
      (await db.query<any>('select stock from products where id=$1', [created])).rows[0].stock,
      3,
    )
  } finally {
    await db.close()
  }
})

async function deferredFixture(db: PGlite) {
  const product = (await db.query<{ id: string }>('select id from products limit 1')).rows[0].id
  const variants = (
    await db.query<{ id: string; label: string; price: string }>(
      "insert into commerce_variants(tenant_id,product_id,label,price,stock) values($1,$2,'สีขาว',159,1),($1,$2,'สีดำ',259,1) returning id,label,price",
      [tenant, product],
    )
  ).rows
  const rule = (
    await db.query<{ id: string }>(
      "insert into comment_rules(tenant_id,name,page_ids,keywords,mode,live_product_id,live_customer_select_variant,is_active,inbox_enabled) values($1,'เลือกภายหลัง',array['page-1'],array['159'],'live_cf',$2,true,true,true) returning id",
      [tenant, product],
    )
  ).rows[0].id
  const create = async (comment: string) =>
    (
      await db.query<{ r_status: string; r_order_id: string }>(
        'select * from place_cf_order($1,$2,$3,$4,$5,$6,$7)',
        [tenant, customer, rule, '159', comment, null, 'page-1'],
      )
    ).rows[0].r_order_id
  const confirm = (id: string, variant: string) =>
    db.query<{
      value: {
        amount: number
        variant_id: string
        payment_total: number
        remaining_selections: number
      }
    }>('select confirm_live_cf_variant($1,$2) value', [id, variant])
  return { product, variants, create, confirm }
}

test('customer confirms a variant after the main CF code; inventory, quote, retries and payment evidence remain atomic', async () => {
  const db = await database(2)
  try {
    const f = await deferredFixture(db),
      order = await f.create('deferred-one')
    assert.ok(order)
    const pending = (
      await db.query<{ variant_id: null; live_variant_selection_required: boolean }>(
        'select variant_id,live_variant_selection_required from orders where id=$1',
        [order],
      )
    ).rows[0]
    assert.equal(pending.variant_id, null)
    assert.equal(pending.live_variant_selection_required, true)
    await assert.rejects(
      db.query("update orders set status='paid' where id=$1", [order]),
      /LIVE_CF_VARIANT_REQUIRED/,
    )
    const selected = (await f.confirm(order, f.variants[1].id)).rows[0].value
    assert.equal(selected.amount, 259)
    assert.equal(selected.payment_total, 259)
    assert.equal(selected.remaining_selections, 0)
    assert.equal(
      (await f.confirm(order, f.variants[1].id)).rows[0].value.variant_id,
      f.variants[1].id,
    )
    assert.equal(
      (await db.query<{ stock: number }>('select stock from products where id=$1', [f.product]))
        .rows[0].stock,
      1,
    )
    assert.equal(
      (
        await db.query<{ stock: number }>('select stock from commerce_variants where id=$1', [
          f.variants[1].id,
        ])
      ).rows[0].stock,
      0,
    )
    await assert.rejects(f.confirm(order, f.variants[0].id), /LIVE_CF_SELECTION_LOCKED/)
    const slip = (
      await db.query<{ id: string }>(
        "insert into slips(tenant_id,customer_id,status,amount) values($1,$2,'pending',159) returning id",
        [tenant, customer],
      )
    ).rows[0].id
    await assert.rejects(
      db.query("update slips set status='valid' where id=$1", [slip]),
      /LIVE_CF_PAYMENT_AMOUNT_CHANGED/,
    )
    await db.query("update slips set amount=259,status='valid' where id=$1", [slip])
    await db.query("update orders set status='paid',slip_id=$2 where id=$1", [order, slip])
    await assert.rejects(f.confirm(order, f.variants[1].id), /LIVE_CF_SELECTION_LOCKED/)
    await assert.rejects(
      db.query('update orders set amount=1 where id=$1', [order]),
      /LIVE_CF_SELECTION_LOCKED/,
    )
  } finally {
    await db.close()
  }
})

test('customers competing for the last variant cannot oversell; cancelling restores only reserved inventory', async () => {
  const db = await database(2)
  try {
    const f = await deferredFixture(db),
      a = await f.create('race-a'),
      b = await f.create('race-b')
    const result = await Promise.allSettled([
      f.confirm(a, f.variants[0].id),
      f.confirm(b, f.variants[0].id),
    ])
    assert.equal(result.filter((row) => row.status === 'fulfilled').length, 1)
    const remaining = result[0].status === 'fulfilled' ? b : a
    const finalSelection = (await f.confirm(remaining, f.variants[1].id)).rows[0].value
    assert.equal(finalSelection.payment_total, 418)
    assert.equal(finalSelection.remaining_selections, 0)
    await db.query("update orders set status='cancelled' where id=any($1)", [[a, b]])
    assert.equal(
      (await db.query<{ stock: number }>('select stock from products where id=$1', [f.product]))
        .rows[0].stock,
      2,
    )
    assert.deepEqual(
      (
        await db.query<{ stock: number }>('select stock from commerce_variants order by id')
      ).rows.map((row) => row.stock),
      [1, 1],
    )
    await db.exec('set role authenticated')
    await assert.rejects(
      f.confirm(a, f.variants[0].id),
      (error: unknown) => (error as { code: string }).code === '42501',
    )
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})

test('selection rejects variants from another shop and cannot change a quote while proof is being checked', async () => {
  const db = await database(2)
  try {
    const f = await deferredFixture(db),
      order = await f.create('scoped-selection')
    const otherTenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await db.query("insert into tenants(id,page_id) values($1,'other-page')", [otherTenant])
    const otherProduct = (
      await db.query<{ id: string }>(
        "insert into products(tenant_id,code,name,price,stock) values($1,'OTHER','Other product',1,1) returning id",
        [otherTenant],
      )
    ).rows[0].id
    const foreign = (
      await db.query<{ id: string }>(
        "insert into commerce_variants(tenant_id,product_id,label,price,stock) values($1,$2,'Other option',1,1) returning id",
        [otherTenant, otherProduct],
      )
    ).rows[0].id
    await assert.rejects(f.confirm(order, foreign), /LIVE_CF_VARIANT_INVALID/)
    const slip = (
      await db.query<{ id: string }>(
        "insert into slips(tenant_id,customer_id,status,amount) values($1,$2,'pending',159) returning id",
        [tenant, customer],
      )
    ).rows[0].id
    await assert.rejects(f.confirm(order, f.variants[0].id), /LIVE_CF_PAYMENT_IN_PROGRESS/)
    await assert.rejects(
      db.query("update slips set status='valid' where id=$1", [slip]),
      /LIVE_CF_VARIANT_REQUIRED/,
    )
    assert.equal(
      (
        await db.query<{ stock: number }>('select stock from commerce_variants where id=$1', [
          f.variants[0].id,
        ])
      ).rows[0].stock,
      1,
    )
  } finally {
    await db.close()
  }
})

test('parser matches 159 as an exact token but never 1590', () => {
  assert.equal(matchesCfCode('CF 159', '159'), true)
  assert.equal(matchesCfCode('เอา 159 ค่ะ', '159'), true)
  assert.equal(matchesCfCode('CF 1590', '159'), false)
  assert.equal(matchesCfCode('cf a1', 'A1'), true)
  assert.equal(matchesCfCode('CF แดง', 'แดง'), true)
})

test('matchOrderCode supports flexible and strict match modes', () => {
  // Flexible mode: allows bare code, prefix (CF, FC, เอา, จอง, สนใจ, รับ, ขอ) or distinct token
  assert.equal(matchOrderCode('159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('CF 159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('cf 159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('FC 159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('fc 159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('จอง 159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('เอา 159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('สนใจ 159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('รับ 159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('ขอ 159', '159', 'flexible'), true)
  assert.equal(matchOrderCode('CF แดง', 'แดง', 'flexible'), true)
  assert.equal(matchOrderCode('เอา แดง', 'แดง', 'flexible'), true)
  assert.equal(matchOrderCode('CF 1590', '159', 'flexible'), false)

  // Strict mode: requires exact 100% match, no other words/prefixes allowed
  assert.equal(matchOrderCode('159', '159', 'strict'), true)
  assert.equal(matchOrderCode(' 159 ', '159', 'strict'), true)
  assert.equal(matchOrderCode('A1', 'a1', 'strict'), true)
  assert.equal(matchOrderCode('แดง', 'แดง', 'strict'), true)
  assert.equal(matchOrderCode('CF 159', '159', 'strict'), false)
  assert.equal(matchOrderCode('เอา 159', '159', 'strict'), false)
  assert.equal(matchOrderCode('จอง 159', '159', 'strict'), false)
  assert.equal(matchOrderCode('159 ครับ', '159', 'strict'), false)
})

test('durable source idempotency returns one order for the same Facebook comment', async () => {
  const db = await database(2)
  try {
    const first = await place(db, 'same-comment')
    const replay = await place(db, 'same-comment')
    assert.equal(first.r_status, 'created')
    assert.equal(replay.r_order_id, first.r_order_id)
    assert.equal(
      (await db.query<{ count: number }>('select count(*)::int count from orders')).rows[0].count,
      1,
    )
    assert.equal(
      (await db.query<{ stock: number }>("select stock from products where code='159'")).rows[0]
        .stock,
      1,
    )
  } finally {
    await db.close()
  }
})

test('concurrent stock deduction creates only one order for the final item', async () => {
  const db = await database(1)
  try {
    const results = await Promise.all([place(db, 'comment-a'), place(db, 'comment-b')])
    assert.deepEqual(results.map((row) => row.r_status).sort(), ['created', 'sold_out'])
    assert.equal(
      (await db.query<{ count: number }>('select count(*)::int count from orders')).rows[0].count,
      1,
    )
    assert.equal(
      (await db.query<{ stock: number }>("select stock from products where code='159'")).rows[0]
        .stock,
      0,
    )
  } finally {
    await db.close()
  }
})

test('Meta adapter is mocked and accepts text only during tests', async () => {
  const mock = createMockLiveCfMetaAdapter()
  await mock.adapter.sendPrivateText('comment-1', 'สรุปยอด https://example.test/pay/signed')
  assert.deepEqual(mock.privateMessages, [
    { commentId: 'comment-1', text: 'สรุปยอด https://example.test/pay/signed' },
  ])
})
