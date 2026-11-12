import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { cfCode } from '../../../lib/features/commerce/cf-code'
import {
  handleLiveCfComment,
  type LiveCfOrder,
  type LiveCfPayment,
} from '../../../lib/features/commerce/live-cf-comment'

const tenantId = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
const customerId = '33333333-3333-4333-8333-333333333333'
const psid = '987654321'

async function commerceDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table tenants(
      id uuid primary key,
      is_active boolean not null default true,
      plan text not null default 'starter',
      plan_expires_at timestamptz not null default now() + interval '1 month'
    );
    create table tenant_members(tenant_id uuid,user_id uuid,role text);
    create table platform_admins(user_id uuid);
    create table customers(
      id uuid primary key,
      tenant_id uuid,
      platform text not null,
      platform_user_id text not null,
      unique(platform,platform_user_id)
    );
    create table products(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      code text not null,
      name text not null,
      price numeric(12,2) not null,
      stock integer not null,
      is_active boolean not null default true,
      description text,
      image_url text,
      created_at timestamptz not null default now()
    );
    create unique index products_tenant_code on products(tenant_id,lower(code));
    create table orders(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      customer_id uuid not null references customers(id),
      product_id uuid references products(id),
      product_name text not null,
      amount numeric(12,2) not null,
      message_id uuid unique,
      status text not null default 'pending_payment'
    );
  `)
  await db.exec(await readFile('supabase/commerce-v2.sql', 'utf8'))
  await db.exec(await readFile('supabase/live-cf-variants.sql', 'utf8'))
  await db.exec(await readFile('supabase/live-cf-variants.sql', 'utf8'))
  await db.query('insert into tenants(id) values($1)', [tenantId])
  await db.query("insert into tenant_members values($1,$2,'owner')", [tenantId, actorId])
  await db.query(
    'insert into customers(id,tenant_id,platform,platform_user_id) values($1,$2,$3,$4)',
    [customerId, tenantId, 'facebook', psid],
  )
  return db
}

async function saveProduct(
  db: PGlite,
  input: { code: string; name: string; price: number; stock: number; variants?: object[] },
) {
  const result = await db.query<{ id: string }>(
    'select commerce_save_product($1,$2,null,$3::jsonb) id',
    [
      tenantId,
      actorId,
      JSON.stringify({
        ...input,
        description: '',
        images: [],
        category_id: null,
        compare_price: null,
        cost: null,
        featured: false,
        is_active: true,
        variants: input.variants ?? [],
      }),
    ],
  )
  return result.rows[0].id
}

async function placeCommentOrder(db: PGlite, code: string, commentId: string) {
  const result = await db.query('select * from place_cf_order($1,$2,$3,$4,$5)', [
    tenantId,
    code,
    psid,
    'facebook_comment',
    commentId,
  ])
  return result.rows[0] as {
    r_status: string
    r_order_id: string | null
    r_name: string | null
    r_code: string | null
    r_amount: number | null
    r_variant_label: string | null
  }
}

test('live comment CF orders match codes, protect stock, and send one secure payment link', async () => {
  const db = await commerceDb()
  try {
    const simpleProduct = await saveProduct(db, {
      code: '159',
      name: 'สบู่สมุนไพร',
      price: 159,
      stock: 2,
    })
    const simpleOrder = await placeCommentOrder(db, '159', 'comment-simple')
    assert.equal(simpleOrder.r_status, 'created')
    assert.equal(Number(simpleOrder.r_amount), 159)
    assert.equal(
      (await db.query<{ stock: number }>('select stock from products where id=$1', [simpleProduct]))
        .rows[0].stock,
      1,
    )
    assert.equal(
      (
        await db.query<{ source: string; source_id: string }>(
          'select source,source_id from orders where id=$1',
          [simpleOrder.r_order_id],
        )
      ).rows[0].source_id,
      'comment-simple',
    )

    const variantProduct = await saveProduct(db, {
      code: 'COLOR',
      name: 'เสื้อยืด',
      price: 199,
      stock: 1,
      variants: [{ label: 'สีขาว', variant_code: '159W', price: 199, stock: 1 }],
    })
    const variantOrder = await placeCommentOrder(db, '159W', 'comment-variant')
    assert.equal(variantOrder.r_status, 'created')
    assert.equal(variantOrder.r_code, '159W')
    assert.equal(variantOrder.r_variant_label, 'สีขาว')
    const savedVariant = (
      await db.query<{ variant_id: string; variant_label: string }>(
        'select variant_id,variant_label from orders where id=$1',
        [variantOrder.r_order_id],
      )
    ).rows[0]
    assert.ok(savedVariant.variant_id)
    assert.equal(savedVariant.variant_label, 'สีขาว')
    assert.equal(
      (
        await db.query<{ stock: number }>(
          'select stock from commerce_variants where variant_code=$1',
          ['159W'],
        )
      ).rows[0].stock,
      0,
    )
    assert.equal(
      (
        await db.query<{ stock: number }>('select stock from products where id=$1', [
          variantProduct,
        ])
      ).rows[0].stock,
      0,
    )

    const configurableProduct = await saveProduct(db, {
      code: '260',
      name: 'แก้วน้ำ',
      price: 99,
      stock: 3,
      variants: [{ label: 'สีดำ', variant_code: '260B', price: 99, stock: 3 }],
    })
    const requireVariant = await placeCommentOrder(db, '260', 'comment-needs-variant')
    assert.equal(requireVariant.r_status, 'require_variant')
    assert.equal(requireVariant.r_name, 'แก้วน้ำ')
    assert.equal(
      (
        await db.query<{ count: number }>(
          'select count(*)::int count from orders where source_id=$1',
          ['comment-needs-variant'],
        )
      ).rows[0].count,
      0,
    )
    assert.equal(
      (
        await db.query<{ stock: number }>(
          'select stock from commerce_variants where variant_code=$1',
          ['260B'],
        )
      ).rows[0].stock,
      3,
    )
    assert.equal(
      (
        await db.query<{ stock: number }>('select stock from products where id=$1', [
          configurableProduct,
        ])
      ).rows[0].stock,
      3,
    )

    const payment: LiveCfPayment = {
      bankName: 'ธนาคารกสิกรไทย',
      accountName: 'ร้านทดสอบ',
      accountNumber: '1234567890',
    }
    const replies: string[] = []
    const publicReplies: string[] = []
    const handle = (text: string, commentId: string) =>
      handleLiveCfComment(
        { text, commentId, code: cfCode(text) ?? undefined },
        {
          placeOrder: (code) =>
            placeCommentOrder(db, code, commentId).then(
              (row) =>
                ({
                  status: row.r_status,
                  orderId: row.r_order_id,
                  name: row.r_name,
                  code: row.r_code,
                  amount: Number(row.r_amount),
                  variantLabel: row.r_variant_label,
                }) as LiveCfOrder,
            ),
          getPayment: async () => payment,
          getPendingTotal: async () => 159,
          getPaymentLink: async (orderId) => `https://shop.example/pay/live/${orderId}.signed`,
          sendPrivateReply: async (message) => void replies.push(message),
          replyToComment: async (message) => {
            publicReplies.push(message)
          },
        },
      )

    assert.equal(cfCode('CF 159'), '159')
    assert.equal(await handle('CF 159', 'comment-simple'), true)
    assert.match(replies[0], /159/)
    assert.match(replies[0], /https:\/\/shop\.example\/pay\/live\//)
    assert.match(publicReplies[0], /รับออเดอร์แล้วค่ะ/)
    assert.equal(
      (await db.query<{ count: number }>('select count(*)::int count from orders')).rows[0].count,
      2,
    )

    assert.equal(cfCode('CF 159W'), '159w')
    assert.equal(await handle('CF 159W', 'comment-variant'), true)
    assert.match(publicReplies[1], /รับออเดอร์แล้วค่ะ/)
    assert.equal(
      (
        await db.query<{ stock: number }>(
          'select stock from commerce_variants where variant_code=$1',
          ['159W'],
        )
      ).rows[0].stock,
      0,
    )

    assert.equal(await handle('CF 260', 'comment-require-variant'), true)
    assert.match(replies[2], /มีตัวเลือกสินค้า/)
    assert.match(publicReplies[2], /มีตัวเลือก/)
    assert.equal(
      (
        await db.query<{ stock: number }>(
          'select stock from commerce_variants where variant_code=$1',
          ['260B'],
        )
      ).rows[0].stock,
      3,
    )

    await assert.rejects(
      placeCommentOrder(db, 'COLOR', 'comment-variant'),
      (error: { code: string }) => error.code === '40001',
    )
  } finally {
    await db.close()
  }
})

