const crypto = require('node:crypto')

// Object identity is needed only to recognize superseded function definitions.
// Never swallow an incompatible FINAL definition or an arbitrary SQL error.
function functionIdentity(sql) {
  const match = sql.match(
    /^create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns\b/i,
  )
  if (!match) return null
  const args = []
  let start = 0,
    depth = 0,
    quoted = false
  const input = match[2]
  for (let i = 0; i <= input.length; i++) {
    if (input[i] === "'") {
      if (quoted && input[i + 1] === "'") {
        i++
        continue
      }
      quoted = !quoted
    }
    if (!quoted) {
      if (input[i] === '(') depth++
      if (input[i] === ')') depth--
      if ((input[i] === ',' && depth === 0) || i === input.length) {
        let arg = input
          .slice(start, i)
          .trim()
          .replace(/\s+(?:default\b|=)[\s\S]*$/i, '')
        start = i + 1
        if (!arg || /^out\b/i.test(arg)) continue
        arg = arg.replace(/^(?:inout|in|variadic)\s+/i, '')
        const words = arg.split(/\s+/)
        // Repository definitions use named arguments or a single unnamed type.
        if (words.length > 1) words.shift()
        args.push(
          words
            .join(' ')
            .toLowerCase()
            .replace(/\(\d+(?:\s*,\s*\d+)?\)/g, ''),
        )
      }
    }
  }
  const name = match[1].toLowerCase().replace(/^public\./, '')
  return `${name}(${args.join(',')})`
}

function completeOmission(file, statement) {
  const sql = statement.sql
  // These are integrity backfills, not configuration resets or automatic jobs.
  if (
    ['payments.sql', 'billing-auto-approval.sql', 'standalone-slips.sql'].includes(file) &&
    (/^insert into public\.payment_(?:transfer|image)_ledger\b/i.test(sql) ||
      (/^do\b/i.test(sql) &&
        /Existing (?:transfers|image proof|standalone transfers) conflict/.test(sql)))
  )
    return null
  if (
    file === 'tenant-ai-quota.sql' &&
    /^update public\.tenants set ai_quota_limit=coalesce/i.test(sql)
  )
    return null
  return statement.omitted
}

function dollar(value, tag) {
  while (value.includes(`$${tag}$`)) tag += '_'
  return `$${tag}$${value}$${tag}$`
}

function completeSchema(result) {
  const statements = result.sections.flatMap((section) =>
    section.statements.map((q) => ({ ...q, file: section.file })),
  )
  const lastDefinition = new Map()
  const sourceConstraints = new Map()
  const sourceConstraintIdentity = (sql) => {
    const match = sql.match(
      /^alter table\s+([\w.]+)\s+add constraint\s+(\w+)\s+check\s*\(source\s+in\s*\(/i,
    )
    return match ? `${match[1].replace(/^public\./, '')}.${match[2]}` : null
  }
  statements.forEach((q, index) => {
    const identity = functionIdentity(q.sql)
    if (identity) lastDefinition.set(identity, index)
    const constraint = sourceConstraintIdentity(q.sql)
    if (constraint) sourceConstraints.set(constraint, q.sql)
  })
  let index = 0
  const sections = result.sections.map((section, sectionIndex) => {
    const commands = []
    const effectiveSql = []
    for (const statement of section.statements) {
      const statementIndex = index++
      if (completeOmission(section.file, statement)) continue
      effectiveSql.push(statement.sql)
      // Older ledger vocabularies must not reject rows introduced by a later migration.
      const sql = sourceConstraints.get(sourceConstraintIdentity(statement.sql)) ?? statement.sql
      const execute = `execute ${dollar(sql, `sql_${sectionIndex}_${statement.number}`)};`
      const identity = functionIdentity(statement.sql)
      commands.push(
        `-- ${section.file}: source statement ${statement.number}\n` +
          (identity && lastDefinition.get(identity) > statementIndex
            ? `begin\n${execute}\nexception when invalid_function_definition then\n  -- A newer signature of ${identity} is already installed. Its final definition below is mandatory.\n  null;\nend;`
            : execute),
      )
    }
    // A later migration may replace a function without changing this source's identity.
    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify({ format: 1, source: section.sha256, statements: effectiveSql }))
      .digest('hex')
    return `-- ${String(sectionIndex + 1).padStart(2, '0')}. ${section.file}\ndo $migration_${sectionIndex}$
declare installed text;
begin
  select checksum into installed from public.snapbot_schema_migrations where name='${section.file}';
  if found then
    if installed <> '${checksum}' then
      raise exception 'Applied migration changed: ${section.file}. Add a new migration instead of replaying modified history';
    end if;
    return;
  end if;
${commands.join('\n\n')}
  insert into public.snapbot_schema_migrations(name,checksum,source_sha256)
    values('${section.file}','${checksum}','${section.sha256}');
end $migration_${sectionIndex}$;`
  })
  return [
    '-- GENERATED: node scripts/build-full-database-setup.cjs',
    '-- COMPLETE SCHEMA: run this entire file once in Supabase SQL Editor as postgres.',
    '-- Atomic install/upgrade. Re-running an unchanged bundle skips applied migrations.',
    '-- Every real migration is ordered by the shared registry; diagnostics/reset/rollback/QA are excluded.',
    '-- Preserves application rows, custom settings, credits and proof ledgers; does not send messages.',
    '-- Historical job/config backfills are omitted. Proof-ledger integrity backfills are retained.',
    '-- Supabase-managed auth/storage/roles/Realtime must already exist.',
    'begin;',
    "set local lock_timeout='5s';",
    "set local statement_timeout='120s';",
    'set local search_path=public,extensions;',
    'select pg_advisory_xact_lock(1397637456,1);',
    `do $platform_prerequisites$ begin
  if to_regclass('auth.users') is null or to_regclass('storage.buckets') is null
    or to_regclass('storage.objects') is null
    or not exists(select 1 from pg_publication where pubname='supabase_realtime')
    or (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'Supabase platform prerequisites missing (auth/storage/roles/Realtime). No application DDL has run';
  end if;
end $platform_prerequisites$;`,
    `create table if not exists public.snapbot_schema_migrations(
  name text primary key, checksum text not null check(checksum~'^[0-9a-f]{64}$'),
  source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),
  applied_at timestamptz not null default clock_timestamp()
);`,
    'alter table public.snapbot_schema_migrations enable row level security;',
    'revoke all on public.snapbot_schema_migrations from public,anon,authenticated,service_role;',
    'grant select on public.snapbot_schema_migrations to service_role;',
    ...sections,
    "notify pgrst,'reload schema';",
    'commit;',
    '',
  ].join('\n\n')
}

module.exports = { completeSchema, completeOmission, functionIdentity }
