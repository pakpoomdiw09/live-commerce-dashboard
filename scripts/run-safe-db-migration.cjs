#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const {
  buildPlan,
  renderManual,
  retry,
  runDdl,
  runBackfill,
} = require('./lib/safe-db-migration.cjs')
const root = path.resolve(__dirname, '..')

function argument(args, name, fallback) {
  return args.find((value) => value.startsWith(name + '='))?.slice(name.length + 1) ?? fallback
}
function integer(value, min, max, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max)
    throw Error(`Invalid ${name}: expected ${min}..${max}`)
  return Number(value)
}
function connectionConfig(env) {
  const raw = env.DIRECT_URL || env.DATABASE_URL
  if (!raw)
    throw Error(
      'Missing DIRECT_URL or DATABASE_URL. Copy scripts/migration.env.example to .env.migration.local and fill the PostgreSQL URL, then use --env-file=.env.migration.local',
    )
  let url
  try {
    url = new URL(raw)
  } catch {
    throw Error('Invalid PostgreSQL connection URL (value hidden)')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw Error('Use a PostgreSQL URL; a Supabase API URL/service-role key cannot execute DDL')
  if (
    (url.hostname.endsWith('.pooler.supabase.com') && url.port === '6543') ||
    url.searchParams.get('pgbouncer') === 'true'
  )
    throw Error(
      'Use Supabase Direct Connection or Session Pooler port 5432, not Transaction Pooler port 6543',
    )
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const sslmode = url.searchParams.get('sslmode') || env.PGSSLMODE
  if (!local && sslmode === 'disable') throw Error('Remote migrations require verified TLS')
  if (url.searchParams.has('sslcert') || url.searchParams.has('sslkey'))
    throw Error(
      'Client-certificate URLs require a separately configured pg client; not supported by this runner',
    )
  const caPath = env.SAFE_MIGRATION_CA_FILE || url.searchParams.get('sslrootcert')
  for (const key of ['ssl', 'sslmode', 'sslrootcert', 'uselibpqcompat'])
    url.searchParams.delete(key)
  return {
    connectionString: url.toString(),
    ssl:
      local && sslmode === 'disable'
        ? false
        : {
            rejectUnauthorized: true,
            ...(caPath ? { ca: fs.readFileSync(path.resolve(root, caPath), 'utf8') } : {}),
          },
    connectionTimeoutMillis: 10000,
    application_name: 'safe-db-migration',
  }
}

async function main(args = process.argv.slice(2)) {
  const allowed =
    /^(--apply|--dry-run|--write-sql|--help|--env-file=.+|--batch-size=\d+|--pause-ms=\d+|--max-retries=\d+)$/
  if (args.some((arg) => !allowed.test(arg))) throw Error('Unknown argument; run --help')
  if (args.includes('--apply') && (args.includes('--dry-run') || args.includes('--write-sql')))
    throw Error('--apply cannot be combined with --dry-run/--write-sql')
  if (args.includes('--help')) {
    console.log(
      'Default: dry-run. Options: --apply --env-file=PATH --batch-size=200 --pause-ms=75 --max-retries=20 (0=unlimited lock retries); --write-sql generates the manual SQL file.',
    )
    return
  }
  const batchSize = integer(argument(args, '--batch-size', 200), 1, 1000, 'batch size')
  const pauseMs = integer(argument(args, '--pause-ms', 75), 50, 100, 'pause')
  const maxRetries = integer(argument(args, '--max-retries', 20), 0, 10000, 'max retries')
  if (typeof process.loadEnvFile !== 'function')
    throw Error('This runner requires Node.js 20.12+ (Node.js 22/24 supported)')
  if (fs.existsSync(path.join(root, '.env.local')))
    process.loadEnvFile(path.join(root, '.env.local'))
  const envFile = argument(args, '--env-file', '')
  if (envFile) {
    const { parseEnv } = require('node:util')
    if (!parseEnv) throw Error('This runner requires Node.js 20.12+ to read environment files')
    const explicit = parseEnv(fs.readFileSync(path.resolve(root, envFile), 'utf8'))
    // An explicit migration file wins over a different URL in .env.local.
    if (explicit.DIRECT_URL || explicit.DATABASE_URL) {
      delete process.env.DIRECT_URL
      delete process.env.DATABASE_URL
    }
    for (const name of ['DIRECT_URL', 'DATABASE_URL', 'SAFE_MIGRATION_CA_FILE', 'PGSSLMODE'])
      if (Object.hasOwn(explicit, name)) process.env[name] = explicit[name]
  }
  const plan = buildPlan(root)
  if (args.includes('--write-sql')) {
    fs.writeFileSync(path.join(root, 'supabase/safe_full_setup.sql'), renderManual(plan))
    console.log('Generated supabase/safe_full_setup.sql; no database connection opened.')
    return
  }
  console.log(
    `Connection: DIRECT_URL ${process.env.DIRECT_URL ? 'configured' : 'absent'}; DATABASE_URL ${process.env.DATABASE_URL ? 'configured' : 'absent'} (values hidden)`,
  )
  const config =
    process.env.DIRECT_URL || process.env.DATABASE_URL ? connectionConfig(process.env) : null
  if (config) {
    const target = new URL(config.connectionString)
    console.log(
      `Target: ${target.hostname}:${target.port || '5432'}${target.pathname} (credentials hidden)`,
    )
  }
  for (const step of [1, 2])
    console.log(
      `Step ${step}: ${plan.filter((item) => item.step === step).length} DDL operations, each with a separate commit; existing objects are skipped.`,
    )
  console.log(
    `Step 3: equivalent backfill_patch.sql mappings; ${batchSize} rows/transaction, ${pauseMs}ms pause after commit.`,
  )
  if (!args.includes('--apply')) {
    console.log('DRY RUN: no connection opened, no SQL executed. Add --apply to execute.')
    return
  }
  const { Client } = require('pg')
  const client = new Client(config || connectionConfig(process.env))
  let connected = false,
    stopped = false,
    interrupts = 0
  const stop = () => {
    stopped = true
    console.error(
      'Stopping after the current bounded operation; run again to resume. A second Ctrl+C disconnects immediately.',
    )
    if (++interrupts > 1) void client.end()
  }
  process.on('SIGINT', stop)
  const options = { maxRetries, stopped: () => stopped }
  try {
    await client.connect()
    connected = true
    await client.query(
      "set search_path=public,pg_catalog; set lock_timeout='3s'; set statement_timeout='60s'; set idle_in_transaction_session_timeout='15s'",
    )
    await retry(async () => {
      const lock = await client.query(
        "select pg_try_advisory_lock(hashtextextended('live-commerce:safe-platform-migration:v1',0)) acquired",
      )
      if (!lock.rows[0].acquired)
        throw Object.assign(Error('Another migration runner is active'), { code: '55P03' })
    }, options)
    for (const table of [
      'public.tenants',
      'public.customers',
      'public.slips',
      'public.messages',
      'public.comments',
      'public.comment_rules',
      'auth.users',
    ]) {
      const exists = await client.query('select to_regclass($1) is not null ok', [table])
      if (!exists.rows[0].ok)
        throw Error(`Prerequisite table missing: ${table}. Apply the base schema first.`)
    }
    for (const item of plan) {
      if (stopped) throw Object.assign(Error('Interrupted; resume later'), { code: 'INTERRUPTED' })
      console.log(`Step ${item.step}: checking ${item.kind} ${item.name}`)
      const result = await runDdl(client, item, {
        ...options,
        log: (message) => console.log(`Step ${item.step} ${item.name}: ${message}`),
      })
      console.log(`Step ${item.step}: ${result} ${item.kind} ${item.name}`)
    }
    for (const table of ['comments', 'comment_rules']) {
      let batches = 0
      const total = await runBackfill(client, table, {
        ...options,
        batchSize,
        pauseMs,
        log: (message) => console.log(`Step 3 ${table}: ${message}`),
        onBatch: ({ count, total }) => {
          if (++batches === 1 || batches % 10 === 0)
            console.log(`Step 3 ${table}: ${total} rows committed (${count} in last batch)`)
        },
      })
      console.log(
        `Step 3: ${table} updated ${total} rows; no eligible rows remain. Unmatched rows were preserved.`,
      )
    }
    console.log(
      'Migration completed. Existing quota functions/balances were not overwritten; no sessions were terminated.',
    )
  } finally {
    process.removeListener('SIGINT', stop)
    if (connected)
      try {
        await client.query(
          "select pg_advisory_unlock(hashtextextended('live-commerce:safe-platform-migration:v1',0))",
        )
      } catch {}
    await client.end().catch(() => {})
  }
}

if (require.main === module)
  main().catch((error) => {
    let message = String(error.message ?? 'Migration failed')
    for (const name of ['DIRECT_URL', 'DATABASE_URL']) {
      const secret = process.env[name]
      if (secret) {
        message = message.split(secret).join('[CONNECTION HIDDEN]')
        try {
          const password = decodeURIComponent(new URL(secret).password)
          if (password) message = message.split(password).join('[PASSWORD HIDDEN]')
        } catch {}
      }
    }
    console.error(
      `Migration stopped (${error.code ?? 'ERROR'}): ${message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[CONNECTION HIDDEN]')}`,
    )
    process.exitCode = error.code === 'INTERRUPTED' ? 130 : 1
  })
module.exports = { main, connectionConfig }
