// Refresh reviewed source digests from isolated PGlite, without writing bootstrap bundles.
const fs = require('node:fs')
const { fixture } = require('../../../scripts/helpers/auction-hardening-db.cjs')
;(async () => {
  const f = await fixture()
  try {
    const signatures = ['public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)',
      'public.save_auction_workspace(uuid,uuid,uuid,jsonb)', 'public.normalize_auction_thai_settings(jsonb)',
      'public.normalize_auction_settings_before_split(jsonb)']
    const rows = []
    let sql = fs.readFileSync('reports/auction-audit/preflight.sql', 'utf8')
    for (const signature of signatures) {
      const row = await f.one('select $1::text signature,md5(replace(prosrc,chr(13)||chr(10),chr(10))) body_md5 from pg_proc where oid=$1::regprocedure', [signature])
      rows.push(row)
      if (sql.includes(" ('" + signature + "','")) {
        sql = sql.split('\n').map(line => line.includes(" ('" + signature + "','") ? line.replace(/[a-f0-9]{32}/, row.body_md5) : line).join('\n')
      } else {
        sql = sql.replace('\n),\nfunctions(', ",\n ('" + signature + "','" + row.body_md5 + "')\n),\nfunctions(")
      }
    }
    fs.writeFileSync('reports/auction-audit/preflight.sql', sql)
    fs.writeFileSync('reports/auction-audit/auto-cycle/source-digests.json', JSON.stringify(rows, null, 2))
    const definition = await f.one("select pg_get_functiondef('public.normalize_auction_settings_before_split(jsonb)'::regprocedure) definition")
    fs.writeFileSync('reports/auction-audit/auto-cycle/normalizer-after.sql', definition.definition)
    const process = await f.one("select pg_get_functiondef('public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)'::regprocedure) definition")
    fs.writeFileSync('reports/auction-audit/auto-cycle/process-current.sql', process.definition)
    const checks = (await f.db.exec(sql)).flatMap(result => result.rows ?? [])
    if (checks.some(row => row.status !== 'PASS')) throw Error('Source preflight has blockers')
    fs.writeFileSync('reports/auction-audit/auto-cycle/preflight-current.json', JSON.stringify(checks, null, 2))
    console.log('PASS: reviewed source digests recorded; no external database used')
  } finally { await f.db.close() }
})().catch(error => { console.error(error.code || error.name); process.exitCode = 1 })
