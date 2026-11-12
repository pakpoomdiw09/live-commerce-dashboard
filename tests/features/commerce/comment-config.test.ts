import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import {
  resolveCommentSettings,
  renderCommentTemplate,
} from '../../../lib/features/commerce/comment-config'
import { parseAuctionComment } from '../../../lib/integrations/facebook/auction-comment-parser'

const { build } = createRequire(import.meta.url)('../../../scripts/build-full-database-setup.cjs')

// Each successive case empties higher-priority fields and leaves conflicting lower fields.
const paths = [
  ['auction_settings', 'keywords'],
  ['keywords'],
  ['confirmation_keywords'],
  ['confirmation_tags'],
  ['comment_settings', 'confirmation_keywords'],
  ['comment_settings', 'confirmation_tags'],
  ['comment_settings', 'keywords'],
  ['auction_settings', 'confirmation_keywords'],
  ['auction_settings', 'confirmation_tags'],
]
const closingField: Record<string, string> = {
  keywords: 'closeKeywords',
  confirmation_keywords: 'closing_keywords',
  confirmation_tags: 'closing_tags',
}
const precedenceCases = Array.from({ length: paths.length * 2 + 1 }, (_, selected) => {
  const sources: Record<string, any>[] = [{}, {}]
  const empty = [null, [], [' ', '\uFE0F'], [null, 42], 'invalid']
  for (let index = 0; index < paths.length * 2; index++) {
    const source = sources[Math.floor(index / paths.length)]
    const path = paths[index % paths.length]
    let target = source
    if (path.length === 2) target = source[path[0]] ??= {}
    const key = path[path.length - 1]
    target[key] =
      index < selected ? empty[index % empty.length] : [` TAG-${index} `, `tag-${index}`]
    target[closingField[key]] =
      index < selected ? empty[index % empty.length] : [` CLOSE-${index} `]
  }
  return {
    session: sources[0],
    snapshot: sources[1],
    confirmation: selected < paths.length * 2 ? [`tag-${selected}`] : ['1'],
    closing: selected < paths.length * 2 ? [`close-${selected}`] : ['ปิด'],
  }
})
precedenceCases.push({
  session: {
    auction_settings: { keywords: ['111'], closeKeywords: ['XXX'] },
    confirmation_keywords: [],
    closing_keywords: [],
  },
  snapshot: {},
  confirmation: ['111'],
  closing: ['xxx'],
})

test('dashboard tags win and empty normalized arrays fall through every source before defaults', () => {
  for (const input of precedenceCases) {
    const actual = resolveCommentSettings(input.session, input.snapshot)
    assert.deepEqual(actual.keywords, input.confirmation)
    assert.deepEqual(actual.closeKeywords, input.closing)
    const reparsed = resolveCommentSettings({}, actual)
    assert.deepEqual(reparsed.keywords, input.confirmation)
    assert.deepEqual(reparsed.closeKeywords, input.closing)
  }
})

test('canonical session tags override aliases, normalize Unicode and use centralized empty defaults', () => {
  const settings = resolveCommentSettings(
    { confirmation_keywords: [' ＲＥＡＤＹ '], closing_keywords: [' END '] },
    {
      confirmation_tags: ['accept'],
      closing_tags: ['stop'],
      keywords: ['legacy'],
      opening_tags: [' START '],
    },
  )
  assert.deepEqual(settings.keywords, ['ready'])
  assert.deepEqual(settings.closeKeywords, ['end'])
  assert.equal(
    parseAuctionComment('READY', false, {
      ...settings,
      closeEnabled: true,
      heartCloses: false,
    },
    true,
  ).type,
    'CONFIRM_BID',
  )
  const refreshed = resolveCommentSettings(
    { auction_settings: { keywords: ['NEW'], closeKeywords: ['FINISH'] } },
    { confirmation_tags: ['stale'], closing_tags: ['stale'] },
  )
  assert.deepEqual(refreshed.keywords, ['new'])
  assert.deepEqual(
    resolveCommentSettings({}, refreshed).keywords,
    ['new'],
    'resolved settings remain stable when parsed again',
  )
  assert.deepEqual(refreshed.closeKeywords, ['finish'])
  assert.deepEqual(
    resolveCommentSettings({}, { confirmation_tags: [], closing_tags: [] }).keywords,
    ['1'],
  )
  assert.deepEqual(
    resolveCommentSettings({}, { confirmation_tags: [], closing_tags: [] }).closeKeywords,
    ['ปิด'],
  )
  assert.equal(
    parseAuctionComment('เปิด').type,
    'IGNORE',
    'unconfigured opening chatter has no side effects',
  )
  assert.equal(
    parseAuctionComment('เคาะ 3', true).type,
    'IGNORE',
    'counting requires configured tags',
  )
})

