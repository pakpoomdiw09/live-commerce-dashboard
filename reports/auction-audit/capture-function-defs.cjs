// Isolated in-memory PGlite only; this script never reads connection credentials.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const baseline = path.resolve(process.argv[2])
const current = path.resolve(__dirname, '../..')
const { build } = require(path.join(baseline, 'scripts/build-full-database-setup.cjs'))
async function run() {
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
    await db.exec(build(baseline).completeSql)
    const beforeTimestampVolatility = (
      await one(
        "select provolatile from pg_proc where oid='public.auction_comment_timestamp(text)'::regprocedure",
      )
    ).provolatile
    const signature = 'public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)'
    const before = await one(
      'select $1::regprocedure::oid oid,pg_get_functiondef($1::regprocedure) definition',
      [signature],
    )
    fs.writeFileSync(path.join(__dirname, 'process-comment.before.sql'), before.definition)
    await db.exec(
      fs.readFileSync(path.join(current, 'supabase/live-auction-audit-hardening.sql'), 'utf8'),
    )
    const after = await one(
      'select $1::regprocedure::oid oid,pg_get_functiondef($1::regprocedure) definition',
      [signature],
    )
    assert.equal(
      after.oid,
      before.oid,
      'CREATE OR REPLACE preserves function identity and dependencies',
    )
    fs.writeFileSync(path.join(__dirname, 'process-comment.after.sql'), after.definition)
    const security = await one(`select relrowsecurity enabled,
      has_table_privilege('anon','public.auction_poll_cursors','SELECT') anon_select,
      has_table_privilege('authenticated','public.auction_poll_cursors','SELECT') authenticated_select
      from pg_class where oid='public.auction_poll_cursors'::regclass`)
    assert.deepEqual(security, { enabled: true, anon_select: false, authenticated_select: false })
    const signatures = (
      await db.query(`select proname,oid::regprocedure::text signature,pronargs,pronargdefaults,provolatile
      from pg_proc where pronamespace='public'::regnamespace and proname in
      ('auction_comment_timestamp','process_live_auction_comment','finalize_live_auction_highest_bid','finalize_live_auction','close_due_live_auction','expire_live_auctions') order by proname`)
    ).rows
    const diagnostic = await db.query(
      fs.readFileSync(path.join(__dirname, 'a3-stalled-rounds.sql'), 'utf8'),
    )
    assert.equal(diagnostic.rows.length, 0)
    fs.writeFileSync(
      path.join(__dirname, 'sql-evidence.json'),
      JSON.stringify(
        {
          preservesFunctionOid: true,
          beforeTimestampVolatility,
          security,
          signatures,
          diagnosticValid: true,
        },
        null,
        2,
      ) + '\n',
    )
    console.log(
      'PASS: real pg_get_functiondef captured before/after; function OID retained; cursor RLS and browser revocations verified.',
    )
    console.log(
      'PASS: signature/volatility metadata recorded from isolated PGlite; no external database used.',
    )
    console.log(
      'PASS: standalone read-only A3 diagnostic executed against the empty isolated fixture.',
    )
  } finally {
    await db.close()
  }
}
run().catch(() => {
  console.error('Isolated function-definition capture failed')
  process.exitCode = 1
})
