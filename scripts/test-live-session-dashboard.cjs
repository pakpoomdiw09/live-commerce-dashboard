const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')
const load = require('./helpers/load-typescript.cjs')
const { NextRequest, NextResponse } = require('next/server')
const types = load('lib/features/commerce/live-session-types.ts')

test('session money uses integer satang; follow-up formulas and placeholders never invent balances', () => {
  assert.equal(types.sumMoney([0.1, 0.2]), 0.3)
  assert.equal(types.sessionProfit(1000.1, 400.05, 0.02, 50.03), 550)
  assert.equal(types.sessionProfit(0, 100, 10, 20), -130)
  for (const input of ['1.005', '-1', '', 'Infinity', '1e3', NaN, 1_000_000_000_000])
    assert.equal(types.inputMoney(input), null)
  assert.equal(types.inputMoney('0.01'), 0.01)
  const tab = {
    name: 'Buyer {short}',
    items: [
      { name: 'A', amount: 240 },
      { name: 'B', amount: 20 },
    ],
    shipping: 50,
    total: 310,
    paid: 100,
    remaining: 210,
  }
  assert.equal(types.tabFormula(tab), '240.00 + 20.00 + 50.00 = 310.00 บาท')
  const message = types.renderSessionFollowup('{name} {due} {paid} {short}\n{items}', tab)
  assert.match(message, /Buyer \{short\}/)
  assert.match(message, /210\.00/)
  assert.match(message, /1\. A/)
  assert.equal(types.validSessionTemplate('{due} {unknown}'), false)
  assert.equal(types.validSessionTemplate(types.SESSION_FOLLOWUP_TEMPLATE), true)
})

