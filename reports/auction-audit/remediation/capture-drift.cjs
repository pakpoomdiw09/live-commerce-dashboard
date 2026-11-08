const fs = require('node:fs')
const path = require('node:path')
process.env.AUCTION_AUDIT_ROOT = process.argv[2]
const { fixture } = require('../../../scripts/helpers/auction-hardening-db.cjs')
;(async () => {
  const f = await fixture()
  try {
    const sig = 'public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)'
    const read = () => f.one('select pg_get_functiondef($1::regprocedure) definition', [sig])
    fs.writeFileSync(path.join(__dirname, 'process.before.sql'), (await read()).definition)
    await f.db.exec(fs.readFileSync('supabase/live-auction-audit-hardening-2.sql', 'utf8'))
    fs.writeFileSync(path.join(__dirname, 'process.after.sql'), (await read()).definition)
    console.log('PASS: actual before/after pg_get_functiondef captured in isolated PGlite')
  } finally { await f.db.close() }
})().catch(e => { console.error(e.code || e.name); process.exitCode = 1 })
