const fs = require('node:fs')
const path = require('node:path')
const RETRY_CODES = new Set(['40P01', '55P03', '40001', '57014'])

// Split only at SQL-level semicolons; DO/function dollar bodies remain intact.
function splitSql(source) {
  source = source.replace(/\r\n/g, '\n')
  const statements = []
  let sql = '',
    quote = '',
    block = 0,
    line = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i],
      next = source[i + 1]
    if (line) {
      if (ch === '\n') {
        line = false
        sql += '\n'
      }
      continue
    }
    if (block) {
      if (ch === '/' && next === '*') {
        block++
        i++
      } else if (ch === '*' && next === '/') {
        block--
        i++
        sql += ' '
      }
      continue
    }
    if (quote) {
      sql += ch
      if (ch === quote) {
        if (next === quote) {
          sql += next
          i++
        } else quote = ''
      }
      continue
    }
    if (ch === '-' && next === '-') {
      line = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      block = 1
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      sql += ch
      continue
    }
    if (ch === '$') {
      const tag = source.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/)?.[0]
      if (tag) {
        const end = source.indexOf(tag, i + tag.length)
        if (end < 0) throw Error('Unterminated SQL dollar quote')
        sql += source.slice(i, end + tag.length)
        i = end + tag.length - 1
        continue
      }
    }
    if (ch === ';') {
      if (sql.trim()) statements.push(sql.trim())
      sql = ''
    } else sql += ch
  }
  if (quote || block) throw Error('Unterminated SQL quote/comment')
  if (sql.trim()) statements.push(sql.trim())
  return statements
}
const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw Error('Invalid migration identifier')
  return '"' + name + '"'
}
const tableName = (name) => (name.includes('.') ? name : 'public.' + name)
const quoted = (name) => tableName(name).split('.').map(ident).join('.')

