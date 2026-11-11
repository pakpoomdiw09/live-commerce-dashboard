const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')
const load = require('./helpers/load-typescript.cjs')

const cfCode = load('lib/features/commerce/cf-code.ts')
const liveCfCodes = load('lib/features/commerce/live-cf-codes.ts', { './cf-code': cfCode })
const commentRules = load('lib/features/comments/comment-rules.ts', {
  '@/lib/features/commerce/cf-code': cfCode,
  '@/lib/features/commerce/live-cf-codes': liveCfCodes,
})
const liveCfComment = load('lib/features/commerce/live-cf-comment.ts', {
  './cf-code': cfCode,
  './comment-config': { renderCommentTemplate: (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '') },
})

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create publication supabase_realtime;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
  `)
  await db.exec(build().completeSql)
  const tenant = (await one(db, "insert into tenants(name,page_id,plan,plan_expires_at) values('Live CF test','100','pro',now()+interval '1 day') returning id")).id
  const customer = (await one(db, "insert into customers(tenant_id,platform,platform_user_id,display_name) values($1,'facebook','900','Customer') returning id", [tenant])).id
  const product = (await one(db, "insert into products(tenant_id,code,name,price,stock) values($1,'A1','Product A1',250,20) returning id", [tenant])).id
  const rule = (await one(db, `insert into comment_rules(tenant_id,name,page_ids,keywords,mode,live_product_id,live_post_id,max_qty_per_comment)
    values($1,'Live CF',array['100'],array['a1'],'live_cf',$2,'900',5) returning id`, [tenant, product])).id
  async function order(comment, quantity, code = 'a1') {
    return one(db, 'select * from place_live_cf_order($1,$2,$3,$4,$5,$6,$7,$8)', [tenant, customer, rule, code, comment, '900', '100', quantity])
  }
  return { db, tenant, customer, product, rule, order }
}

test('quantity suffixes parse, code matching has whole-token boundaries, and max qty clamps atomically', async () => {
  assert.equal(liveCfCodes.liveCfQuantity('A1 2'), 2)
  assert.equal(liveCfCodes.liveCfQuantity('CF A1 3'), 3)
  assert.equal(liveCfCodes.liveCfQuantity('A1*2'), 2)
  assert.equal(liveCfCodes.liveCfQuantity('A1x2'), 2)
  assert.equal(liveCfCodes.liveCfQuantity('CF A1'), 1)
  assert.equal(commentRules.liveRuleCode({ match_type: 'keyword', keywords: ['A1'] }, 'A10'), null)
  assert.equal(commentRules.liveRuleCode({ match_type: 'keyword', keywords: ['A1'] }, 'A11'), null)
  assert.equal(commentRules.liveRuleCode({ match_type: 'keyword', keywords: ['A1'] }, 'AA1'), null)
  assert.equal(commentRules.liveRuleCode({ match_type: 'keyword', keywords: ['A1'] }, 'CF A1 3'), 'a1')

  const f = await fixture()
  try {
    const double = await f.order('comment-double', 2)
    assert.equal(double.r_status, 'created')
    assert.equal(Number(double.r_quantity), 2)
    assert.equal(Number(double.r_unit_price), 250)
    assert.equal(Number(double.r_subtotal), 500)
    assert.equal(Number((await one(f.db, 'select stock from products where id=$1', [f.product])).stock), 18)
    assert.equal(Number((await one(f.db, 'select quantity from orders where id=$1', [double.r_order_id])).quantity), 2)

    const single = await f.order('comment-single', liveCfCodes.liveCfQuantity('CF A1'))
    assert.equal(single.r_status, 'created')
    assert.equal(Number(single.r_quantity), 1)
    assert.equal(Number(single.r_subtotal), 250)

    const clamped = await f.order('comment-clamped', 10)
    assert.equal(clamped.r_status, 'created')
    assert.equal(Number(clamped.r_quantity), 5)
    assert.equal(clamped.r_quantity_clamped, true)
    assert.equal(Number(clamped.r_subtotal), 1250)
    assert.equal(Number((await one(f.db, 'select stock from products where id=$1', [f.product])).stock), 12)

    assert.equal(commentRules.liveRuleCode({ match_type: 'keyword', keywords: ['A1'] }, 'A10'), null)
    assert.equal((await one(f.db, 'select count(*)::int n from orders where source_id=$1', ['A10-comment'])).n, 0)
  } finally {
    await f.db.close()
  }
})

test('insufficient stock rejects the whole quantity and leaves inventory unchanged', async () => {
  const f = await fixture()
  try {
    await f.db.query('update products set stock=1 where id=$1', [f.product])
    const result = await f.order('comment-insufficient', 2)
    assert.equal(result.r_status, 'insufficient_stock')
    assert.equal(Number(result.r_remaining_stock), 1)
    assert.equal(Number((await one(f.db, 'select stock from products where id=$1', [f.product])).stock), 1)
    assert.equal((await one(f.db, 'select count(*)::int n from orders where source_id=$1', ['comment-insufficient'])).n, 0)
  } finally {
    await f.db.close()
  }
})

test('Messenger invoice includes item quantity, unit price, and subtotal', async () => {
  const sent = []
  await liveCfComment.handleLiveCfComment(
    { text: 'A1 2', commentId: 'comment-invoice', code: 'A1' },
    {
      placeOrder: async (_code, quantity) => ({ status: 'created', orderId: 'order-1', name: 'A1', code: 'A1', quantity, unitPrice: 250, subtotal: 500, amount: 500, variantLabel: null }),
      getPayment: async () => ({ bankName: 'Bank', accountName: null, accountNumber: '123' }),
      getPendingTotal: async () => 500,
      getPaymentLink: async () => 'https://example.test/pay',
      sendPrivateReply: async (message) => sent.push(message),
    },
  )
  assert.match(sent[0], /A1 x 2 ชิ้น = 500\.00 บาท/)
})
