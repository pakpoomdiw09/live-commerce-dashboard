import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { matchesCfCode, matchOrderCode } from '../../../lib/features/commerce/cf-code'
import { createMockLiveCfMetaAdapter } from '../../../lib/integrations/facebook/live-cf-adapter'
import { quickLiveProduct } from '../../../lib/features/commerce/live-cf-setup'

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
    create table products(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),code text not null,name text not null,price numeric(12,2) not null,stock integer not null,is_active boolean not null default true,description text,image_url text,created_at timestamptz not null default now());
    create unique index products_tenant_code on products(tenant_id,lower(code));
    create table orders(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,customer_id uuid not null references customers(id),product_id uuid references products(id),product_name text not null,amount numeric(12,2) not null,message_id uuid unique,status text not null default 'pending_payment');
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