test('private reply template replaces all variables: product_name, variant_name, price, total, payment_link', async () => {
  let sent = ''
  await handleLiveCfComment(
    { text: 'CF 100', commentId: 'c-1', code: '100' },
    {
      placeOrder: async () => ({
        status: 'created',
        orderId: '00000000-0000-4000-8000-000000000001',
        name: 'เสื้อยืดแขนสั้น',
        code: '100',
        amount: 250,
        variantLabel: 'สีขาว XL',
      }),
      getPayment: async () => null,
      getPendingTotal: async () => 500,
      getPaymentLink: () => 'https://pay.example/live/token123',
      privateTemplate:
        'ยินดีด้วยค่ะ! {product_name} ({variant_name}) ราคา {price} บาท ยอดสุทธิ {total} บาท ลิงก์: {payment_link}',
      sendPrivateReply: async (m) => {
        sent = m
      },
    },
  )
  assert.match(sent, /x 1/)
  assert.ok(sent.includes('https://pay.example/live/token123'))
  assert.ok(sent.includes('500.00'))
})

test('public and private stored templates support customer, item, total and bank aliases', async () => {
  const sent: string[] = []
  const template =
    '{customer_name} {item_name} {price} {total_amount} {bank_account} {payment_link}'
  await handleLiveCfComment(
    { text: 'configured-tag', commentId: 'template-aliases', code: 'custom-code' },
    {
      placeOrder: async () => ({
        status: 'created',
        orderId: 'order',
        name: 'Amulet',
        code: 'custom-code',
        amount: 250,
        variantLabel: null,
      }),
      getPayment: async () => ({ bankName: 'Bank', accountNumber: '123', accountName: 'Shop' }),
      getPendingTotal: async () => 500,
      getPaymentLink: () => 'https://pay.example/signed',
      privateTemplate: template,
      publicTemplate: template,
      customerName: 'Buyer',
      sendPrivateReply: async (message) => {
        sent.push(message)
      },
      replyToComment: async (message) => {
        sent.push(message)
      },
    },
  )
  assert.equal(sent.length, 2)
  const publicReply = sent.find((message) => message.startsWith('Buyer'))
  assert.equal(publicReply, 'Buyer Amulet 250.00 500.00 Bank 123 (Shop) https://pay.example/signed')
  const privateReply = sent.find((message) => message.includes('Amulet x 1'))
  assert.ok(privateReply?.includes('Buyer Amulet 250.00 500.00 Bank 123 (Shop) https://pay.example/signed'))
})

