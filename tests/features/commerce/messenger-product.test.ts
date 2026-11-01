import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { parseWebhook } from '../../../lib/integrations/facebook/webhook-envelope'
import { facebookInboundMessage } from '../../../lib/integrations/facebook/message-window'
import {
  buildProductReply,
  extractProductCode,
  handleInboundProductMessage,
  type MessengerProduct,
} from '../../../lib/features/commerce/messenger-product'

const tenant = '11111111-1111-4111-8111-111111111111'
const otherTenant = '22222222-2222-4222-8222-222222222222'
const productId = 'cf000000-0000-4000-8000-000000000001'
const variantId = '33333333-3333-4333-8333-333333333333'
const product: MessengerProduct = {
  id: productId,
  name: 'เสื้อยืด',
  price: '159.00',
  description: 'ผ้านุ่ม ใส่สบาย',
  images: ['https://shop.example/shirt.jpg'],
  store_slug: 'my-shop',
  sales_page_url: null,
  variant_id: null,
  variant_label: null,
}

test('extracts exact Messenger codes with prefixes, punctuation, case, and leading zeroes', () => {
  for (const [text, code] of [
    ['FC 1', '1'],
    ['CF 1', '1'],
    ['1', '1'],
    ['CF 159', '159'],
    ['159', '159'],
    ['สนใจ 09', '09'],
    ['เอา 1', '1'],
    ['รับ A1', 'A1'],
    ['จอง A1', 'A1'],
    ['A1', 'A1'],
    ['cf: #a1!', 'A1'],
    ['  fc1  ', '1'],
    ['CF Ａ１', 'A1'],
    ['CF SKU - 1', 'SKU-1'],
    [productId, productId.toUpperCase()],
    ['CF RED', 'RED'],
  ])
    assert.equal(extractProductCode(text), code, text)
  for (const text of [
    'สวัสดีค่ะ',
    'ราคาเท่าไร',
    'สนใจค่ะ',
    'รับทราบ',
    'เอาอะไรดี',
    'hello',
    'hello world',
    'ราคา 159 บาท',
    'เอา 1 2',
    'CF 1 และ 2',
    'CF',
    '',
    null,
    undefined,
    159,
    { text: '1' },
    '1'.repeat(201),
    '1),tenant_id.eq.other',
  ])
    assert.equal(extractProductCode(text), null, String(text))
})

test('builds a product card with price, image, description, and direct sales-page button', () => {
  const reply = buildProductReply(product, 'https://shop.example')!
  const element = reply.message.attachment.payload.elements[0]
  assert.equal(reply.message.attachment.payload.template_type, 'generic')
  assert.equal(element.title, 'เสื้อยืด')
  assert.equal(element.subtitle, 'ราคา ฿159.00 · ผ้านุ่ม ใส่สบาย')
  assert.equal(element.image_url, product.images[0])
  assert.deepEqual(element.buttons, [
    {
      type: 'web_url',
      title: 'สั่งซื้อผ่านเซลเพจ 🛒',
      url: `https://shop.example/s/my-shop?product=${productId}`,
    },
  ])
  assert.ok(Array.from(element.buttons[0].title).length <= 20)
  assert.match(reply.body, /159\.00/)
  assert.match(reply.body, /ผ้านุ่ม/)
})

test('cards tolerate missing/invalid images, shorten Meta fields, and preserve variant/page links', () => {
  const reply = buildProductReply(
    {
      ...product,
      name: 'ก'.repeat(100),
      description: '<b>' + 'ข'.repeat(100) + '</b>',
      images: ['javascript:alert(1)', 'https://user:pass@shop.example/image'],
      sales_page_url: '/s/my-shop/promo?campaign=chat',
      variant_id: variantId,
      variant_label: 'สีขาว',
    },
    'https://shop.example',
  )!
  const element = reply.message.attachment.payload.elements[0]
  assert.equal(element.image_url, undefined)
  assert.equal(Array.from(element.title).length, 80)
  assert.equal(Array.from(element.subtitle).length, 80)
  assert.equal(new URL(element.buttons[0].url).searchParams.get('variant'), variantId)
  assert.equal(new URL(element.buttons[0].url).searchParams.get('campaign'), 'chat')
  assert.equal(new URL(element.buttons[0].url).pathname, '/s/my-shop/promo')
  assert.ok(!reply.body.includes('<b>'))
  assert.equal(buildProductReply(product, undefined), null)
  assert.equal(buildProductReply({ ...product, price: 'invalid' }, 'https://shop.example'), null)
})

