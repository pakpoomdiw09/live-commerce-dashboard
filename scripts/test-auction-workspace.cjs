const assert = require('node:assert/strict')
const { test } = require('node:test')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('./build-full-database-setup.cjs')

test('unified workspace saves all zones atomically, preserves merchant values and fences retries/bids', async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create schema extensions;
      create table auth.users(id uuid primary key default gen_random_uuid(),email text);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;create publication supabase_realtime;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`)
    await db.exec(build().completeSql)
    const actor = (await one('insert into auth.users default values returning id')).id
    const tenant = (
      await one("insert into tenants(name,page_id) values('Workspace','100') returning id")
    ).id
    const bank = (
      await one(
        "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'KTB','Shop','1234567890') returning id",
        [tenant],
      )
    ).id
    const other = (
      await one("insert into tenants(name,page_id) values('Other','200') returning id")
    ).id
    const foreignBank = (
      await one(
        "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'KTB','Other','0987654321') returning id",
        [other],
      )
    ).id
    const input = {
      pageId: '100',
      livePostId: '456',
      sessionId: null,
      roundId: null,
      revision: 0,
      financialRevision: 0,
      itemName: 'Saved item',
      startPrice: 300,
      minStep: 25,
      shippingFee: 37,
      settings: {
        keywords: ['raise', 'raise', '❌', '❌'],
        closeKeywords: ['❌', '❌', '❌'],
        publicReply: true,
        privateReply: true,
        bankAccountId: bank,
        countEnabled: false,
        closeEnabled: true,
        heartCloses: false,
        bidText: '{bidder_name} {price}',
        privateText: 'Custom {product_name} {total} {bank_account}',
        closeText: '{bidder_name} {price}',
      },
      hostIds: ['100', '999'],
      finance: { cost: 125.5, ads: 15, shipping: 7, fees: 3.25 },
    }
    const save = async (value, request = randomUUID()) =>
      (
        await one('select save_auction_workspace($1,$2,$3,$4) result', [
          tenant,
          actor,
          request,
          value,
        ])
      ).result
    // A bank error rolls back the new session as well as the auction.
    await assert.rejects(
      save({ ...input, settings: { ...input.settings, bankAccountId: foreignBank } }),
      /BANK_SCOPE/,
    )
    assert.equal((await one('select count(*)::int n from live_sessions')).n, 0)
    const request = randomUUID()
    const result = await save(input, request)
    assert.deepEqual(await save(input, request), result)
    assert.equal((await one('select count(*)::int n from auctions')).n, 1)
    let session = await one('select * from live_sessions where id=$1', [result.sessionId])
    let round = await one('select * from auctions where id=$1', [result.auctionId])
    assert.equal(round.shipping_fee, '37.00')
    assert.equal(round.min_step, '25.00')
    assert.equal(round.item_name, input.itemName)
    assert.deepEqual(round.session_automation.keywords, input.settings.keywords)
    assert.deepEqual(round.session_automation.closeKeywords, input.settings.closeKeywords)
    assert.deepEqual(session.auction_settings.keywords, input.settings.keywords)
    assert.deepEqual(session.auction_settings.closeKeywords, input.settings.closeKeywords)
    assert.equal(round.private_reply_template, input.settings.privateText)
    assert.equal(session.cost_amount, '125.50')
    assert.equal(session.shipping_cost, '7.00')
    assert.equal(session.other_fees, '3.25')
    assert.equal(session.auction_settings.auto_accumulate_summary, true)
    assert.equal(round.session_automation.auto_accumulate_summary, true)
    assert.equal(
      (
        await one('select normalize_auction_thai_settings($1) value', [
          JSON.stringify({ ...input.settings, auto_accumulate_summary: false }),
        ])
      ).value.auto_accumulate_summary,
      false,
    )
    assert.equal(
      (
        await one('select normalize_auction_thai_settings($1) value', [
          JSON.stringify({ ...input.settings, auto_accumulate_summary: 'false' }),
        ])
      ).value,
      null,
    )
    assert.equal(
      (await one('select live_session_dashboard($1,$2) result', [tenant, result.sessionId])).result
        .metrics.profit,
      -150.75,
      'SQL profit deducts all four expenses, including fees',
    )
    assert.equal((await one('select count(*)::int n from live_session_changes')).n, 1)
    assert.equal(round.page_id, session.page_id)
    assert.equal(round.live_post_id, session.live_post_id)
    const update = {
      ...input,
      sessionId: result.sessionId,
      roundId: result.auctionId,
      revision: result.revision,
      financialRevision: result.financialRevision,
      shippingFee: 47,
      settings: { ...input.settings, auto_accumulate_summary: false },
    }
    const updated = await save(update)
    assert.equal((await one('select auction_settings from live_sessions where id=$1', [result.sessionId])).auction_settings.auto_accumulate_summary, false)
    assert.equal((await one('select session_automation from auctions where id=$1', [result.auctionId])).session_automation.auto_accumulate_summary, false)
    assert.equal(
      (await one('select shipping_fee from auctions where id=$1', [result.auctionId])).shipping_fee,
      '47.00',
    )
    await assert.rejects(save(update), /SESSION_CHANGED/)
    // Once bidding has begun, price edits reject the entire settings/finance transaction.
    await db.query("update auctions set leading_bidder_id='900',current_price=300 where id=$1", [
      result.auctionId,
    ])
    session = await one('select * from live_sessions where id=$1', [result.sessionId])
    await assert.rejects(
      save({
        ...update,
        revision: updated.revision,
        financialRevision: updated.financialRevision,
        shippingFee: 99,
        finance: { ...input.finance, cost: 999 },
        settings: { ...input.settings, keywords: ['changed'], auto_accumulate_summary: false },
      }),
      /BIDS_ALREADY_ACCEPTED/,
    )
    assert.deepEqual(
      await one('select * from live_sessions where id=$1', [result.sessionId]),
      session,
    )
    round = await one('select * from auctions where id=$1', [result.auctionId])
    assert.equal(round.current_price, '300.00')
    assert.equal(round.shipping_fee, '47.00')
    assert.equal(
      (await one('select count(*)::int n from live_session_changes')).n,
      2,
      'failed updates leave no partial financial audit entry',
    )
    assert.equal(
      (
        await one(
          "select has_function_privilege('authenticated','save_auction_workspace(uuid,uuid,uuid,jsonb)','execute') allowed",
        )
      ).allowed,
      false,
    )
    const emptyExpenses = await save({
      ...input,
      livePostId: '7001',
      finance: { cost: '', ads: null, shipping: '', fees: null },
    })
    const zero = await one(
      'select cost_amount,ad_spent,shipping_cost,other_fees from live_sessions where id=$1',
      [emptyExpenses.sessionId],
    )
    assert.deepEqual(Object.values(zero), ['0.00', '0.00', '0.00', '0.00'])
  } finally {
    await db.close()
  }
})