test('each reply channel is attempted independently and delivery failures propagate to the queue', async () => {
  for (const channel of ['private', 'public']) {
    const attempts: string[] = []
    const failure = Object.assign(new Error('Meta permission refused'), { code: 200, subcode: 10 })
    await assert.rejects(
      handleLiveCfComment(
        { text: 'fc159', commentId: 'c', code: 'fc159' },
        {
          placeOrder: async () => ({
            status: 'created',
            orderId: 'order',
            name: 'เสื้อยืด',
            code: 'fc159',
            amount: 159,
            variantLabel: null,
          }),
          getPayment: async () => null,
          getPendingTotal: async () => 159,
          getPaymentLink: () => 'https://shop.example/pay/live/signed',
          sendPrivateReply: async () => {
            attempts.push('private')
            if (channel === 'private') throw failure
          },
          replyToComment: async () => {
            attempts.push('public')
            if (channel === 'public') throw failure
          },
        },
      ),
      (e) => e === failure,
    )
    assert.deepEqual(attempts.sort(), ['private', 'public'])
  }
})

test('a missing signed bill or failed total lookup still allows public confirmation without sending an incorrect private bill', async () => {
  for (const problem of ['link', 'total']) {
    let privateCount = 0,
      publicCount = 0
    await assert.rejects(
      handleLiveCfComment(
        { text: '159', commentId: 'c', code: '159' },
        {
          placeOrder: async () => ({
            status: 'created',
            orderId: 'order',
            name: 'เสื้อยืด',
            code: '159',
            amount: 159,
            variantLabel: null,
          }),
          getPayment: async () => null,
          getPendingTotal: async () => {
            if (problem === 'total') throw new Error('TOTAL_LOOKUP_FAILED')
            return 159
          },
          getPaymentLink: () =>
            problem === 'link' ? null : 'https://shop.example/pay/live/signed',
          sendPrivateReply: async () => {
            privateCount++
          },
          replyToComment: async () => {
            publicCount++
          },
        },
      ),
    )
    assert.equal(privateCount, 0)
    assert.equal(publicCount, 1)
  }
})

test('public-only rules do not require payment configuration; sold-out replies are also independent', async () => {
  let publicCount = 0
  const unused = async (): Promise<never> => {
    throw new Error('MUST_NOT_READ_PAYMENT')
  }
  await handleLiveCfComment(
    { text: '159', commentId: 'c', code: '159' },
    {
      placeOrder: async () => ({
        status: 'created',
        orderId: 'order',
        name: 'เสื้อยืด',
        code: '159',
        amount: 159,
        variantLabel: null,
      }),
      getPayment: unused,
      getPendingTotal: unused,
      getPaymentLink: unused,
      replyToComment: async () => {
        publicCount++
      },
    },
  )
  assert.equal(publicCount, 1)
  await assert.rejects(
    handleLiveCfComment(
      { text: '159', commentId: 'c', code: '159' },
      {
        placeOrder: async () => ({ status: 'sold_out', name: 'เสื้อยืด', code: '159' }),
        getPayment: unused,
        getPendingTotal: unused,
        getPaymentLink: unused,
        sendPrivateReply: async () => {
          throw new Error('META_REFUSED')
        },
        replyToComment: async () => {
          publicCount++
        },
      },
    ),
  )
  assert.equal(publicCount, 2)
})