test('session financial transactions preserve proofs/payments, fence revisions and limit reminder dispatch per Page', async () => {
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
    const tenant = (
      await one("insert into tenants(name,page_id) values('Session shop','100') returning id")
    ).id
    const other = (
      await one("insert into tenants(name,page_id) values('Other shop','200') returning id")
    ).id
    const actor = (await one('insert into auth.users default values returning id')).id
    const bank = (
      await one(
        "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'KTB','Shop','9260337828') returning id",
        [tenant],
      )
    ).id
    const receipt = (
      await one(
        "insert into facebook_webhook_payloads(payload_sha256,raw_payload) values($1,'{}') returning id",
        ['a'.repeat(64)],
      )
    ).id
    const event = async (sender, message, post = '456') =>
      one(
        `insert into facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload,status)
      values($1,'100',$2,'live:100:'||$3,'change',$4,'completed') returning *`,
        [
          receipt,
          randomUUID(),
          post,
          JSON.stringify({
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              post_id: post,
              comment_id: post + '_' + randomUUID(),
              from: { id: sender, name: 'Buyer ' + sender },
              message,
              created_time: Math.floor(Date.now() / 1000),
            },
          }),
        ],
      )
    const open = async (post = '456') =>
      (
        await one(
          `insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,bank_account_id,private_reply_enabled,public_reply_enabled)
      values($1,'100',$2,'Amulet',200,20,50,$3,false,false) returning id`,
          [tenant, post, bank],
        )
      ).id
    const process = async (id, sender, text, kind, amount = null, control = null, post = '456') => {
      const ev = await event(sender, text, post)
      return (
        await one('select process_live_auction_comment($1,$2,$3,$4,$5,$6) result', [
          id,
          tenant,
          ev.id,
          kind,
          amount,
          control,
        ])
      ).result
    }
    const manage = async (session, input, request = randomUUID(), shop = tenant) =>
      (
        await one('select manage_live_session($1,$2,$3,$4,$5) result', [
          shop,
          session,
          actor,
          request,
          input,
        ])
      ).result
    const getTab = async (id) => one('select * from customer_tabs where id=$1', [id])
    const pay = async (tab, amount) => {
      const bill = await getTab(tab)
      const claim = (
        await one('select claim_customer_tab_slip($1,$2,$3,null) result', [
          tab,
          bill.customer_id,
          randomUUID(),
        ])
      ).result
      return (
        await one(
          "select complete_customer_tab_slip($1,$2,$3,'valid',$4,$5,clock_timestamp(),'{}',null) result",
          [claim.slipId, tenant, bill.customer_id, amount, randomUUID()],
        )
      ).result
    }
    const id = await open()
    const session = (await one('select id from live_sessions where tenant_id=$1', [tenant])).id
    assert.ok(session, 'opening a round creates a session even without a winner')
    await process(id, '900', 'เปิด', 'OPENING_BID')
    await process(id, '901', '1', 'STEP_BID')
    const closed = await process(id, '100', '❌', 'HOST_CONTROL', null, 'close')
    const order = await one('select * from orders where id=$1', [closed.orderId])
    await pay(order.customer_tab_id, 100)
    let snapshot = (await one('select live_session_dashboard($1,$2) result', [tenant, session]))
      .result
    assert.equal(snapshot.metrics.comments, 3)
    assert.equal(snapshot.metrics.matched, 2)
    assert.equal(snapshot.metrics.commenters, 2)
    assert.equal(snapshot.metrics.slips, 1)
    assert.equal(snapshot.metrics.paid, 100)
    assert.equal(snapshot.metrics.remaining, 170)
    const costRequest = randomUUID()
    const costPayload = { action: 'costs', revision: 0, cost: 10.05, ads: 5.01, shipping: 4.94 }
    await manage(session, costPayload, costRequest)
    await manage(session, costPayload, costRequest)
    snapshot = (await one('select live_session_dashboard($1,$2) result', [tenant, session])).result
    assert.equal(snapshot.metrics.profit, 80)
    assert.equal(snapshot.session.financial_revision, 1)
    await assert.rejects(manage(session, { ...costPayload, cost: 999 }), /SESSION_CHANGED/)
    await assert.rejects(
      manage(session, { ...costPayload, revision: 1, cost: 1.005 }),
      /SESSION_INPUT_INVALID/,
    )
    await assert.rejects(manage(session, costPayload, randomUUID(), other), /SESSION_NOT_FOUND/)
    const candidate = await one(
      "select id from auction_bids where auction_id=$1 and bidder_id='900'",
      [id],
    )
    const original = await getTab(order.customer_tab_id)
    const transferRequest = randomUUID()
    const transfer = {
      action: 'winner',
      roundId: id,
      orderId: order.id,
      bidId: candidate.id,
      revision: Number(original.revision),
    }
    const moved = await manage(session, transfer, transferRequest)
    assert.notEqual(moved.orderId, order.id)
    assert.deepEqual(await manage(session, transfer, transferRequest), moved)
    assert.equal((await one('select count(*)::int n from orders')).n, 2)
    assert.equal(
      (await one('select status from orders where id=$1', [order.id])).status,
      'cancelled',
    )
    const oldTab = await getTab(original.id)
    assert.equal(Number(oldTab.total_amount), 0)
    assert.equal(Number(oldTab.paid_amount), 100)
    assert.equal(Number(oldTab.credit_amount), 100, 'money stays with the verified payer')
    const newOrder = await one('select * from orders where id=$1', [moved.orderId])
    let current = await getTab(newOrder.customer_tab_id)
    assert.equal(Number(current.total_amount), 250)
    assert.equal(Number(current.paid_amount), 0)
    assert.equal((await one('select count(*)::int n from customer_tab_payments')).n, 1)
    assert.equal(
      (await one('select customer_tab_id from orders where id=$1', [order.id])).customer_tab_id,
      oldTab.id,
      'the original signed payment link cannot expose the new winner',
    )
    const oldProof = (
      await one('select live_session_tab_proof($1,$2,$3) result', [tenant, session, oldTab.id])
    ).result
    assert.equal(oldProof.items[0].bidAmount, 220)
    assert.equal(oldProof.items[0].cancelled, true)
    const proof = (
      await one('select live_session_tab_proof($1,$2,$3) result', [tenant, session, current.id])
    ).result
    assert.equal(proof.items[0].bidAmount, 200)
    assert.equal(proof.items[0].originalTime, true)
    assert.ok(proof.items[0].bidAt)
    assert.ok(proof.items[0].closeAt)
    await assert.rejects(manage(session, { ...transfer, revision: 0 }), /SESSION_CHANGED/)
    await assert.rejects(
      manage(session, { ...transfer, bidId: randomUUID() }, transferRequest),
      /SESSION_REQUEST_REUSED/,
    )
    const id2 = await open()
    await process(id2, '900', '300', 'NUMERIC_BID', 300)
    await process(id2, '100', '❌', 'HOST_CONTROL', null, 'close')
    current = await getTab(current.id)
    assert.equal(Number(current.total_amount), 550)
    let lines = (
      await db.query(
        'select * from customer_tab_items where tab_id=$1 order by closed_at,order_id',
        [current.id],
      )
    ).rows
    const adjustment = {
      action: 'adjust',
      tabId: current.id,
      revision: Number(current.revision),
      shipping: 0,
      reason: 'Correct from comments',
      items: lines.map((item, index) => ({
        orderId: item.order_id,
        amount: index === 0 ? 260 : 410,
        cancelled: false,
      })),
    }
    await manage(session, adjustment)
    current = await getTab(current.id)
    assert.equal(Number(current.total_amount), 670)
    assert.equal(current.shipping_override, true)
    const pendingProof = (
      await one('select claim_customer_tab_slip($1,$2,$3,null) result', [
        current.id,
        current.customer_id,
        randomUUID(),
      ])
    ).result
    await assert.rejects(
      manage(session, { ...adjustment, revision: Number(current.revision) }),
      /SESSION_OPERATION_IN_PROGRESS/,
    )
    await one(
      "select complete_customer_tab_slip($1,$2,$3,'fake',null,null,null,'{}','test rejection')",
      [pendingProof.slipId, tenant, current.customer_id],
    )
    await assert.rejects(manage(session, adjustment), /SESSION_CHANGED/)
    await assert.rejects(
      manage(session, {
        ...adjustment,
        revision: Number(current.revision),
        items: adjustment.items.map((item, index) =>
          index === 0 ? { ...item, orderId: randomUUID() } : item,
        ),
      }),
      /SESSION_ITEM_SCOPE/,
    )
    assert.equal(
      Number((await getTab(current.id)).total_amount),
      670,
      'a foreign line rolls back the entire adjustment',
    )
    const beforePaymentRevision = Number(current.revision)
    await pay(current.id, 100)
    await assert.rejects(
      manage(session, { ...adjustment, revision: beforePaymentRevision }),
      /SESSION_CHANGED/,
    )
    current = await getTab(current.id)
    const removeRequest = randomUUID()
    const remove = {
      ...adjustment,
      revision: Number(current.revision),
      items: adjustment.items.map((item) => ({ ...item, cancelled: true })),
    }
    await manage(session, remove, removeRequest)
    await manage(session, remove, removeRequest)
    current = await getTab(current.id)
    assert.equal(Number(current.total_amount), 0)
    assert.equal(Number(current.credit_amount), 100)
    assert.equal(Number(current.paid_amount), 100)
    const id3 = await open()
    await process(id3, '900', 'เปิด', 'OPENING_BID')
    await process(id3, '100', '❌', 'HOST_CONTROL', null, 'close')
    current = await getTab(current.id)
    assert.equal(
      Number(current.total_amount),
      200,
      'manual free shipping remains in effect for subsequent wins',
    )
    const product = (
      await one(
        "insert into products(tenant_id,code,name,price,stock) values($1,'CF40','CF amulet',40,1) returning id",
        [tenant],
      )
    ).id
    const rule = (
      await one(
        "insert into comment_rules(tenant_id,name,page_ids,keywords,mode,live_product_id,live_post_id,live_bank_account_id,live_deduct_stock,is_active) values($1,'CF rule',array['100'],array['cf40'],'live_cf',$2,'456',$3,true,true) returning id",
        [tenant, product, bank],
      )
    ).id
    const cf = await one(
      "select * from place_cf_order($1,$2,$3,'cf40','cf-proof-comment','456','100')",
      [tenant, current.customer_id, rule],
    )
    assert.equal(cf.r_status, 'created')
    assert.equal((await one('select stock from products where id=$1', [product])).stock, 0)
    current = await getTab(current.id)
    lines = (await db.query('select * from customer_tab_items where tab_id=$1', [current.id])).rows
    const cfRequest = randomUUID()
    const cfCancel = {
      action: 'adjust',
      tabId: current.id,
      revision: Number(current.revision),
      shipping: 0,
      reason: 'Cancel only the CF line',
      items: lines.map((item) => ({
        orderId: item.order_id,
        amount: Number(item.amount),
        cancelled: item.cancelled || item.order_id === cf.r_order_id,
      })),
    }
    await manage(session, cfCancel, cfRequest)
    await manage(session, cfCancel, cfRequest)
    assert.equal(
      (await one('select stock from products where id=$1', [product])).stock,
      1,
      'CF stock is restored once on cancellation',
    )
    assert.equal(Number((await getTab(current.id)).total_amount), 200)
    const id4 = await open()
    await process(id4, '901', 'เปิด', 'OPENING_BID')
    await process(id4, '100', '❌', 'HOST_CONTROL', null, 'close')
    const queueRequest = randomUUID()
    await db.query(
      "insert into customer_tab_reminders(tab_id,stage,run_at) values($1,'after_live_1h',clock_timestamp()+interval '1 hour')",
      [current.id],
    )
    const queue = async (tabs = null, req = queueRequest, shop = tenant) =>
      (
        await one('select queue_live_session_reminders($1,$2,$3,$4,$5,$6) n', [
          shop,
          session,
          actor,
          req,
          tabs,
          types.SESSION_FOLLOWUP_TEMPLATE,
        ])
      ).n
    assert.equal(await queue(), 2)
    assert.equal(await queue(), 2)
    assert.equal(
      await queue(null, randomUUID()),
      0,
      'a new click cannot duplicate queued/uncertain work',
    )
    await assert.rejects(queue([randomUUID()], randomUUID()), /SESSION_TAB_SCOPE/)
    await assert.rejects(queue(null, randomUUID(), other), /SESSION_NOT_FOUND/)
    const firstJob = await one('select * from claim_customer_tab_reminder()')
    assert.ok(firstJob.send_after)
    assert.equal(
      await one('select * from claim_customer_tab_reminder()'),
      undefined,
      'only one in-flight send per Page',
    )
    await db.query("update customer_tab_reminders set status='sent' where id=$1", [firstJob.id])
    const nextJob = await one('select * from claim_customer_tab_reminder()')
    assert.ok(nextJob)
    assert.ok(
      new Date(nextJob.send_after) - new Date(firstJob.send_after) >= 5000,
      'Page-wide send slots are at least five seconds apart',
    )
    snapshot = (await one('select live_session_dashboard($1,$2) result', [tenant, session])).result
    assert.equal(snapshot.metrics.paid, 200)
    assert.equal(snapshot.metrics.unpaidPeople, 0)
    assert.equal(snapshot.metrics.partialPeople, 2)
    assert.equal(snapshot.metrics.profit, 180)
    for (const name of ['live_session_changes', 'live_reminder_dispatch_slots'])
      assert.equal(
        (await one("select has_table_privilege('authenticated',$1,'insert') allowed", [name]))
          .allowed,
        false,
      )
    assert.equal(
      (
        await one(
          "select has_function_privilege('authenticated','manage_live_session(uuid,uuid,uuid,uuid,jsonb)','execute') allowed",
        )
      ).allowed,
      false,
    )
  } finally {
    await db.close()
  }
})