test('reply aliases interpolate once without evaluating customer supplied template tokens', () => {
  assert.equal(
    renderCommentTemplate('{customer_name}|{item_name}|{price}|{total_amount}|{bank_account}', {
      bidder_name: '{bank_account}',
      product_name: 'Amulet',
      price: '200',
      total: '250',
      bank_account: 'BANK',
    }),
    '{bank_account}|Amulet|200|250|BANK',
  )
})

test('database configuration isolates modes and tenants; dynamic catalog matching preserves stock, post and replay', async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const one = async (sql: string, args: any[] = []) => (await db.query<any>(sql, args)).rows[0]
  try {
    await db.exec(`
      create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create schema extensions;
      create table auth.users(id uuid primary key default gen_random_uuid(),email text);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;create publication supabase_realtime;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    `)
    await db.exec(build().completeSql)
    for (const input of precedenceCases) {
      const actual = (
        await one('select resolve_facebook_comment_settings($1,$2) result', [
          JSON.stringify(input.session),
          JSON.stringify(input.snapshot),
        ])
      ).result
      assert.deepEqual(actual.keywords, input.confirmation)
      assert.deepEqual(actual.closeKeywords, input.closing)
      const ts = resolveCommentSettings(input.session, input.snapshot)
      assert.deepEqual(actual.keywords, ts.keywords, 'SQL and TypeScript use identical precedence')
      assert.deepEqual(actual.closeKeywords, ts.closeKeywords)
    }
    const migration = await readFile('supabase/facebook-comment-configuration.sql', 'utf8')
    const signature = 'public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)'
    const identity = (await one('select $1::regprocedure::oid id', [signature])).id
    // A compatible CREATE OR REPLACE must preserve dependent objects and function identity.
    await db.exec(`create view comment_resolver_dependency as
      select process_live_auction_comment(null::uuid,null::uuid,null::uuid,null::text,null::numeric,null::text) result;
      create or replace function public.process_live_auction_comment(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
      returns jsonb language sql as $$select '{"legacy":true}'::jsonb$$;`)
    await db.exec(migration)
    await db.exec(migration)
    assert.equal((await one('select $1::regprocedure::oid id', [signature])).id, identity)
    assert.ok((await one("select to_regclass('comment_resolver_dependency') name")).name)
    await db.exec(`drop view comment_resolver_dependency;
      drop function public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text);
      create function public.process_live_auction_comment(old_round uuid,old_tenant uuid,old_event uuid,old_kind text,old_amount numeric,old_control text)
      returns text language sql as $$select 'older variant'::text$$;
      grant execute on function public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) to anon,authenticated;
      create function public.process_live_auction_comment(uuid) returns jsonb language sql as $$select '{"overload":true}'::jsonb$$;`)
    await db.exec(migration)
    assert.deepEqual(
      (await one('select proargnames from pg_proc where oid=$1::regprocedure', [signature]))
        .proargnames,
      ['p_auction', 'p_tenant', 'p_event', 'p_kind', 'p_amount', 'p_control'],
    )
    assert.equal(
      (
        await one(
          'select prorettype::regtype::text result from pg_proc where oid=$1::regprocedure',
          [signature],
        )
      ).result,
      'jsonb',
    )
    assert.equal(
      (await one('select process_live_auction_comment(null::uuid) result')).result.overload,
      true,
    )
    await db.exec(`create or replace function public.process_live_auction_comment(
      p_auction uuid default null,p_tenant uuid default null,p_event uuid default null,
      p_kind text default null,p_amount numeric default null,p_control text default null)
      returns jsonb language sql as $$select '{"older_defaults":true}'::jsonb$$;`)
    await db.exec(migration)
    assert.equal(
      (await one('select pronargdefaults n from pg_proc where oid=$1::regprocedure', [signature]))
        .n,
      2,
      'older parameter defaults are replaced with the canonical RPC contract',
    )
    // The script also installs resolvers/helpers missing from an older auction deployment.
    await db.exec(`drop function public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text);
      drop function public.process_live_auction_highest_bid(uuid,uuid,uuid,text,numeric,text);
      drop function public.finalize_live_auction_highest_bid(uuid,uuid,uuid,boolean);
      drop function public.auction_close_keyword_matches(text,jsonb);
      drop function public.auction_comment_tags(jsonb,text,text);
      drop function public.normalize_auction_tag(text);
      alter table auctions drop column winner_locked_at;`)
    await db.exec(migration)
    await db.exec(migration)
    await db.exec('drop function public.process_live_auction_comment(uuid)')
    for (const routine of [
      signature,
      'public.process_live_auction_highest_bid(uuid,uuid,uuid,text,numeric,text)',
      'public.finalize_live_auction_highest_bid(uuid,uuid,uuid,boolean)',
    ]) {
      for (const role of ['anon', 'authenticated', 'service_role'])
        assert.equal(
          (await one("select has_function_privilege($1,$2,'execute') allowed", [role, routine]))
            .allowed,
          role === 'service_role',
        )
    }
    const refreshed = (
      await one(`select resolve_facebook_comment_settings('{"auction_settings":{"keywords":["NEW"],"closeKeywords":["FINISH"]}}',
      '{"confirmation_tags":["stale"],"closing_tags":["stale"]}') result`)
    ).result
    assert.deepEqual(refreshed.keywords, ['new'])
    assert.deepEqual(refreshed.closeKeywords, ['finish'])
    const tenant = (
      await one("insert into tenants(name,page_id) values('Shop','100') returning id")
    ).id
    const other = (
      await one("insert into tenants(name,page_id) values('Other','200') returning id")
    ).id
    const actor = (
      await one("insert into auth.users(email) values('owner@example.test') returning id")
    ).id
    await db.query("insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')", [
      tenant,
      actor,
    ])
    const customer = (
      await one(
        "insert into customers(tenant_id,platform,platform_user_id) values($1,'facebook','900') returning id",
        [tenant],
      )
    ).id
    const session = (
      await one(
        "insert into live_sessions(tenant_id,page_id,live_post_id) values($1,'100','456') returning id",
        [tenant],
      )
    ).id
    const save = async (settings: object, owner = actor) =>
      (
        await one('select save_facebook_comment_config($1,$2,$3,$4) result', [
          tenant,
          session,
          owner,
          JSON.stringify(settings),
        ])
      ).result
    const context = await save({
      mode: 'cf',
      confirmation_tags: [' READY '],
      closing_tags: [' END '],
      cf_patterns: [{ code: 'amulet', keywords: ['Reserve this'], match_mode: 'strict' }],
    })
    assert.equal(context.mode, 'cf')
    assert.deepEqual(context.settings.keywords, ['ready'])
    assert.deepEqual(context.settings.closeKeywords, ['end'])
    await assert.rejects(save({ mode: 'auction' }, customer), /COMMENT_CONFIG_FORBIDDEN/)
    await assert.rejects(save({ confirmation_tags: 'bad' }), /COMMENT_TAGS_INVALID/)
    await assert.rejects(
      db.query("select facebook_comment_context($1,'200',array['456'])", [tenant]),
      /COMMENT_TENANT_PAGE_INVALID/,
    )
    await db.query(
      "insert into products(tenant_id,code,name,price,stock) values($1,'amulet','Amulet',300,3),($1,'other','Other',100,2),($2,'foreign','Foreign',1,10)",
      [tenant, other],
    )
    const order = async (text: string, comment: string, customerId = customer) =>
      one("select * from place_facebook_catalog_order($1,$2,'100','456',$3,$4)", [
        tenant,
        customerId,
        comment,
        text,
      ])
    const first = await order(' RESERVE THIS ', 'c1')
    assert.equal(first.r_status, 'created')
    assert.equal(Number(first.r_amount), 300)
    assert.equal(
      (await one('select live_post_id from orders where id=$1', [first.r_order_id])).live_post_id,
      '456',
    )
    assert.equal((await order('reserve this', 'c1')).r_order_id, first.r_order_id)
    assert.equal(
      (await one("select stock from products where tenant_id=$1 and code='amulet'", [tenant]))
        .stock,
      2,
    )
    assert.equal((await order('amulet other', 'ambiguous')).r_status, 'no_match')
    assert.equal((await order('foreign', 'foreign')).r_status, 'no_match')
    assert.equal((await order('not configured', 'inquiry')).r_status, 'no_match')
    await assert.rejects(order('amulet', 'wrong-customer', actor), /COMMENT_CUSTOMER_INVALID/)
    await save({ mode: 'auction' })
    assert.equal((await order('amulet', 'auction-comment')).r_status, 'no_match')
    await save({ mode: 'auto' })
    assert.equal((await order('amulet', 'auto-comment')).r_status, 'no_match')
    assert.equal((await one('select count(*)::int n from orders')).n, 1)
    await save({ mode: 'cf', confirmation_keywords: ['CONFIRMED'], closing_keywords: ['FINISHED'] })
    const canonical = (
      await one("select facebook_comment_context($1,'100',array['100_456']) result", [tenant])
    ).result
    assert.deepEqual(canonical.settings.keywords, ['confirmed'])
    assert.deepEqual(canonical.settings.closeKeywords, ['finished'])
    await save({ confirmation_keywords: [], closing_keywords: [] })
    const aliases = (
      await one("select facebook_comment_context($1,'100',array['456']) result", [tenant])
    ).result
    assert.deepEqual(aliases.settings.keywords, ['ready'])
    assert.deepEqual(aliases.settings.closeKeywords, ['end'])
    await save({ confirmation_tags: [], closing_tags: [] })
    const defaults = (
      await one("select facebook_comment_context($1,'100',array['456']) result", [tenant])
    ).result
    assert.deepEqual(defaults.settings.keywords, ['1'])
    assert.deepEqual(defaults.settings.closeKeywords, ['ปิด'])
    await db.query("update products set is_active=false where tenant_id=$1 and code='amulet'", [
      tenant,
    ])
    assert.equal((await order('reserve this', 'inactive')).r_status, 'no_match')
    await db.query(
      `insert into commerce_variants(tenant_id,product_id,label,variant_code,price,stock)
      select tenant_id,id,'Silver','SILVER',150,1 from products where tenant_id=$1 and code='other'`,
      [tenant],
    )
    const variant = await order('silver', 'variant')
    assert.equal(variant.r_status, 'created')
    assert.equal(variant.r_variant_label, 'Silver')
    assert.equal(Number(variant.r_amount), 150)
    assert.equal(
      (
        await one(
          "select stock from commerce_variants where tenant_id=$1 and variant_code='SILVER'",
          [tenant],
        )
      ).stock,
      0,
    )
    assert.equal((await order('silver', 'sold-out')).r_status, 'sold_out')
    await db.query('update commerce_variants set is_active=false where tenant_id=$1', [tenant])
    assert.equal((await order('silver', 'inactive-variant')).r_status, 'no_match')
    const beforeRerun = (await db.query('select * from orders order by id')).rows
    await db.exec(migration)
    await db.exec(migration)
    assert.deepEqual(
      (await db.query('select * from orders order by id')).rows,
      beforeRerun,
      'reruns preserve existing business records',
    )
    assert.equal(
      (
        await one(
          "select has_function_privilege('authenticated','public.place_facebook_catalog_order(uuid,uuid,text,text,text,text)','execute') allowed",
        )
      ).allowed,
      false,
    )
  } finally {
    await db.close()
  }
})
