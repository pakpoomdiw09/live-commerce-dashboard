// Local, isolated audit reproductions. No .env files, network, production DB or message sends.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { build } = require('../scripts/build-full-database-setup.cjs')
const load = require('../scripts/helpers/load-typescript.cjs')

async function main() {
  const parser = load('lib/integrations/facebook/auction-comment-parser.ts')
  const settings = {
    keywords: ['1'],
    closeKeywords: ['ปิด'],
    countEnabled: false,
    closeEnabled: true,
    heartCloses: false,
  }
  const results = {
    hostCloseKeywordMismatch: {
      configuredTag: 'ปิด',
      apiPublishedTag: settings.closeKeywords[0],
      parsedApiComment: parser.parseAuctionComment(settings.closeKeywords[0], true, settings),
      parsedConfiguredComment: parser.parseAuctionComment('ปิด', true, settings),
    },
  }
  const db = new PGlite({ extensions: { pgcrypto } })
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  try {
    await db.exec(`
      create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create schema extensions;
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
    const tenant = (
      await one("insert into tenants(name,page_id) values('Audit only','100') returning id")
    ).id
    const bank = (
      await one(
        "insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'KBANK','Audit only','0000000000') returning id",
        [tenant],
      )
    ).id
    const automation = {
      ...settings,
      winnerFlow: 'on_demand',
      publicReply: false,
      privateReply: false,
      bankAccountId: bank,
    }
    const auction = await one(
      `insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,bank_account_id,host_ids,session_automation,public_reply_enabled,private_reply_enabled)
      values($1,'100','456','Audit item',200,20,0,$2,array['999'],$3,false,false) returning *`,
      [tenant, bank, JSON.stringify(automation)],
    )
    const receipt = (
      await one(
        "insert into facebook_webhook_payloads(payload_sha256,raw_payload) values($1,'{}') returning id",
        ['a'.repeat(64)],
      )
    ).id
    async function event(text, extra = {}, post = '456') {
      return (
        await one(
          `insert into facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload,status)
        values($1,'100',$2,'comments:100','change',$3,'completed') returning id`,
          [
            receipt,
            randomUUID(),
            JSON.stringify({
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                post_id: post,
                comment_id: post + '_' + randomUUID(),
                from: { id: '900', name: 'Audit bidder' },
                message: text,
                created_time: new Date().toISOString(),
                ...extra,
              },
            }),
          ],
        )
      ).id
    }
    const bidId = await event('250')
    const bid = (
      await one("select process_live_auction_comment($1,$2,$3,'NUMERIC_BID',250,null) result", [
        auction.id,
        tenant,
        bidId,
      ])
    ).result
    const originalCommentTime = Math.floor(new Date(auction.created_at).getTime() / 1000) - 3600
    const confirmationId = await event('1', { created_time: originalCommentTime })
    const confirmation = (
      await one("select process_live_auction_comment($1,$2,$3,'CONFIRM_BID',null,null) result", [
        auction.id,
        tenant,
        confirmationId,
      ])
    ).result
    results.staleConfirmation = {
      bidStatus: bid.status,
      sourceTimeBeforeRound: true,
      confirmationStatus: confirmation.status,
      ordersCreated: Number((await one('select count(*) n from orders')).n),
    }
    const second = (
      await one(
        `insert into auctions(tenant_id,page_id,live_post_id,item_name,start_price,min_step,shipping_fee,bank_account_id,host_ids,session_automation,public_reply_enabled,private_reply_enabled)
      values($1,'100','457','Second audit item',200,20,0,$2,array['999'],$3,false,false) returning id`,
        [tenant, bank, JSON.stringify(automation)],
      )
    ).id
    await one("select process_live_auction_comment($1,$2,$3,'NUMERIC_BID',250,null) result", [
      second,
      tenant,
      await event('250', {}, '457'),
    ])
    const closed = (
      await one('select finalize_live_auction($1,$2,null,false) result', [second, tenant])
    ).result
    const confirmed = (
      await one("select process_live_auction_comment($1,$2,$3,'CONFIRM_BID',null,null) result", [
        second,
        tenant,
        await event('1', {}, '457'),
      ])
    ).result
    const state = await one('select status,winner_locked_at,order_id from auctions where id=$1', [
      second,
    ])
    results.directCloseOnDemand = {
      closeResult: closed,
      confirmationStatus: confirmed.status,
      finalState: state,
    }
    const functionNames = [
      'process_live_auction_comment',
      'process_live_auction_highest_bid',
      'finalize_live_auction_highest_bid',
      'finalize_live_auction',
    ]
    results.effectiveFunctions = {}
    for (const name of functionNames) {
      const rows = (
        await db.query(
          "select pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname=$1",
          [name],
        )
      ).rows
      results.effectiveFunctions[name] = rows.map((row) => ({
        usesRowLocks: /for update/i.test(row.definition),
        validatesSourceCreatedTime: /v->>'created_time'/.test(row.definition),
        hasWinnerConfirmation: /winner_confirmation_comment_id/.test(row.definition),
        hasOnDemandBranch: /winnerFlow/.test(row.definition),
      }))
    }
    if (results.hostCloseKeywordMismatch.parsedApiComment.type !== 'HOST_CONTROL')
      throw new Error('A1 regression: configured close tag is not parsed as HOST_CONTROL')
    if (confirmation.status !== 'stale' || results.staleConfirmation.ordersCreated !== 0)
      throw new Error('A2 regression: stale confirmation changed auction state')
    if (closed.status !== 'awaiting_confirmation' || !state.winner_locked_at || confirmed.status !== 'confirmed' || !state.order_id)
      throw new Error('A3 regression: on-demand close did not lock and confirm its winner')
  } finally {
    await db.close()
  }
  fs.writeFileSync(
    path.join(__dirname, 'live-auction-reproductions.json'),
    JSON.stringify(results, null, 2) + '\n',
  )
  console.log(JSON.stringify(results, null, 2))
}
main().catch((error) => {
  console.error({ code: error.code ?? null, message: error.message })
  process.exitCode = 1
})