function buildPlan(root) {
  const steps = []
  for (const [step, file] of [
    [1, 'platform.sql'],
    [2, 'schema_patch.sql'],
  ]) {
    for (const sql of splitSql(fs.readFileSync(path.join(root, 'supabase', file), 'utf8'))) {
      if (
        /^set\s+lock_timeout\b/i.test(sql) ||
        /^revoke execute on function (consume_slip_credit|refund_slip_credit)\(uuid\)/i.test(sql)
      )
        continue
      let m = sql.match(/^alter table (\w+(?:\.\w+)?)\s+add column if not exists (\w+)\b/i)
      if (m) {
        const table = tableName(m[1]),
          column = m[2]
        const locks = new Map([[table, 'ACCESS EXCLUSIVE']])
        for (const ref of sql.matchAll(/references\s+(\w+(?:\.\w+)?)\s*\(/gi))
          if (!locks.has(tableName(ref[1]))) locks.set(tableName(ref[1]), 'SHARE ROW EXCLUSIVE')
        steps.push({
          step,
          kind: 'column',
          table,
          name: column,
          sql: [sql],
          locks: [...locks].sort(([a], [b]) => a.localeCompare(b)),
        })
        continue
      }
      m = sql.match(/^create index if not exists (\w+)\s+on\s+(\w+(?:\.\w+)?)/i)
      if (m) {
        steps.push({
          step,
          kind: 'index',
          name: m[1],
          table: tableName(m[2]),
          sql: [sql.replace(/^create index/i, 'create index concurrently')],
          locks: [],
        })
        continue
      }
      m = sql.match(
        /^create or replace function (consume_slip_credit|refund_slip_credit)\(p_tenant uuid\)/i,
      )
      if (m) {
        const signature = `public.${m[1]}(uuid)`
        steps.push({
          step,
          kind: 'function',
          name: signature,
          sql: [
            sql.replace(/^create or replace function/i, 'create function'),
            `revoke all on function ${signature} from public,anon,authenticated`,
            `grant execute on function ${signature} to service_role`,
          ],
          locks: [],
        })
        continue
      }
      m = sql.match(
        /^do\s+\$\$[\s\S]*?alter table customers add constraint (customers_order_status_check)\s+(check[\s\S]*?);\s*exception/i,
      )
      if (m) {
        const constraint = {
          step,
          kind: 'constraint',
          table: 'public.customers',
          name: m[1],
          sql: [`alter table public.customers add constraint ${m[1]} ${m[2]} not valid`],
          locks: [['public.customers', 'ACCESS EXCLUSIVE']],
        }
        steps.push(constraint, {
          ...constraint,
          kind: 'validate',
          sql: [`alter table public.customers validate constraint ${m[1]}`],
          locks: [['public.customers', 'SHARE UPDATE EXCLUSIVE']],
        })
        continue
      }
      throw Error(`Unsupported statement in ${file}; review it before extending this runner`)
    }
  }
  return steps
}

async function installed(db, item) {
  if (item.kind === 'column')
    return (
      await db.query(
        'select exists(select 1 from pg_attribute where attrelid=to_regclass($1) and attname=$2 and not attisdropped) ok',
        [item.table, item.name],
      )
    ).rows[0].ok
  if (item.kind === 'function')
    return (await db.query('select to_regprocedure($1) is not null ok', [item.name])).rows[0].ok
  if (item.kind === 'index') {
    const row = (
      await db.query(
        'select i.indisvalid valid from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid where n.nspname=$1 and c.relname=$2',
        ['public', item.name],
      )
    ).rows[0]
    if (row && !row.valid)
      throw Object.assign(
        Error(`Index public.${item.name} is invalid; inspect/rebuild it before retrying`),
        { code: 'INVALID_INDEX' },
      )
    return !!row
  }
  const row = (
    await db.query(
      'select convalidated valid from pg_constraint where conrelid=to_regclass($1) and conname=$2',
      [item.table, item.name],
    )
  ).rows[0]
  return item.kind === 'validate' ? !!row?.valid : !!row
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function retry(
  work,
  {
    maxRetries = 20,
    sleepMs = sleep,
    random = Math.random,
    log = console.log,
    stopped = () => false,
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    if (stopped())
      throw Object.assign(Error('Migration interrupted; committed steps can be resumed'), {
        code: 'INTERRUPTED',
      })
    try {
      return await work()
    } catch (error) {
      if (!RETRY_CODES.has(error.code) || (maxRetries !== 0 && attempt >= maxRetries)) throw error
      const delay = Math.round(
        Math.min(10000, 250 * 2 ** Math.min(attempt, 6)) * (0.75 + random() * 0.5),
      )
      log(`Retry ${attempt + 1}/${maxRetries || 'unlimited'}: ${error.code}; wait ${delay}ms`)
      await sleepMs(delay)
    }
  }
}

async function transaction(db, work) {
  await db.query('begin')
  try {
    await db.query("set local lock_timeout='3s'")
    await db.query("set local statement_timeout='60s'")
    const result = await work()
    await db.query('commit')
    return result
  } catch (error) {
    try {
      await db.query('rollback')
    } catch {}
    throw error
  }
}

async function runDdl(db, item, options = {}) {
  let ownedIndexOid = null
  return retry(async () => {
    if (ownedIndexOid !== null) {
      const current = (
        await db.query(
          "select c.oid,i.indisvalid valid,exists(select 1 from pg_stat_progress_create_index p where p.index_relid=c.oid) busy from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid where n.nspname='public' and c.relname=$1",
          [item.name],
        )
      ).rows[0]
      if (current && String(current.oid) !== String(ownedIndexOid))
        throw Object.assign(
          Error("Index identity changed; stopping rather than removing another migration's index"),
          { code: 'INVALID_INDEX' },
        )
      if (current && !current.valid) {
        if (current.busy)
          throw Object.assign(Error('Index build is still active'), { code: '55P03' })
        // Only remove the invalid OID left by THIS failed creation. Existing
        // indexes are never removed; another active build is never interrupted.
        await db.query(`drop index concurrently if exists ${quoted('public.' + item.name)}`)
      }
      ownedIndexOid = null
    }
    if (await installed(db, item)) return 'skip'
    if (item.kind === 'index') {
      // CONCURRENTLY must be an individual autocommit query, outside BEGIN.
      await db.query("set lock_timeout='3s'")
      await db.query("set statement_timeout='5min'")
      try {
        await db.query(item.sql[0])
      } catch (error) {
        if (RETRY_CODES.has(error.code)) {
          const failed = (
            await db.query(
              "select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid where n.nspname='public' and c.relname=$1 and i.indrelid=to_regclass($2) and not i.indisvalid",
              [item.name, item.table],
            )
          ).rows[0]
          ownedIndexOid = failed?.oid ?? null
        }
        throw error
      }
    } else
      await transaction(db, async () => {
        for (const [table, mode] of item.locks)
          await db.query(`lock table ${quoted(table)} in ${mode} mode nowait`)
        if (await installed(db, item)) return
        for (const sql of item.sql) await db.query(sql)
      })
    return 'done'
  }, options)
}

function backfillSql(table, limit = '$1') {
  if (!['comments', 'comment_rules'].includes(table)) throw Error('Unexpected backfill table')
  const match =
    table === 'comments'
      ? "t.page_id is not null and left(c.post_id,length(t.page_id)+1)=t.page_id||'_'"
      : 't.page_id=any(c.page_ids)'
  const eligible = `c.tenant_id is null and exists(select 1 from public.tenants t where ${match})`
  return {
    update: `with batch as (
      select c.id,(select t.id from public.tenants t where ${match} order by t.id limit 1) tenant_id
      from public.${table} c where ${eligible}
      order by c.id limit ${limit} for update of c skip locked
    ) update public.${table} c set tenant_id=b.tenant_id from batch b where c.id=b.id and c.tenant_id is null`,
    remaining: `select exists(select 1 from public.${table} c where ${eligible}) remaining`,
  }
}

async function runBackfill(
  db,
  table,
  { batchSize = 200, pauseMs = 75, maxLockedRounds = 600, ...options } = {},
) {
  const sql = backfillSql(table)
  let total = 0,
    lockedRounds = 0
  while (true) {
    const count = await retry(
      () => transaction(db, async () => (await db.query(sql.update, [batchSize])).rowCount),
      options,
    )
    if (!Number.isInteger(count) || count < 0 || count > batchSize)
      throw Error('Unexpected batch update count; stopping safely')
    total += count
    options.onBatch?.({ table, count, total })
    if (!count) {
      const pending = await retry(() => transaction(db, () => db.query(sql.remaining)), options)
      if (!pending.rows[0].remaining) return total
      if (++lockedRounds > maxLockedRounds)
        throw Object.assign(Error(`${table}: eligible rows remain locked; resume later`), {
          code: 'LOCKED_ROWS',
        })
    } else lockedRounds = 0
    await (options.sleepMs || sleep)(pauseMs)
    if (options.stopped?.())
      throw Object.assign(Error('Migration interrupted between batches'), { code: 'INTERRUPTED' })
  }
}

function renderManual(plan) {
  const literal = (text) => "'" + text.replaceAll("'", "''") + "'"
  const chunks = [
    `-- Generated by node scripts/run-safe-db-migration.cjs --write-sql.
-- One-shot client: psql -X -v ON_ERROR_STOP=1 -f supabase/safe_full_setup.sql
-- Do NOT use psql --single-transaction/-1. Existing quota functions are preserved.
-- SQL Editor: run the DDL first, then select ONLY the final CALL as a separate Run.
-- Indexes use ordinary CREATE INDEX IF NOT EXISTS for SQL Editor compatibility.
-- Transaction control in the final CALL still requires a top-level command.
-- On a busy database this manual file can time out; the Node runner provides retries.
set search_path=public,pg_catalog;
set lock_timeout='2s';`,
  ]
  for (const item of plan) {
    if (item.kind === 'index') {
      const sql = item.sql[0].replace(/^create index concurrently\b/i, 'create index')
      chunks.push(
        `\n-- ${item.kind}: ${item.name}\nset lock_timeout='2s';\nset statement_timeout='5min';\n${sql};`,
      )
      continue
    }
    let condition
    if (item.kind === 'column')
      condition = `not exists(select 1 from pg_attribute where attrelid=to_regclass(${literal(item.table)}) and attname=${literal(item.name)} and not attisdropped)`
    else if (item.kind === 'function') condition = `to_regprocedure(${literal(item.name)}) is null`
    else if (item.kind === 'validate')
      condition = `exists(select 1 from pg_constraint where conrelid=to_regclass(${literal(item.table)}) and conname=${literal(item.name)} and not convalidated)`
    else
      condition = `not exists(select 1 from pg_constraint where conrelid=to_regclass(${literal(item.table)}) and conname=${literal(item.name)})`
    chunks.push(
      `\n-- ${item.kind}: ${item.name}\nbegin;\nset local lock_timeout='2s';\nset local statement_timeout='60s';\ndo $safe_setup$ begin\n  if ${condition} then\n    ${item.sql.join(';\n    ')};\n  end if;\nend $safe_setup$;\ncommit;`,
    )
  }
  // A top-level CALL can COMMIT between batches. A DO block cannot do this when
  // submitted inside the SQL Editor's encompassing request transaction.
  const loops = ['comments', 'comment_rules']
    .map((table) => {
      const sql = backfillSql(table, '200')
      return `  idle_rounds:=0; attempts:=0;
  loop
    should_retry:=false;
    begin
      ${sql.update};
      get diagnostics changed=row_count;
      ${sql.remaining.replace(/^select exists/, 'select exists').replace(/ remaining$/, ' into pending')};
    exception when deadlock_detected or lock_not_available or serialization_failure then
      should_retry:=true;
    end;
    commit;
    if should_retry then
      attempts:=attempts+1;
      if attempts>20 then raise exception '${table}: retry budget exhausted; resume the CALL later';end if;
      perform pg_sleep(least(10.0,0.25*power(2,least(attempts,5))));
    else
      attempts:=0;
      if not pending then exit;end if;
      if changed=0 then idle_rounds:=idle_rounds+1;else idle_rounds:=0;end if;
      if idle_rounds>600 then raise exception '${table}: eligible rows remain locked; resume later';end if;
      perform pg_sleep(0.075);
    end if;
  end loop;`
    })
    .join('\n')
  chunks.push(`
-- Creates a session-local procedure only; no permanent helper or exposed RPC.
set lock_timeout='2s';
create or replace procedure pg_temp.safe_platform_backfill()
language plpgsql as $safe_backfill$
declare changed integer; pending boolean; should_retry boolean; attempts integer; idle_rounds integer;
begin
${loops}
end $safe_backfill$;

set lock_timeout='2s';
set statement_timeout='30min';
-- SQL Editor: select ONLY this CALL and run it separately, outside BEGIN.
call pg_temp.safe_platform_backfill();
`)
  return chunks.join('\n') + '\n'
}

module.exports = {
  splitSql,
  buildPlan,
  installed,
  retry,
  transaction,
  runDdl,
  backfillSql,
  runBackfill,
  sleep,
  quoted,
  renderManual,
}
