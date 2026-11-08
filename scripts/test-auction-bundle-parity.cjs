// Intentionally red until the separately authorized bootstrap regeneration task.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { fixture } = require('./helpers/auction-hardening-db.cjs')
test('bootstrap financial functions and timestamp volatility equal migration source (bundle regeneration required)', async () => {
  const source = await fixture()
  let bundle
  try {
    bundle = await fixture(fs.readFileSync('supabase/complete_schema.sql', 'utf8'))
    const signatures = ['public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)', 'public.finalize_live_auction(uuid,uuid,uuid,boolean)']
    const differences = []
    for (const signature of signatures) {
      const read = async f => (await f.one('select pg_get_functiondef($1::regprocedure) definition', [signature])).definition
      if (await read(source) !== await read(bundle)) differences.push(signature)
    }
    const volatility = async f => (await f.one("select provolatile from pg_proc where oid='public.auction_comment_timestamp(text)'::regprocedure")).provolatile
    if (await volatility(source) !== await volatility(bundle)) differences.push('auction_comment_timestamp volatility')
    assert.deepEqual(differences, [], 'Stored bootstrap is stale; regenerate only in the separate bundle task')
  } finally { await source.db.close(); if (bundle) await bundle.db.close() }
})
