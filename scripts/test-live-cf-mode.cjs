const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const load = require('./helpers/load-typescript.cjs')
const cf = load('lib/features/commerce/cf-code.ts')
const rules = load('lib/features/comments/comment-rules.ts', {
  '@/lib/features/commerce/cf-code': cf,
  '@/lib/features/commerce/live-cf-codes': load('lib/features/commerce/live-cf-codes.ts', { './cf-code': cf }),
})
const routing = load('lib/features/comments/live-comment-routing.ts', { './comment-rules': rules })
const envelope = load(
  'lib/integrations/facebook/webhook-envelope.ts',
  { 'node:crypto': require('node:crypto') },
  { TextDecoder },
)
const T = '11111111-1111-4111-8111-111111111111'
const T2 = '11111111-1111-4111-8111-222222222222'
const A = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table tenants(id uuid primary key,page_id text,is_active boolean default true,plan text default 'starter',plan_expires_at timestamptz default now()+interval '1 month');
    create table tenant_members(tenant_id uuid,user_id uuid,role text);
    create table platform_admins(user_id uuid);
    create table customers(id uuid primary key,tenant_id uuid,platform text,platform_user_id text);
    create table products(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),code text,name text,price numeric,stock integer,is_active boolean default true,description text,image_url text,created_at timestamptz default now());
    create table orders(id uuid primary key default gen_random_uuid(),tenant_id uuid,customer_id uuid references customers(id),product_id uuid references products(id),product_name text,amount numeric,message_id uuid unique,status text default 'pending_payment');
    create table comment_rules(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),name text,page_ids text[] default '{}',keywords text[] default '{}',match_type text default 'keyword',is_active boolean default true);
  `)
  for (const file of [
    'commerce-v2.sql',
    'live-cf-variants.sql',
    'live-cf-mode.sql',
    'live-cf-mode.sql',
  ])
    await db.exec(fs.readFileSync('supabase/' + file, 'utf8'))
  await db.query('insert into tenants(id,page_id) values($1,$2),($3,$4)', [T, '100', T2, '200'])
  await db.query('insert into tenant_members values($1,$2,$3),($4,$2,$3)', [T, A, 'owner', T2])
  await db.query("insert into customers values($1,$2,'facebook','900')", [C, T])
  async function product({ tenant = T, stock = 5, variants = [] } = {}) {
    return (
      await db.query('select commerce_save_product($1,$2,null,$3::jsonb) id', [
        tenant,
        A,
        JSON.stringify({
          code: 'SKU' + Math.random().toString(36).slice(2, 9),
          name: 'เสื้อร้านค้า',
          price: 199,
          stock,
          variants,
          description: '',
          images: [],
          category_id: null,
          compare_price: null,
          cost: null,
          featured: false,
          is_active: true,
        }),
      ])
    ).rows[0].id
  }
  async function rule(
    productId,
    { variant = null, limit = null, code = '159', post = null, tenant = T, page = '100' } = {},
  ) {
    return (
      await db.query(
        `insert into comment_rules(tenant_id,name,page_ids,keywords,mode,live_product_id,live_variant_id,live_stock_limit,live_post_id)
      values($1,'Live',array[$2],array[$3],'live_cf',$4,$5,$6,$7) returning id`,
        [tenant, page, code, productId, variant, limit, post],
      )
    ).rows[0].id
  }
  async function place(ruleId, code, comment, extra = {}) {
    return (
      await db.query('select * from place_live_cf_order($1,$2,$3,$4,$5,$6,$7)', [
        extra.tenant ?? T,
        extra.customer ?? C,
        ruleId,
        code,
        comment,
        extra.post ?? null,
        extra.page ?? '100',
      ])
    ).rows[0]
  }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  return { db, product, rule, place, one }
}

test('Live aliases match whole codes, reject glued codes, scope posts, and keep general matching unchanged', () => {
  const rule = {
    id: 'r',
    mode: 'live_cf',
    is_active: true,
    match_type: 'keyword',
    keywords: ['159', 'A1', 'Z99'],
    live_post_id: null,
  }
  for (const text of ['159', 'CF A1', 'รับ Z99 ค่ะ', 'สนใจ159ค่ะ'])
    assert.ok(rules.liveRuleCode(rule, text))
  for (const text of ['1159', 'A12', 'BA1', 'Z99X', '159-1', 'รูปทั่วไป'])
    assert.equal(rules.liveRuleCode(rule, text), null)
  assert.equal(rules.liveRuleCode({ ...rule, match_type: 'exact' }, 'CF A1'), null)
  assert.equal(routing.liveRuleCandidates([rule], 'A1', [], false).length, 0)
  assert.equal(routing.liveRuleCandidates([rule], 'A1', [], true).length, 1)
  assert.equal(
    routing.liveRuleCandidates(
      [{ ...rule, live_post_id: '456' }],
      'A1',
      routing.commentPostIds({ post_id: '100_456' }),
      false,
    ).length,
    1,
  )
  assert.equal(
    routing.liveRuleCandidates([{ ...rule, live_post_id: '456' }], 'A1', ['789'], true).length,
    0,
  )
  assert.equal(
    routing.liveRuleCandidates([{ ...rule, is_active: false }], 'A1', [], true).length,
    0,
  )
  assert.ok(rules.ruleMatches({ match_type: 'keyword', keywords: ['สนใจ'] }, 'สนใจค่ะ'))
})

test('live_comments are normalized before persistence and deduplicate against feed without processing edits', () => {
  const parse = (changes) =>
    envelope.parseWebhook(
      Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: '100', changes }] })),
    ).events
  const events = parse([
    {
      field: 'live_comments',
      value: { id: '100_555', video_id: '456', from: { id: '900' }, message: 'A1' },
    },
    {
      field: 'feed',
      value: {
        comment_id: '100_555',
        post_id: '456',
        from: { id: '900' },
        message: 'A1',
        item: 'comment',
        verb: 'add',
      },
    },
  ])
  assert.equal(events[0].eventKey, events[1].eventKey)
  assert.equal(events[0].payload.value.comment_id, '100_555')
  assert.equal(events[0].payload.value.post_id, '456')
  assert.equal(events[0].payload.value.verb, 'add')
  assert.equal(
    parse([{ field: 'live_comments', value: { id: '100_555', verb: 'edited' } }])[0].payload.value
      .verb,
    'edited',
  )
})

test('configured alias creates one pending order using storefront product price, caps allocation, and restores stock on cancel', async () => {
  const f = await fixture()
  try {
    const pid = await f.product(),
      rid = await f.rule(pid, { limit: 1, code: 'Z99', post: '456' })
    const a = await f.place(rid, 'z99', 'c1', { post: '100_456' })
    assert.equal(a.r_status, 'created')
    assert.equal(Number(a.r_amount), 199)
    const order = await f.one('select * from orders where id=$1', [a.r_order_id])
    assert.equal(order.source, 'live_comment')
    assert.equal(order.status, 'pending_payment')
    assert.equal(order.product_id, pid)
    assert.equal(order.source_code, 'z99')
    assert.equal(order.live_rule_id, rid)
    const replay = await f.place(rid, 'Z99', 'c1', { post: '100_456' })
    assert.equal(replay.r_order_id, a.r_order_id)
    assert.equal((await f.one('select stock from products where id=$1', [pid])).stock, 4)
    const attempts = await Promise.all([
      f.place(rid, 'z99', 'c2', { post: '456' }),
      f.place(rid, 'z99', 'c3', { post: '456' }),
    ])
    assert.ok(attempts.every((r) => r.r_status === 'sold_out'))
    assert.equal((await f.one('select count(*)::int n from orders')).n, 1)
    await f.db.query("update orders set status='cancelled' where id=$1", [a.r_order_id])
    assert.equal((await f.one('select stock from products where id=$1', [pid])).stock, 5)
    assert.equal((await f.place(rid, 'z99', 'c1', { post: '456' })).r_status, 'no_match')
    assert.equal((await f.place(rid, 'z99', 'c2', { post: '456' })).r_status, 'created')
  } finally {
    await f.db.close()
  }
})

test('variant aliases share parent/variant stock with storefront and concurrent comments cannot oversell', async () => {
  const f = await fixture()
  try {
    const pid = await f.product({
      stock: 1,
      variants: [{ label: 'สีขาว', variant_code: 'WHITE', price: 250, stock: 1 }],
    })
    const variant = (await f.one('select id from commerce_variants where product_id=$1', [pid])).id
    await assert.rejects(f.rule(pid), /เลือกสี/)
    const rid = await f.rule(pid, { variant, code: 'A1' })
    const orders = await Promise.all([f.place(rid, 'a1', 'c1'), f.place(rid, 'a1', 'c2')])
    assert.deepEqual(orders.map((o) => o.r_status).sort(), ['created', 'sold_out'])
    const order = orders.find((o) => o.r_status === 'created')
    assert.equal(order.r_variant_label, 'สีขาว')
    assert.equal(Number(order.r_amount), 250)
    assert.equal((await f.one('select stock from products where id=$1', [pid])).stock, 0)
    assert.equal(
      (await f.one('select stock from commerce_variants where id=$1', [variant])).stock,
      0,
    )
    await f.db.query(
      "insert into commerce_stores(tenant_id,slug,name,is_open) values($1,'test-shop','ร้านทดสอบ',true)",
      [T],
    )
    const checkout = () =>
      f.db.query("select commerce_checkout('test-shop',$1::jsonb)", [
        JSON.stringify({
          key: '55555555-5555-4555-8555-555555555555',
          name: 'ลูกค้า',
          phone: '0812345678',
          address: 'กรุงเทพ',
          items: [{ product_id: pid, variant_id: variant, qty: 1 }],
        }),
      ])
    await assert.rejects(checkout(), /COMMERCE_STOCK/)
    await f.db.query("update orders set status='cancelled' where id=$1", [order.r_order_id])
    assert.equal(
      (await f.one('select stock from commerce_variants where id=$1', [variant])).stock,
      1,
    )
    // Actual storefront checkout consumes the returned stock before another live comment.
    await checkout()
    assert.equal((await f.one('select stock from products where id=$1', [pid])).stock, 0)
    assert.equal(
      (await f.one('select stock from commerce_variants where id=$1', [variant])).stock,
      0,
    )
    assert.equal((await f.place(rid, 'a1', 'c3')).r_status, 'sold_out')
  } finally {
    await f.db.close()
  }
})

test('database rejects foreign products, variants, pages, invalid aliases and reused comments; disabled rules and wrong posts do not order', async () => {
  const f = await fixture()
  try {
    const pid = await f.product(),
      foreign = await f.product({ tenant: T2 })
    await assert.rejects(f.rule(foreign), /สินค้าของร้านนี้/)
    await assert.rejects(f.rule(pid, { page: '200' }), /เพจของร้านนี้/)
    await assert.rejects(f.rule(pid, { code: 'A1.*' }), /รหัสไลฟ์/)
    await assert.rejects(f.rule(pid, { limit: 0 }), /check constraint/)
    const rid = await f.rule(pid, { post: '456' })
    await assert.rejects(f.rule(pid, { post: '456' }), /ซ้ำ/)
    assert.equal((await f.place(rid, '159', 'c1', { post: '789' })).r_status, 'no_match')
    assert.equal((await f.place(rid, 'OTHER', 'c1', { post: '456' })).r_status, 'no_match')
    await assert.rejects(f.place(rid, '159', 'c1', { page: '200' }), /Page not found/)
    await assert.rejects(
      f.place(rid, '159', 'c1', { tenant: T2, page: '200' }),
      /customer not found/,
    )
    await f.db.query('update comment_rules set is_active=false where id=$1', [rid])
    assert.equal((await f.place(rid, '159', 'c1', { post: '456' })).r_status, 'no_match')
    await f.db.query('update comment_rules set is_active=true where id=$1', [rid])
    await f.place(rid, '159', 'c1', { post: '456' })
    const pid2 = await f.product()
    await assert.rejects(
      f.db.query('update comment_rules set live_product_id=$1 where id=$2', [pid2, rid]),
      /มีออเดอร์แล้ว/,
    )
    await f.db.query("update comment_rules set mode='general' where id=$1", [rid])
    await f.db.query(
      "update comment_rules set mode='live_cf',live_product_id=$2,live_post_id='456' where id=$1",
      [rid, pid],
    )
    await assert.rejects(f.place(rid, 'A1', 'c1', { post: '456' }), /already used/)
    await f.db.exec('set role authenticated')
    await assert.rejects(f.place(rid, '159', 'c2', { post: '456' }), /permission denied/)
    await f.db.exec('reset role')
  } finally {
    await f.db.close()
  }
})

test('placeCfOrder routes Live CF through the atomic RPC and keeps chat CF parameters unchanged', async () => {
  const calls = []
  const api = load('lib/features/commerce/orders.ts', {
    'server-only': {},
    '@/lib/features/banking/banks': {},
    '@/lib/features/commerce/cf-code': {},
  })
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args })
      return { data: [{ r_status: 'no_match' }], error: null }
    },
  }
  await api.placeCfOrder(db, {
    tenantId: T,
    customerId: C,
    code: '159',
    source: 'live_comment',
    ruleId: 'r',
    commentId: 'c',
    postId: '456',
    pageId: '100',
  })
  assert.equal(calls[0].name, 'place_live_cf_order')
  assert.equal(calls[0].args.p_customer, C)
  assert.equal(calls[0].args.p_code, '159')
  await api.placeCfOrder(db, { tenantId: T, customerId: C, code: 'SKU', messageId: 'm' })
  assert.equal(calls[1].name, 'place_cf_order')
  assert.equal(calls[1].args.p_message, 'm')
})

function webhookFixture({
  live = true,
  scoped = false,
  duplicate = false,
  ruleActive = true,
  graphLive = true,
  replyError = false,
  ambiguous = false,
} = {}) {
  const calls = { rpc: [], private: [], public: [], generic: [], queries: [], lookups: 0 }
  const rulesList = [
    {
      id: 'rule',
      tenant_id: T,
      page_ids: ['100'],
      name: 'Live',
      mode: 'live_cf',
      is_active: ruleActive,
      keywords: ['Z99'],
      match_type: 'keyword',
      live_post_id: scoped ? '456' : null,
    },
    {
      id: 'general',
      tenant_id: T,
      page_ids: ['100'],
      mode: 'general',
      is_active: true,
      keywords: ['สนใจ'],
      match_type: 'keyword',
      reply_enabled: true,
      reply_text: 'General reply',
    },
  ]
  if (ambiguous) rulesList.push({ ...rulesList[0], id: 'rule2' })
  const db = {
    from(table) {
      const filters = {},
        q = {
          select: () => q,
          eq(k, v) {
            filters[k] = v
            return q
          },
          contains(k, v) {
            filters[k] = v
            return q
          },
          order: () => q,
          update: () => q,
          maybeSingle: () => Promise.resolve(result()),
          then: (yes, no) => Promise.resolve(result()).then(yes, no),
        }
      function result() {
        calls.queries.push({ table, filters: { ...filters } })
        if (table === 'tenants')
          return {
            data: {
              id: T,
              page_id: '100',
              name: 'ร้านทดสอบ',
              page_name: 'เพจร้าน',
              page_access_token: 'page-token',
            },
            error: null,
          }
        if (table === 'comment_rules')
          return {
            data: rulesList.filter(
              (r) =>
                r.tenant_id === filters.tenant_id &&
                r.is_active === filters.is_active &&
                r.page_ids.includes(filters.page_ids[0]),
            ),
            error: null,
          }
        if (table === 'comments') return { data: null, error: null }
        if (table === 'orders') return { data: [{ id: 'order', amount: 250 }], error: null }
        if (table === 'bank_accounts')
          return {
            data: {
              id: 'bank',
              bank_code: 'KBANK',
              account_name: 'ร้านทดสอบ',
              account_number: '1234567890',
            },
            error: null,
          }
        if (table === 'bank_receiving_qr')
          return {
            data: {
              image_path: T + '/bank/qr.png',
              bank_code_snapshot: 'KBANK',
              account_number_snapshot: '1234567890',
            },
            error: null,
          }
        throw Error('Unexpected table ' + table)
      }
      return q
    },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args })
      return {
        data: [
          {
            r_status: 'created',
            r_order_id: 'order',
            r_name: 'เสื้อ',
            r_code: 'Z99',
            r_amount: 250,
            r_variant_label: 'สีขาว',
          },
        ],
        error: null,
      }
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://test.invalid/signed-qr' },
          error: null,
        }),
      }),
    },
  }
  const deps = {
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/integrations/facebook/client': {
      pageTokenFor: (t) => t.page_access_token,
      isLiveVideoComment: async () => {
        calls.lookups++
        return graphLive
      },
      sendPrivateReply: async (...args) => {
        calls.private.push(args)
        if (replyError) throw Error('META_SEND_FAILED')
      },
      replyToComment: async (...args) => {
        calls.public.push(args)
      },
      privateReply: async (...args) => {
        calls.generic.push(args)
      },
    },
    '@/lib/features/comments/comment-rules': rules,
    '@/lib/features/comments/live-comment-routing': routing,
    '@/lib/features/commerce/orders': load('lib/features/commerce/orders.ts', {
      'server-only': {},
      '@/lib/features/banking/banks': {},
      '@/lib/features/commerce/cf-code': load('lib/features/commerce/cf-code.ts'),
    }),
    '@/lib/features/commerce/live-cf-comment': load('lib/features/commerce/live-cf-comment.ts', {
      './cf-code': load('lib/features/commerce/cf-code.ts'),
    }),
    '@/lib/features/banking/banks': { findBank: () => ({ name: 'ธนาคารกสิกรไทย' }) },
    '@/lib/features/agents/chatbot-server': {},
    '@/lib/features/slips/process': {},
    '@/lib/features/slips/notify': {},
    '@/lib/features/slips/image': {},
    '@/lib/message-quota': { sendWithMessageCredit: async (_db, _tenant, send) => send() },
    '@/lib/features/follow-ups/followup-ai': {},
    '@/lib/features/vision/vision': {},
    '@/lib/features/broadcast/broadcast-policy': {},
    '@/lib/integrations/facebook/message-window': {},
    '@/lib/features/inbox/inbox-automation-window': {},
  }
  const handler = load('lib/integrations/facebook/webhook-handler.ts', deps, {
    console: { log() {}, warn() {}, info() {}, error() {} },
    process: { env: {} },
  })
  const steps = new Map()
  const execution = {
    event: {
      kind: 'change',
      page_id: '100',
      payload: {
        field: live ? 'live_comments' : 'feed',
        value: {
          comment_id: '100_555',
          post_id: '100_456',
          item: 'comment',
          verb: 'add',
          from: { id: '900' },
          message: 'ขอ CF Z99 ค่ะ',
        },
      },
    },
    persistRecord: async () => ({
      id: 'comment',
      duplicate,
      customer: { id: C, bot_enabled: true },
    }),
    once: async (name, work) => {
      if (!steps.has(name)) steps.set(name, await work())
      return steps.get(name)
    },
  }
  return { calls, execution, run: () => handler.handleFacebookWebhookEvent(execution) }
}

test('webhook configured Live CF creates pending order once, sends primary QR with the correct Page token and comment recipient, then public confirmation', async () => {
  for (const options of [
    { live: true },
    { live: false, scoped: true },
    { live: false, graphLive: true },
  ]) {
    const f = webhookFixture(options)
    await f.run()
    await f.run()
    assert.equal(f.calls.rpc.length, 1)
    assert.equal(f.calls.rpc[0].name, 'place_live_cf_order')
    assert.equal(f.calls.rpc[0].args.p_customer, C)
    assert.equal(f.calls.rpc[0].args.p_page, '100')
    assert.equal(f.calls.rpc[0].args.p_code, 'z99')
    assert.equal(f.calls.private.length, 1)
    assert.equal(f.calls.private[0][0], 'page-token')
    assert.equal(f.calls.private[0][1], '100_555')
    assert.match(f.calls.private[0][2], /250\.00/)
    assert.equal(f.calls.private[0][3], 'https://test.invalid/signed-qr')
    assert.equal(f.calls.public.length, 1)
    assert.match(f.calls.public[0][2], /รับออเดอร์/)
    assert.ok(
      f.calls.queries
        .filter((q) =>
          ['bank_accounts', 'bank_receiving_qr', 'orders', 'comment_rules'].includes(q.table),
        )
        .every((q) => q.filters.tenant_id === T),
    )
  }
})

test('ordinary posts, disabled rules, duplicate comments, own replies, missing authors and ambiguous aliases do not create orders', async () => {
  for (const options of [
    { live: false, graphLive: false },
    { ruleActive: false },
    { duplicate: true },
    { ambiguous: true },
  ]) {
    const f = webhookFixture(options)
    await f.run()
    assert.equal(f.calls.rpc.length, 0)
    assert.equal(f.calls.private.length, 0)
  }
  for (const author of [undefined, { id: '100' }]) {
    const f = webhookFixture()
    f.execution.event.payload.value.from = author
    await f.run()
    assert.equal(f.calls.rpc.length, 0)
  }
  const general = webhookFixture({ live: false })
  general.execution.event.payload.value.message = 'สนใจค่ะ'
  await general.run()
  assert.equal(general.calls.rpc.length, 0)
  assert.equal(general.calls.public[0][2], 'General reply')
  assert.equal(general.calls.lookups, 0)
})

test('private reply rejection propagates to the durable worker without undoing the order or claiming publicly that delivery succeeded', async () => {
  const f = webhookFixture({ replyError: true })
  await assert.rejects(f.run(), /META_SEND_FAILED/)
  assert.equal(f.calls.rpc.length, 1)
  assert.equal(f.calls.public.length, 0)
})

test('stock stream scopes subscriptions and reads, never lets stale snapshots overwrite events, and cleans up on disconnect', async () => {
  const { subscribeCommerceStock } = load(
    'lib/features/commerce/stock-subscription.ts',
    {},
    { AbortController, console },
  )
  const callbacks = {},
    queries = [],
    pending = [],
    updates = []
  let status,
    removed = 0
  const ch = {
    on(_kind, filter, cb) {
      callbacks[filter.table] = cb
      assert.equal(filter.filter, 'tenant_id=eq.' + T)
      return ch
    },
    subscribe(cb) {
      status = cb
    },
  }
  const db = {
    channel: () => ch,
    removeChannel: async (value) => {
      assert.equal(value, ch)
      removed++
    },
    from(table) {
      const q = {
        select: () => q,
        eq(k, v) {
          queries.push({ table, key: k, value: v })
          return q
        },
        in(k, v) {
          queries.push({ table, key: k, value: v })
          return q
        },
        abortSignal: () => new Promise((resolve) => pending.push({ table, resolve })),
      }
      return q
    },
  }
  const dispose = subscribeCommerceStock(db, T, ['p1'], (v) => updates.push(v))
  status('SUBSCRIBED')
  callbacks.products({ new: { id: 'p1', tenant_id: T, stock: 2, commerce_version: 3 } })
  callbacks.commerce_variants({ new: { id: 'v1', product_id: 'p1', tenant_id: T, stock: 2 } })
  callbacks.products({ new: { id: 'p1', tenant_id: T2, stock: 100, commerce_version: 100 } })
  for (const p of pending)
    p.resolve({
      data:
        p.table === 'products'
          ? [{ id: 'p1', stock: 5, commerce_version: 1 }]
          : [{ id: 'v1', stock: 5 }],
      error: null,
    })
  await new Promise((r) => setImmediate(r))
  assert.equal(updates.length, 3)
  assert.equal(updates[2].products.length, 0)
  assert.equal(updates[2].variants.length, 0)
  assert.ok(queries.every((q) => q.key !== 'tenant_id' || q.value === T))
  dispose()
  assert.equal(removed, 1)
  callbacks.products({ new: { id: 'p1', tenant_id: T, stock: 1, commerce_version: 4 } })
  status('SUBSCRIBED')
  assert.equal(updates.length, 3)
  assert.equal(pending.length, 2)
})

test('Meta client verifies a feed video before treating it as Live and sends one comment-scoped private card', async () => {
  const requests = [],
    logs = []
  let kind = 'live'
  const client = load(
    'lib/integrations/facebook/client.ts',
    {
      '@/lib/safe-logging': {
        createLogRequestId: () => 'test',
        logSafeEvent() {},
        maskErrorCode() {},
      },
    },
    {
      process: { env: {} },
      AbortSignal,
      console: { error: (...args) => logs.push(args) },
      fetch: async (url, options) => {
        requests.push({ url, options })
        assert.equal(options.headers.Authorization, 'Bearer test-token')
        if (options.method === 'POST') return Response.json({ message_id: 'mid' })
        if (kind === 'denied')
          return Response.json(
            { error: { code: 10, message: 'Permission denied test-token' } },
            { status: 403 },
          )
        if (decodeURIComponent(url).includes('attachments{'))
          return Response.json({
            attachments: {
              data: [{ media_type: kind === 'photo' ? 'photo' : 'video', target: { id: '456' } }],
            },
          })
        return Response.json({ live_status: kind === 'ended' ? 'LIVE_STOPPED' : 'LIVE' })
      },
    },
  )
  assert.equal(await client.isLiveVideoComment('test-token', '100_456'), true)
  assert.equal(requests.length, 2)
  assert.match(decodeURIComponent(requests[1].url), /456\?fields=live_status/)
  kind = 'ended'
  assert.equal(await client.isLiveVideoComment('test-token', '100_456'), false)
  kind = 'photo'
  assert.equal(await client.isLiveVideoComment('test-token', '100_456'), false)
  assert.equal(await client.isLiveVideoComment('test-token', 'bad-id'), false)
  kind = 'denied'
  await assert.rejects(
    client.isLiveVideoComment('test-token', '100_456'),
    /LIVE_COMMENT_LOOKUP_FAILED/,
  )
  assert.ok(logs.length > 0)
  assert.ok(!JSON.stringify(logs).includes('test-token'))
  await client.sendPrivateReply(
    'test-token',
    '100_555',
    'ยอดชำระ 250.00 บาท · เสื้อสีขาว\nโอน ธนาคารกสิกรไทย',
    'https://test.invalid/qr.png',
  )
  const request = requests.at(-1),
    body = JSON.parse(request.options.body)
  assert.match(request.url, /\/me\/messages$/)
  assert.deepEqual(body.recipient, { comment_id: '100_555' })
  assert.equal(body.message.attachment.payload.elements[0].image_url, 'https://test.invalid/qr.png')
  assert.match(body.message.attachment.payload.elements[0].title, /250\.00/)
  assert.equal(body.messaging_type, undefined)
  assert.equal(body.tag, undefined)
})

test('editor catalog reads only active products and variants in the active tenant and reports lookup failures', async () => {
  const { liveProducts } = load('lib/features/comments/live-products.ts', { 'server-only': {} })
  const filters = []
  let failed = false
  const db = {
    from(table) {
      const q = {
        select: () => q,
        eq(k, v) {
          filters.push({ table, k, v })
          return q
        },
        order: () => q,
        limit: () =>
          Promise.resolve({
            data:
              table === 'products'
                ? [{ id: 'p', name: 'เสื้อ', code: 'SKU', price: 199, stock: 3 }]
                : [{ id: 'v', product_id: 'p', label: 'สีขาว', price: 250, stock: 3 }],
            error: failed ? { code: 'DB_DOWN' } : null,
          }),
      }
      return q
    },
  }
  const value = await liveProducts(db, T)
  assert.equal(value.error, null)
  assert.equal(value.products[0].variants[0].label, 'สีขาว')
  assert.ok(filters.filter((f) => f.k === 'tenant_id').every((f) => f.v === T))
  assert.equal(filters.filter((f) => f.k === 'is_active' && f.v === true).length, 2)
  failed = true
  const error = await liveProducts(db, T)
  assert.ok(error.error)
  assert.equal(error.products.length, 0)
})