test('session API scopes ownership before data access and validates all mutation boundaries', async () => {
  const tenantId = randomUUID(),
    sessionId = randomUUID(),
    requestId = randomUUID(),
    actor = randomUUID()
  let deny = false,
    calls = []
  const api = load(
    'app/api/live-cf/sessions/route.ts',
    {
      'next/server': { after() {} },
      '@/lib/auth': { getActor: async () => ({ kind: 'user', id: actor }) },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          rpc: async (name, input) => {
            calls.push({ name, input })
            return { data: name === 'commerce_rate_limit' ? true : { ok: true }, error: null }
          },
        }),
      },
      '@/lib/features/commerce/auction-api': {
        authorizeAuction: async () =>
          deny ? NextResponse.json({ error: 'denied' }, { status: 403 }) : null,
        auctionReply: (data, status = 200) => NextResponse.json(data, { status }),
      },
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
      '@/lib/features/commerce/live-session-types': types,
      '@/lib/features/commerce/customer-tab-reminders': {},
    },
    { console: { error() {} }, AbortSignal },
  )
  const post = (data) =>
    api.POST(
      new NextRequest('https://shop.example/api/live-cf/sessions', {
        method: 'POST',
        headers: { origin: 'https://shop.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, sessionId, requestId, ...data }),
      }),
    )
  deny = true
  assert.equal(
    (await post({ action: 'costs', cost: 0, ads: 0, shipping: 0, revision: 0 })).status,
    403,
  )
  assert.equal(calls.length, 0)
  deny = false
  for (const data of [
    { action: 'costs', cost: -1, ads: 0, shipping: 0, revision: 0 },
    { action: 'costs', cost: 1.005, ads: 0, shipping: 0, revision: 0 },
    { action: 'costs', cost: 0, ads: 0, shipping: 0, revision: -1 },
    { action: 'adjust', tabId: randomUUID(), revision: 0, shipping: 0, items: [], reason: '' },
    {
      action: 'winner',
      roundId: randomUUID(),
      orderId: randomUUID(),
      bidId: 'foreign',
      revision: 0,
    },
    { action: 'remind', tabIds: [], template: '{short}' },
    { action: 'remind', tabIds: null, template: '{unknown}' },
  ])
    assert.equal((await post(data)).status, 400)
  assert.equal(calls.length, 0)
  assert.equal(
    (await post({ action: 'costs', cost: 1.01, ads: 2, shipping: 3, revision: 0 })).status,
    200,
  )
  assert.equal(calls[0].input.p_tenant, tenantId)
  assert.equal(calls[0].input.p_session, sessionId)
  assert.equal(calls[0].input.p_actor, actor)
  assert.equal(calls[0].input.p_input.cost, 1.01)
})
