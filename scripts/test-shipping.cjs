const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')
const load = require('./helpers/load-typescript.cjs')
const { NextRequest, NextResponse } = require('next/server')
const types = load('lib/features/shipping/shipping-types.ts')
const parser = load('lib/features/shipping/thai-address.ts', { './shipping-types': types })
const csv = load('lib/features/shipping/shipping-csv.ts')
const addressText = 'สมชาย ใจดี\n99/1 หมู่ 2\nต.บางรัก อ.เมือง จ.นนทบุรี 11000\nโทร 081-234-5678'
const address = {
  recipient_name: 'สมชาย ใจดี',
  phone_number: '0812345678',
  shipping_address: '99/1 หมู่ 2 ต.บางรัก อ.เมือง จ.นนทบุรี 11000',
  subdistrict: 'บางรัก',
  district: 'เมือง',
  province: 'นนทบุรี',
  zipcode: '11000',
}

test('Thai address parsing copies complete evidence and refuses missing/ambiguous recipients and phones', () => {
  const parsed = parser.parseThaiShippingAddress(addressText)
  assert.ok(parsed)
  for (const key of [
    'recipient_name',
    'phone_number',
    'subdistrict',
    'district',
    'province',
    'zipcode',
  ])
    assert.equal(parsed[key], address[key])
  const bkk = parser.parseThaiShippingAddress(
    'ชื่อผู้รับ: มานี มีใจ\n123/4 แขวงคลองถนน เขตสายไหม กรุงเทพฯ 10220\nโทร +66 81 234 5678',
  )
  assert.ok(bkk)
  assert.equal(bkk.province, 'กรุงเทพมหานคร')
  assert.equal(bkk.district, 'สายไหม')
  assert.equal(bkk.recipient_name, 'มานี มีใจ')
  assert.equal(bkk.phone_number, '0812345678')
  assert.equal(
    parser.parseThaiShippingAddress(addressText.replaceAll('\n', ' ')).recipient_name,
    'สมชาย ใจดี',
  )
  assert.equal(
    parser.parseThaiShippingAddress(addressText.replace('081-234-5678', '๐๘๑๒๓๔๕๖๗๘')).phone_number,
    '0812345678',
  )
  for (const invalid of [
    'โอนแล้ว 500 บาท',
    '0812345678',
    addressText.replace('11000', ''),
    addressText + '\n0899999999',
    addressText.replace('สมชาย ใจดี\n', ''),
    addressText.replace('ต.บางรัก ', ''),
  ])
    assert.equal(parser.parseThaiShippingAddress(invalid), null)
  assert.equal(parser.isShippingConfirmation('ยืนยันที่อยู่'), true)
  assert.equal(parser.isShippingConfirmation('ยังไม่ยืนยันที่อยู่'), false)
  assert.equal(
    parser.parseThaiShippingAddress('สวัสดีครับ\n' + addressText.replace('สมชาย ใจดี\n', '')),
    null,
  )
})

test('shipping routes reject anonymous/foreign/cross-origin requests before reading or writing recipient details', async () => {
  const tenant = randomUUID()
  let actor = null,
    member = false,
    owner = false,
    reads = 0
  const server = load(
    'lib/features/shipping/shipping-server.ts',
    {
      'server-only': {},
      'next/server': { NextResponse },
      '@/lib/auth': {
        getActor: async () => actor,
        canAccessTenant: async (_actor, id, need = 'staff') =>
          id === tenant && member && (need !== 'owner' || owner),
      },
      '@/lib/supabase/server': {
        supabaseAdmin: () => {
          reads++
          return {}
        },
      },
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/ },
    },
    { console: { error() {} } },
  )
  const request = new NextRequest('https://snap.example/api/shipping', {
    headers: { origin: 'https://snap.example' },
  })
  await assert.rejects(server.shippingScope(request, tenant), (error) => error.status === 403)
  actor = { kind: 'user', id: randomUUID() }
  await assert.rejects(server.shippingScope(request, tenant), (error) => error.status === 403)
  member = true
  await assert.rejects(
    server.shippingScope(
      new NextRequest(request.url, { headers: { origin: 'https://evil.example' } }),
      tenant,
      true,
    ),
    (error) => error.status === 403,
  )
  await assert.rejects(
    server.shippingScope(request, tenant, true, true),
    (error) => error.status === 403,
  )
  assert.equal(reads, 0)
  await server.shippingScope(request, tenant, true)
  assert.equal(reads, 1)
  owner = true
  await server.shippingScope(request, tenant, true, true)
  assert.equal(reads, 2)
})