test('ordinary conversation skips lookup; unknown codes fall through without sending an error', async () => {
  let lookups = 0
  let sends = 0
  const dependencies = {
    appOrigin: 'https://shop.example',
    findProduct: async () => {
      lookups++
      return null
    },
    sendReply: async () => {
      sends++
    },
  }
  assert.equal(await handleInboundProductMessage('สวัสดีค่ะ', dependencies), false)
  assert.equal(lookups, 0)
  assert.equal(await handleInboundProductMessage('CF 999', dependencies), false)
  assert.equal(lookups, 1)
  assert.equal(sends, 0)
})

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table tenants(id uuid primary key, is_active boolean default true);
    create table products(
      id uuid primary key default gen_random_uuid(), tenant_id uuid, code text, name text,
      price numeric, description text, image_url text, commerce_images jsonb default '[]',
      is_active boolean default true, commerce_archived boolean default false, stock integer default 5
    );
    create table commerce_stores(tenant_id uuid, slug text, is_open boolean default true);
    create table commerce_variants(
      id uuid primary key, tenant_id uuid, product_id uuid, variant_code text, label text,
      price numeric, is_active boolean default true, stock integer default 5
    );
    create table orders(id uuid);
  `)
  const migration = await readFile('supabase/messenger-product-lookup.sql', 'utf8')
  await db.exec(migration)
  await db.exec(migration)
  await db.query('insert into tenants(id) values($1),($2)', [tenant, otherTenant])
  await db.query("insert into commerce_stores values($1,'my-shop',true),($2,'other-shop',true)", [
    tenant,
    otherTenant,
  ])
  await db.query(
    `insert into products(id,tenant_id,code,name,price,description,image_url)
    values($1,$2,'1','เสื้อยืด',159,'ผ้านุ่ม ใส่สบาย','https://shop.example/shirt.jpg')`,
    [productId, tenant],
  )
  await db.query(
    `insert into products(tenant_id,code,name,price) values
    ($1,'1','สินค้าร้านอื่น',999),($1,'999','รหัสร้านอื่น',999),
    ($2,'09','สินค้า 09',90),($2,'159','สินค้า 159',159)`,
    [otherTenant, tenant],
  )
  const find = async (tenantId: string, code: string) => {
    const result = await db.query<MessengerProduct>(
      'select * from messenger_product_lookup($1,$2)',
      [tenantId, code],
    )
    return result.rows[0] ?? null
  }
  return { db, find }
}

test('FC 1, CF 1, and 1 use actual tenant-scoped SQL lookup and send product data without creating orders', async () => {
  const { db, find } = await database()
  try {
    for (const text of ['FC 1', 'CF 1', '1']) {
      const replies: string[] = []
      assert.equal(
        await handleInboundProductMessage(text, {
          appOrigin: 'https://shop.example',
          findProduct: (code) => find(tenant, code),
          sendReply: async (reply) => {
            replies.push(reply.body)
          },
        }),
        true,
      )
      assert.equal(replies.length, 1)
      assert.match(replies[0], /เสื้อยืด/)
      assert.ok(!replies[0].includes('สินค้าร้านอื่น'))
    }
    assert.equal((await find(tenant, '09'))?.name, 'สินค้า 09')
    assert.equal((await find(tenant, productId))?.name, 'เสื้อยืด')
    assert.equal(await find(tenant, '999'), null)
    assert.equal(await find(tenant, '15'), null)
    assert.equal(
      (await db.query<{ stock: number }>('select stock from products where id=$1', [productId]))
        .rows[0].stock,
      5,
    )
    assert.equal(
      (await db.query<{ count: number }>('select count(*)::int count from orders')).rows[0].count,
      0,
    )
  } finally {
    await db.close()
  }
})

test('SQL lookup handles variants, optional cf_code/sku/images, inactive products and ambiguous codes', async () => {
  const { db, find } = await database()
  try {
    await db.query('insert into commerce_variants values($1,$2,$3,$4,$5,259,true,5)', [
      variantId,
      tenant,
      productId,
      'A1',
      'สีขาว',
    ])
    const variant = (await find(tenant, 'a1'))!
    assert.equal(variant.variant_id, variantId)
    assert.equal(Number(variant.price), 259)
    assert.equal(variant.variant_label, 'สีขาว')
    assert.equal(await find(otherTenant, 'a1'), null)
    await db.exec(
      'alter table products add column cf_code text; alter table products add column sku text; alter table products add column sales_page_url text;',
    )
    await db.query(
      `update products set cf_code='CF09',sku='SKU-1',commerce_images='["https://shop.example/new.jpg"]',sales_page_url='/s/my-shop/promo' where id=$1`,
      [productId],
    )
    for (const code of ['cf09', 'SKU-1']) {
      const matched = (await find(tenant, code))!
      assert.equal(matched.id, productId)
      assert.deepEqual(matched.images, ['https://shop.example/new.jpg'])
      assert.equal(matched.sales_page_url, '/s/my-shop/promo')
    }
    await db.query("update products set sku='A1' where id=$1", [productId])
    assert.equal(
      await find(tenant, 'A1'),
      null,
      'parent and variant alias collision must not choose arbitrarily',
    )
    await db.query('update commerce_variants set is_active=false where id=$1', [variantId])
    assert.equal((await find(tenant, 'A1'))?.variant_id, null)
    await db.query('update products set is_active=false where id=$1', [productId])
    assert.equal(await find(tenant, '1'), null)
    await db.query('update products set is_active=true,commerce_archived=true where id=$1', [
      productId,
    ])
    assert.equal(await find(tenant, '1'), null)
    await db.query('update products set commerce_archived=false where id=$1', [productId])
    await db.query('update commerce_stores set is_open=false where tenant_id=$1', [tenant])
    assert.equal(await find(tenant, '1'), null)
    await db.query('update commerce_stores set is_open=true where tenant_id=$1', [tenant])
    await db.query('update tenants set is_active=false where id=$1', [tenant])
    assert.equal(await find(tenant, '1'), null)
    const permissions = await db.query<{ role: string; allowed: boolean }>(`
      select role, has_function_privilege(role,'public.messenger_product_lookup(uuid,text)','execute') allowed
      from unnest(array['anon','authenticated','service_role']) role
    `)
    assert.deepEqual(
      permissions.rows.map((r) => r.allowed),
      [false, false, true],
    )
  } finally {
    await db.close()
  }
})

const require = createRequire(import.meta.url)
const load = require('../../../scripts/helpers/load-typescript.cjs')

test('server delivery uses sender PSID, RESPONSE, and the durable per-inbound-message key', async () => {
  const sent: unknown[][] = []
  const rpcCalls: unknown[][] = []
  const module = load(
    'lib/features/commerce/messenger-product-server.ts',
    {
      'server-only': {},
      '@/lib/features/commerce/commerce-core': { commerceFlag: () => true },
      '@/lib/features/commerce/messenger-product': { handleInboundProductMessage },
      '@/lib/features/slips/notify': {
        BotDeliveryBlockedError: class extends Error {},
        deliverRichOnce: async (...args: unknown[]) => {
          sent.push(args)
          return true
        },
      },
      '@/lib/features/inbox/inbox-automation-window': {
        InboxAutomationWindowError: class extends Error {},
      },
    },
    { process: { env: { NEXT_PUBLIC_APP_URL: 'https://shop.example' } } },
  )
  const db = {
    rpc: async (...args: unknown[]) => {
      rpcCalls.push(args)
      return { data: [product], error: null }
    },
  }
  const recipient = { id: 'customer-id', psid: 'messenger-sender-id', token: 'page-token' }
  assert.equal(
    await module.replyToMessengerProduct(db, tenant, recipient, 'inbound-id', 'FC 1'),
    true,
  )
  assert.equal(rpcCalls[0][0], 'messenger_product_lookup')
  assert.deepEqual({ ...(rpcCalls[0][1] as object) }, { p_tenant: tenant, p_code: '1' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0][1], recipient)
  assert.equal(sent[0][2], 'product:inbound-id')
  assert.equal(sent[0][5], 'RESPONSE')
  assert.equal(
    await module.replyToMessengerProduct(db, tenant, recipient, 'inbound-id-2', 'สวัสดี'),
    false,
  )
  assert.equal(sent.length, 1)
})

function webhookHarness(
  options: { autoReply?: boolean; botEnabled?: boolean; duplicate?: boolean } = {},
) {
  const calls = { products: 0, cards: 0, answers: 0, orders: 0 }
  const shop = { id: tenant, page_id: '100', auto_reply_enabled: options.autoReply ?? true }
  const checkpoints = new Map<string, unknown>()
  const db = {
    from(table: string) {
      assert.ok(
        ['tenants', 'customers'].includes(table),
        `unexpected database mutation/query: ${table}`,
      )
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        async maybeSingle() {
          return {
            data: table === 'tenants' ? shop : { bot_enabled: options.botEnabled ?? true },
            error: null,
          }
        },
      }
    },
  }
  const handler = load(
    'lib/integrations/facebook/webhook-handler.ts',
    {
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/integrations/facebook/client': {
        pageTokenFor: () => 'page-token',
        getCustomerProfile: async () => ({}),
      },
      '@/lib/features/comments/comment-rules': {},
      '@/lib/features/comments/live-comment-routing': {},
      '@/lib/features/agents/chatbot-server': {
        answerChat: async () => {
          calls.answers++
        },
      },
      '@/lib/features/commerce/orders': {
        placeCfOrder: () => {
          calls.orders++
          throw Error('inquiries must not create orders')
        },
      },
      '@/lib/features/commerce/messenger-product-server': {
        replyToMessengerProduct: async (
          _db: unknown,
          scope: string,
          recipient: { psid: string },
          messageId: string,
          text: string,
        ) => {
          calls.products++
          assert.equal(scope, tenant)
          assert.equal(recipient.psid, '900')
          assert.equal(messageId, 'stored-inbound-id')
          return handleInboundProductMessage(text, {
            appOrigin: 'https://shop.example',
            findProduct: async (code) => (code === '1' ? product : null),
            sendReply: async () => {
              calls.cards++
            },
          })
        },
      },
      '@/lib/features/commerce/live-cf-comment': {},
      '@/lib/features/commerce/auction-server': { handleAuctionComment: async () => false },
      '@/lib/features/commerce/live-cf-payment-link': {},
      '@/lib/integrations/facebook/live-cf-adapter': {},
      '@/lib/feature-flags': {},
      '@/lib/features/banking/banks': {},
      '@/lib/features/slips/process': {},
      '@/lib/features/slips/notify': {},
      '@/lib/features/slips/image': { slipCandidates: () => [] },
      '@/lib/message-quota': {},
      '@/lib/features/follow-ups/followup-ai': { observeFollowUpMessage: async () => {} },
      '@/lib/features/vision/vision': { queueMessengerVision: async () => false },
      '@/lib/features/broadcast/broadcast-policy': { inboundBroadcastEvidence: () => null },
      '@/lib/integrations/facebook/message-window': { facebookInboundMessage },
      '@/lib/features/inbox/inbox-automation-window': {
        InboxAutomationWindowError: class extends Error {},
      },
    },
    { process: { env: {} }, console: { log() {}, warn() {}, info() {} } },
  )
  return {
    calls,
    async receive(text: string, echo = false) {
      const time = Date.now()
      const parsed = parseWebhook(
        Buffer.from(
          JSON.stringify({
            object: 'page',
            entry: [
              {
                id: '100',
                messaging: [
                  {
                    sender: { id: '900' },
                    recipient: { id: '100' },
                    timestamp: time,
                    message: { mid: 'meta-inbound-id', text, ...(echo ? { is_echo: true } : {}) },
                  },
                ],
              },
            ],
          }),
        ),
      ).events[0]
      await handler.handleFacebookWebhookEvent({
        event: {
          id: 'event-id',
          page_id: parsed.pageId,
          kind: parsed.kind,
          payload: parsed.payload,
          created_at: new Date(time).toISOString(),
        },
        persistRecord: async () => ({
          duplicate: options.duplicate ?? false,
          id: 'stored-inbound-id',
          customer: {
            id: 'customer-id',
            display_name: 'ลูกค้า',
            bot_enabled: options.botEnabled ?? true,
          },
        }),
        once: async (key: string, work: () => Promise<unknown>) => {
          if (!checkpoints.has(key)) checkpoints.set(key, await work())
          return checkpoints.get(key)
        },
      })
    },
  }
}

test('entry.messaging text reaches product routing before AI, with retry checkpoints and no order creation', async () => {
  for (const text of ['FC 1', 'CF 1', '1']) {
    const harness = webhookHarness()
    await harness.receive(text)
    await harness.receive(text)
    assert.deepEqual(harness.calls, { products: 1, cards: 1, answers: 0, orders: 0 })
  }
  for (const text of ['สวัสดีค่ะ', 'CF 999']) {
    const harness = webhookHarness()
    await harness.receive(text)
    assert.deepEqual(harness.calls, { products: 1, cards: 0, answers: 1, orders: 0 })
  }
})

test('Messenger product routing respects shop/chat pause, inbound deduplication, and echo filtering', async () => {
  for (const options of [{ autoReply: false }, { botEnabled: false }, { duplicate: true }]) {
    const harness = webhookHarness(options)
    await harness.receive('FC 1')
    assert.deepEqual(harness.calls, { products: 0, cards: 0, answers: 0, orders: 0 })
  }
  const harness = webhookHarness()
  await harness.receive('FC 1', true)
  assert.deepEqual(harness.calls, { products: 0, cards: 0, answers: 0, orders: 0 })
})