test('Messenger address handling stores evidence, asks for confirmation once and honors paused/optional-schema paths', async () => {
  async function fixture({
    mayReply = true,
    missing = false,
    eligible = true,
    confirm = false,
  } = {}) {
    const tenant = randomUUID(),
      customer = randomUUID(),
      candidate = randomUUID(),
      mid = randomUUID()
    const calls = { rpc: [], sends: [], policy: 0, notified: 0 }
    const db = {
      from(table) {
        const q = {
          select: () => q,
          eq: () => q,
          is: () => q,
          update: () => {
            calls.notified++
            return q
          },
          single: async () => ({
            data: { bot_enabled: true, agent_opted_out: false },
            error: null,
          }),
          then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
        }
        return q
      },
      async rpc(name, input) {
        calls.rpc.push({ name, input })
        return {
          data: { handled: eligible, candidateId: candidate, address, confirmed: confirm },
          error: missing ? { code: 'PGRST202' } : null,
        }
      },
    }
    const mod = load(
      'lib/features/shipping/shipping-messenger.ts',
      {
        'server-only': {},
        './thai-address': parser,
        '@/lib/features/slips/notify': {
          deliverRichOnce: async (...args) => {
            calls.sends.push(args)
            return true
          },
          deliverOnce: async (...args) => {
            calls.sends.push(args)
            return true
          },
        },
        '@/lib/features/inbox/inbox-policy-server': {
          assertInboxPolicy: async () => {
            calls.policy++
          },
        },
      },
      { process: { env: {} } },
    )
    const completed = new Map()
    const input = {
      db,
      tenantId: tenant,
      pageId: '100',
      recipient: { id: customer, psid: '900', token: 'TEST_TOKEN' },
      messageId: mid,
      text: confirm ? 'ยืนยันที่อยู่' : addressText,
      mayReply,
      execution: {
        once: async (name, work) => {
          if (!completed.has(name)) completed.set(name, await work())
          return completed.get(name)
        },
      },
    }
    return { mod, calls, input }
  }
  const f = await fixture()
  assert.equal(await f.mod.handleShippingMessage(f.input), true)
  await f.mod.handleShippingMessage(f.input)
  assert.equal(f.calls.rpc.length, 1)
  assert.equal(f.calls.sends.length, 1)
  assert.equal(f.calls.rpc[0].name, 'capture_shipping_address')
  assert.equal(f.calls.rpc[0].input.p_address.zipcode, '11000')
  assert.match(f.calls.sends[0][4][0].quick_replies[0].payload, /^SHIPPING_CONFIRM:/)
  assert.equal(f.calls.notified, 1)
  const paused = await fixture({ mayReply: false })
  assert.equal(await paused.mod.handleShippingMessage(paused.input), true)
  assert.equal(paused.calls.rpc.length, 1)
  assert.equal(paused.calls.sends.length, 0)
  for (const options of [{ missing: true }, { eligible: false }]) {
    const unavailable = await fixture(options)
    assert.equal(await unavailable.mod.handleShippingMessage(unavailable.input), false)
    assert.equal(unavailable.calls.sends.length, 0)
  }
  const confirmed = await fixture({ confirm: true })
  assert.equal(await confirmed.mod.handleShippingMessage(confirmed.input), true)
  assert.equal(confirmed.calls.rpc[0].name, 'confirm_shipping_address')
  assert.match(confirmed.calls.sends[0][3], /ยืนยันที่อยู่จัดส่งแล้ว/)
})
test('carrier CSV has precisely ten columns, UTF-8 BOM, COD zero, quoted newlines and formula protection', () => {
  const output = csv.shippingCsv([
    {
      ...address,
      id: 'parcel',
      recipient_name: '=HYPERLINK("evil")',
      shipping_address: '99/1\nBangkok',
      phone_number: '0812345678',
      items: [{ order_id: 'order-1', item_name: 'พระ, เหรียญ "A"' }],
      note: '+malicious',
    },
  ])
  assert.ok(output.startsWith('\uFEFF'))
  assert.equal(csv.SHIPPING_CSV_HEADERS.length, 10)
  assert.match(output, /"'\=HYPERLINK\(""evil""\)"/)
  assert.match(output, /"0812345678"/)
  assert.match(output, /"0","'\+malicious"/)
  assert.match(output, /99\/1\nBangkok/)
  assert.match(output, /order-1/)
})

test('paid bills become parcel allocations; confirmation, stale print fencing, shipment and later wins preserve ledger and labels', async () => {
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
      await one("insert into tenants(name,page_id) values('Shipping shop','100') returning id")
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
    const win = async (price) => {
      const auction = (
        await one(
          "insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,current_price,shipping_fee,bank_account_id,leading_bidder_id,leading_bidder_name,leading_comment_id,private_reply_enabled,public_reply_enabled) values($1,'100','456','Amulet',200,20,$2,50,$3,'900','Somchai',$4,false,false) returning id",
          [tenant, price, bank, randomUUID()],
        )
      ).id
      const close = (await one('select finalize_live_auction($1,$2) result', [auction, tenant]))
        .result
      return one('select * from orders where id=$1', [close.orderId])
    }
    const first = await win(200)
    const tabId = first.customer_tab_id,
      customer = first.customer_id
    const pay = async (amount) => {
      const claim = (
        await one('select claim_customer_tab_slip($1,$2,$3,null) result', [
          tabId,
          customer,
          randomUUID(),
        ])
      ).result
      await one(
        "select complete_customer_tab_slip($1,$2,$3,'valid',$4,$5,clock_timestamp(),'{}',null)",
        [claim.slipId, tenant, customer, amount, randomUUID()],
      )
    }
    const manage = async (input, request = randomUUID(), shop = tenant) =>
      (await one('select manage_shipping($1,$2,$3,$4) result', [shop, actor, request, input]))
        .result
    const getParcel = async (id) => one('select * from shipping_shipments where id=$1', [id])
    const message = async (body) =>
      (
        await one(
          "insert into messages(customer_id,sender,body) values($1,'customer',$2) returning id",
          [customer, body],
        )
      ).id
    assert.equal((await one('select count(*)::int n from shipping_shipments')).n, 0)
    await pay(100)
    assert.equal((await one('select count(*)::int n from shipping_shipments')).n, 0)
    await pay(150)
    let parcel = await one('select * from shipping_shipments where customer_tab_id=$1', [tabId])
    assert.ok(parcel)
    assert.equal(parcel.fulfillment_status, 'pending_address')
    assert.equal((await one('select count(*)::int n from shipping_shipment_items')).n, 1)
    const second = await win(300)
    assert.equal((await one('select shipping_payment_ready($1) ok', [parcel.id])).ok, false)
    await pay(300)
    assert.equal((await one('select count(*)::int n from shipping_shipments')).n, 1)
    assert.equal((await one('select count(*)::int n from shipping_shipment_items')).n, 2)
    await assert.rejects(
      manage({ action: 'prepare_print', ids: [parcel.id], format: 'thermal' }),
      /SHIPPING_NOT_READY/,
    )
    await manage({
      action: 'settings',
      settings: {
        sender_name: 'SnapBot Shop',
        sender_phone: '0899999999',
        sender_address: '111 Shop Road Bangkok 10220',
        default_courier: 'Bee Move',
      },
    })
    const source = await message(addressText)
    const candidate = (
      await one('select capture_shipping_address($1,$2,$3,$4) result', [
        tenant,
        customer,
        source,
        address,
      ])
    ).result
    assert.ok(candidate.candidateId)
    assert.equal((await getParcel(parcel.id)).recipient_name, address.recipient_name)
    assert.equal(
      (await one('select recipient_name from customer_tabs where id=$1', [tabId])).recipient_name,
      address.recipient_name,
    )
    const oldConfirm = await message('ยืนยันที่อยู่')
    assert.equal(
      (
        await one('select confirm_shipping_address($1,$2,$3,null) result', [
          tenant,
          customer,
          oldConfirm,
        ])
      ).result.handled,
      false,
    )
    const source2 = await message('New address')
    const newAddress = {
      ...address,
      shipping_address: '100 New address, Bang Rak Nonthaburi 11000',
    }
    const newer = (
      await one('select capture_shipping_address($1,$2,$3,$4) result', [
        tenant,
        customer,
        source2,
        newAddress,
      ])
    ).result
    assert.notEqual(newer.candidateId, candidate.candidateId)
    const confirm = await message('ยืนยันที่อยู่')
    assert.equal(
      (
        await one('select confirm_shipping_address($1,$2,$3,$4) result', [
          tenant,
          customer,
          confirm,
          candidate.candidateId,
        ])
      ).result.handled,
      false,
    )
    assert.equal(
      (
        await one('select confirm_shipping_address($1,$2,$3,$4) result', [
          tenant,
          customer,
          confirm,
          newer.candidateId,
        ])
      ).result.confirmed,
      true,
    )
    parcel = await getParcel(parcel.id)
    assert.equal(parcel.fulfillment_status, 'ready_to_ship')
    const batchRequest = randomUUID(),
      prep = { action: 'prepare_print', ids: [parcel.id], format: 'thermal' }
    const batch = await manage(prep, batchRequest)
    assert.deepEqual(await manage(prep, batchRequest), batch)
    const frozen = await one('select * from shipping_print_batches where id=$1', [batch.batchId])
    assert.equal(frozen.shipments[0].items.length, 2)
    assert.equal(frozen.sender.sender_phone, '0899999999')
    const printRequest = randomUUID(),
      print = { action: 'mark_print', batchId: batch.batchId }
    await manage(print, printRequest)
    await manage(print, printRequest)
    parcel = await getParcel(parcel.id)
    assert.equal(parcel.label_print_count, 1)
    assert.ok(parcel.label_printed_at)
    await db.exec(fs.readFileSync('supabase/shipping-fulfillment.sql', 'utf8'))
    assert.equal(
      (await getParcel(parcel.id)).label_printed_at.toISOString(),
      parcel.label_printed_at.toISOString(),
      'rerunning the additive migration preserves printed labels',
    )
    const edit = {
      action: 'edit',
      ids: [parcel.id],
      revision: Number(parcel.revision),
      address: newAddress,
      confirmed: true,
      tracking: '',
      courier: 'J&T',
      note: 'Fragile amulet',
    }
    await manage(edit)
    await assert.rejects(manage(edit), /SHIPPING_CHANGED/)
    assert.equal((await getParcel(parcel.id)).label_printed_at, null)
    await assert.rejects(manage(print), /SHIPPING_PRINT_STALE/)
    await assert.rejects(
      manage(print, printRequest),
      /SHIPPING_PRINT_STALE/,
      'replaying a successful preflight cannot print a subsequently changed address',
    )
    await assert.rejects(manage(prep, batchRequest), /SHIPPING_PRINT_STALE/)
    const exportBatch = await manage({ action: 'export', ids: [parcel.id] })
    assert.equal(
      (await one('select format from shipping_print_batches where id=$1', [exportBatch.batchId]))
        .format,
      'csv',
    )
    assert.equal(
      (await getParcel(parcel.id)).label_print_count,
      1,
      'CSV export does not claim printing or shipping',
    )
    await assert.rejects(manage({ action: 'dispatch', ids: [parcel.id] }), /SHIPPING_NOT_READY/)
    parcel = await getParcel(parcel.id)
    await manage({ ...edit, revision: Number(parcel.revision), tracking: 'JT123456789' })
    await manage({ action: 'dispatch', ids: [parcel.id] })
    assert.equal((await getParcel(parcel.id)).fulfillment_status, 'shipped')
    assert.equal(
      (
        await one('select count(*)::int n from shipping_tracking_deliveries where shipment_id=$1', [
          parcel.id,
        ])
      ).n,
      1,
      'manual dispatch transaction enqueues one tracking notification',
    )
    assert.equal((await one('select status from orders where id=$1', [first.id])).status, 'shipped')
    assert.equal(
      (await one('select status from orders where id=$1', [second.id])).status,
      'shipped',
    )
    await assert.rejects(
      manage({ action: 'cancel', ids: [parcel.id] }),
      /SHIPPING_ALREADY_DISPATCHED/,
    )
    await assert.rejects(
      db.query("update orders set status='cancelled' where id=$1", [first.id]),
      /SHIPPING_ALREADY_DISPATCHED|TAB_REFUND_REQUIRES_REVIEW/,
    )
    const third = await win(400)
    assert.equal((await one('select count(*)::int n from shipping_shipments')).n, 1)
    await pay(400)
    const nextParcel = await one(
      'select * from shipping_shipments where customer_tab_id=$1 and id<>$2',
      [tabId, parcel.id],
    )
    assert.ok(nextParcel)
    assert.equal(nextParcel.fulfillment_status, 'ready_to_ship')
    assert.equal((await getParcel(parcel.id)).fulfillment_status, 'shipped')
    assert.equal(
      (
        await one('select count(*)::int n from shipping_shipment_items where shipment_id=$1', [
          nextParcel.id,
        ])
      ).n,
      1,
    )
    assert.equal(
      (await one('select shipment_id from shipping_shipment_items where order_id=$1', [third.id]))
        .shipment_id,
      nextParcel.id,
    )
    const legacy = await one(
      "insert into orders(tenant_id,customer_id,product_name,amount,status) values($1,$2,'Standalone order',150,'paid') returning *",
      [tenant, customer],
    )
    assert.ok(
      legacy.shipping_shipment_id ||
        (await one('select shipping_shipment_id from orders where id=$1', [legacy.id]))
          .shipping_shipment_id,
    )
    const before = (await one('select paid_amount from customer_tabs where id=$1', [tabId]))
      .paid_amount
    await manage({ action: 'cancel', ids: [nextParcel.id] })
    await manage({ action: 'restore', ids: [nextParcel.id] })
    assert.equal(
      (await one('select paid_amount from customer_tabs where id=$1', [tabId])).paid_amount,
      before,
    )
    await one(
      `select save_shipping_integration(
        $1,'dmove','https://dmove.example.test/v1','encrypted-test-value',
        $2::jsonb,'https://track.example.test/{tracking_number}',1.25,true,true
      )`,
      [
        tenant,
        JSON.stringify({
          name: 'SnapBot Shop',
          phone: '0899999999',
          address: '111 Shop Road Bangkok 10220',
        }),
      ],
    )
    await one(
      `select save_shipping_integration(
        $1,'beemove','https://client.beemove.co.th','encrypted-beemove-value',
        $2::jsonb,'https://client.beemove.co.th/tracking/{tracking_number}',1,true,false
      )`,
      [
        tenant,
        JSON.stringify({
          name: 'SnapBot Shop',
          phone: '0899999999',
          address: '111 Shop Road Bangkok 10220',
        }),
      ],
    )
    const beeMoveJob = (
      await one('select begin_shipping_provider_job($1,$2,$3,$4,$5) result', [
        tenant,
        actor,
        randomUUID(),
        nextParcel.id,
        'beemove',
      ])
    ).result
    assert.equal(beeMoveJob.claimed, true)
    await one("select finish_shipping_provider_job($1,'failed','test cleanup')", [beeMoveJob.jobId])
    const parcelRequest = randomUUID()
    const parcelJob = (
      await one('select begin_shipping_provider_job($1,$2,$3,$4,$5) result', [
        tenant,
        actor,
        parcelRequest,
        nextParcel.id,
        'dmove',
      ])
    ).result
    assert.equal(parcelJob.claimed, true)
    assert.equal(parcelJob.status, 'creating')
    assert.equal(
      (
        await one('select begin_shipping_provider_job($1,$2,$3,$4,$5) result', [
          tenant,
          actor,
          parcelRequest,
          nextParcel.id,
          'dmove',
        ])
      ).result.claimed,
      false,
      'replayed requests do not create a second carrier parcel',
    )
    const completedJob = (
      await one(
        `select complete_shipping_provider_job($1,'DM123456789','DMove',
          'https://track.example.test/DM123456789','https://labels.example.test/label.pdf') result`,
        [parcelJob.jobId],
      )
    ).result
    assert.equal(completedJob.status, 'created')
    assert.equal(
      (
        await one('select count(*)::int n from shipping_tracking_deliveries where shipment_id=$1', [
          nextParcel.id,
        ])
      ).n,
      1,
      'provider completion atomically enqueues tracking',
    )
    assert.equal((await getParcel(nextParcel.id)).fulfillment_status, 'shipped')
    assert.equal((await getParcel(nextParcel.id)).tracking_number, 'DM123456789')
    assert.equal(
      (await getParcel(nextParcel.id)).tracking_url,
      'https://track.example.test/DM123456789',
    )
    assert.equal((await one('select status from orders where id=$1', [third.id])).status, 'shipped')
    await one('select mark_shipping_tracking_notification($1,$2)', [parcelJob.jobId, 'sent'])
    assert.equal(
      (
        await one('select notification_status from shipping_provider_jobs where id=$1', [
          parcelJob.jobId,
        ])
      ).notification_status,
      'sent',
    )
    await assert.rejects(
      one(
        `select complete_shipping_provider_job($1,'DM123456789','DMove',
          'https://track.example.test/DM123456789','https://labels.example.test/label.pdf')`,
        [randomUUID()],
      ),
      /SHIPPING_JOB_NOT_FOUND/,
    )
    await assert.rejects(
      manage({ action: 'export', ids: [parcel.id] }, randomUUID(), other),
      /SHIPPING_SCOPE/,
    )
    await assert.rejects(manage({ ...prep, format: 'a4' }, batchRequest), /SHIPPING_REQUEST_REUSED/)
    const snapshot = (await one('select shipping_snapshot($1) result', [tenant])).result
    assert.equal(snapshot.length, 3)
    assert.ok(snapshot.every((row) => row.tenant_id === tenant))
    assert.deepEqual((await one('select shipping_snapshot($1) result', [other])).result, [])
    await db.query("insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')", [
      tenant,
      actor,
    ])
    await db.query(
      "update tenants set plan='pro',plan_expires_at=clock_timestamp()+interval '1 day' where id=$1",
      [tenant],
    )
    await db.query("select set_config('test.user',$1,false)", [actor])
    await db.exec('set role authenticated')
    try {
      assert.deepEqual(
        await one(
          'select auth.uid() uid,can_access_tenant($1) allowed,(select count(*)::int from orders where id=$2) visible',
          [tenant, legacy.id],
        ),
        { uid: actor, allowed: true, visible: 1 },
      )
      await db.query("update orders set status='cancelled' where id=$1", [legacy.id])
      await assert.rejects(db.query('select * from shipping_print_batches'), /permission denied/)
    } finally {
      await db.exec('reset role')
    }
    assert.equal(
      (await one('select status from orders where id=$1', [legacy.id])).status,
      'cancelled',
      'existing RLS-authorized order status updates still work with private shipping triggers',
    )
    for (const table of [
      'shipping_shipments',
      'shipping_print_batches',
      'shipping_address_candidates',
      'shipping_profiles',
      'shipping_integrations',
      'shipping_provider_jobs',
    ])
      assert.equal(
        (await one("select has_table_privilege('authenticated',$1,'select') allowed", [table]))
          .allowed,
        false,
      )
    assert.equal(
      (
        await one(
          "select has_function_privilege('authenticated','manage_shipping(uuid,uuid,uuid,jsonb)','execute') allowed",
        )
      ).allowed,
      false,
    )
  } finally {
    await db.close()
  }
})
