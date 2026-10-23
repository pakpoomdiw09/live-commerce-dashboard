const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { splitSql } = require('./lib/safe-db-migration.cjs')

// Explicit order: do not sort migrations alphabetically or include operational scripts.
const groups = [
  [
    'Core schema and initial tenant security',
    [
      'schema.sql',
      'tenants.sql',
      'comment-rules.sql',
      'platform.sql',
      'schema_patch.sql',
      'orders.sql',
      'automation.sql',
      'billing.sql',
      'security.sql',
    ],
  ],
  [
    'Facebook, billing, bank accounts and feature security',
    [
      'facebook-connect.sql',
      'facebook-tenants.sql',
      'facebook-multi-admin.sql',
      'customer-profiles.sql',
      'customer-gender.sql',
      'payments.sql',
      'ai-agent-gate.sql',
      'admin-feature-bypass.sql',
      'billing-slip-topups.sql',
      'platform-dashboard.sql',
      'platform-admin-db-only.sql',
      'billing-auto-approval.sql',
      'bank-accounts.sql',
      'image-response-rules.sql',
      'followup-plan-gate.sql',
      'package-access.sql',
      'feature-access.sql',
      'free-message-quota.sql',
      'keyword-reply-limits.sql',
      'fallback-messages.sql',
      'handover-messages.sql',
      'followup-message-defaults.sql',
    ],
  ],
  [
    'Inbox, automation and commerce functions/triggers',
    [
      'smart-inbox.sql',
      'smart-inbox-pro.sql',
      'smart-inbox-v2.sql',
      'inbox-follow-up-flags.sql',
      'inbox-quick-replies.sql',
      'inbox-actions.sql',
      'automation-safety.sql',
      'smart-follow-ups.sql',
      'agent-control.sql',
      'agent-overview.sql',
      'ai-paid-access.sql',
      'ai-vision.sql',
      'commerce-v2.sql',
      'product-sku-reuse.sql',
      'payment-pro.sql',
      'payment-pro-dashboard.sql',
      'slip-bank-controls.sql',
      'bank-registry.sql',
      'payment-receiving-codes.sql',
      'qr-payment-designer.sql',
      'store-rules.sql',
      'store-rule-items.sql',
      'store-rules-validation.sql',
    ],
  ],
  [
    'Latest delivery safety, reporting and index patches',
    [
      'facebook-webhook-queue.sql',
      'facebook-webhook-nonblocking.sql',
      'facebook-message-window.sql',
      'broadcast-policy.sql',
      'broadcast-recipient-eligibility.sql',
      'broadcast-recipient-selection.sql',
      'broadcast-inbound-sync.sql',
      'inbox-messenger-window.sql',
      'smart-follow-up-presend.sql',
      'manual-follow-ups.sql',
      'follow-up-simplified.sql',
      'follow-up-step-settings.sql',
      'dashboard-performance.sql',
      'dashboard-read-models.sql',
      'premium-overview.sql',
      'inbox-realtime.sql',
      'inbox-load-indexes.sql',
    ],
  ],
]

const excluded = {
  'backfill_patch.sql':
    'Historical customer/comment ownership backfill; not needed on an empty database.',
  'migrate-followup-variables.sql':
    'Historical message/template rewrite and explicit exclusive lock; current defaults are included separately.',
  'safe_full_setup.sql':
    'Alternative upgrade/backfill runner output; duplicates platform/schema patches. Not a fresh install.',
  'reset-facebook-tenants.sql': 'Destructive operational reset: deletes tenants.',
  'test-grant-ai-pro-diw.sql':
    'Shop-specific QA grant and fabricated test entitlement; never bootstrap data.',
  'agent-control-rollback.sql': 'Operational rollback; disables features.',
  'payment-pro-rollback.sql': 'Operational rollback; disables payment Pro.',
  'full-access.sql':
    'Optional temporary package bypass; apply separately only when deliberately requested.',
  'full-access-rollback.sql':
    'Restores saved production function definitions; not a fresh install.',
  'full-access-check.sql': 'Read-only verification for the optional temporary bypass.',
  'dashboard-read-models-check.sql': 'Read-only verification; run separately after setup.',
  'facebook-tenants-check.sql': 'Read-only verification; run separately after setup.',
  'inbox-actions-check.sql': 'Read-only verification; run separately after setup.',
  'inbox-delivery-diagnostics.sql': 'Read-only operational diagnostics, not schema.',
  'inbox-request-diagnostics.sql': 'Read-only operational diagnostics, not schema.',
  'follow-up-worker-diagnostics.sql': 'Read-only runtime/scheduler diagnostics, not schema.',
  'realtime-cpu-diagnostics.sql': 'Read-only runtime performance diagnostics, not schema.',
}

// Only these reviewed setup INSERTs are retained. Never remove DML inside a
// function: that is application behavior, not an installation-time backfill.
const setupTables = new Set([
  'storage.buckets',
  'public.plan_features',
  'public.vision_plan_limits',
  'public.commerce_limits',
])

function omission(file, sql) {
  if (/^(begin|commit)$/i.test(sql))
    return 'Transaction boundary replaced by a bounded per-source transaction.'
  if (/^(set|reset)\s+lock_timeout\b/i.test(sql))
    return 'Bundle supplies SET LOCAL lock_timeout for every section.'
  if (/^lock\s+table\b/i.test(sql))
    return 'Explicit table lock for historical migration removed (fresh database only).'
  if (/^(update|delete|with)\b/i.test(sql) && !/^update\s+storage\.buckets\b/i.test(sql)) {
    return 'Historical business-data backfill/repair removed.'
  }
  if (/^insert\s+into\b/i.test(sql)) {
    const table = sql.match(/^insert\s+into\s+([\w.]+)/i)?.[1]
    if (!setupTables.has(table.includes('.') ? table : `public.${table}`)) {
      return 'Historical business-data/settings/ledger backfill removed.'
    }
  }
  if (/^do\b/i.test(sql)) {
    if (['fallback-messages.sql', 'handover-messages.sql'].includes(file)) {
      return 'Legacy text backfill and temporary trigger disable removed.'
    }
    if (file === 'payments.sql' && sql.includes('Existing transfers conflict')) {
      return 'Historical ledger conflict scan removed; permanent runtime proof guards retained.'
    }
    if (file === 'billing-auto-approval.sql' && sql.includes('Existing image proof conflicts')) {
      return 'Historical image-ledger conflict scan removed; permanent runtime proof guards retained.'
    }
  }
  if (file === 'product-sku-reuse.sql') {
    return 'Final partial SKU index is already defined by commerce-v2.sql; avoid drop/rebuild/lock.'
  }
  return null
}

function build(root = path.resolve(__dirname, '..')) {
  const folder = path.join(root, 'supabase')
  const sources = groups.flatMap(([, files]) => files)
  const files = fs
    .readdirSync(folder, { recursive: true })
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f !== 'full_database_setup.sql')
    .sort()
  const unclassified = files.filter((f) => !sources.includes(f) && !(f in excluded))
  if (unclassified.length)
    throw Error('Review new SQL files before bundling: ' + unclassified.join(', '))
  if (new Set(sources).size !== sources.length) throw Error('Duplicate source in dependency order')
  for (const file of [...sources, ...Object.keys(excluded)]) {
    if (!files.includes(file)) throw Error('Missing inventoried SQL source: ' + file)
  }
  const sections = sources.map((file) => {
    const source = fs.readFileSync(path.join(folder, file), 'utf8')
    return {
      file,
      sha256: crypto.createHash('sha256').update(source).digest('hex'),
      statements: splitSql(source).map((sql, i) => ({
        number: i + 1,
        sql,
        omitted: omission(file, sql),
      })),
    }
  })
  const guard = `do $fresh_database_only$
declare existing text;
begin
  if to_regclass('auth.users') is null or to_regclass('storage.buckets') is null
    or to_regclass('storage.objects') is null
    or not exists(select 1 from pg_publication where pubname='supabase_realtime')
    or (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'Supabase platform prerequisites missing (auth/storage/roles/Realtime). No application DDL has run.';
  end if;
  select string_agg(name, ', ' order by name) into existing
  from (values ${sections
    .flatMap((s) => s.statements)
    .filter((s) => /^create table if not exists\b/i.test(s.sql))
    .map((s) => s.sql.match(/^create table if not exists\s+([\w.]+)/i)[1])
    .map((name) => (name.includes('.') ? name : 'public.' + name))
    .filter((name, i, all) => all.indexOf(name) === i)
    .map((name) => `('${name}')`)
    .join(',\n    ')}) expected(name)
  where to_regclass(name) is not null;
  if existing is not null then
    raise exception 'Fresh database only. Existing application tables: %', existing
      using hint = 'Do not use this bundle as a production upgrade or rerun after a partial install. Use individual migrations.';
  end if;
end $fresh_database_only$;`
  const sql = [
    '-- GENERATED: node scripts/build-full-database-setup.cjs',
    '-- Target: a NEW Supabase database only; run as postgres before connecting the app.',
    '-- Not a production upgrade and not a restore/backup. Guard refuses existing application tables.',
    '-- Keep required storage/plan lookup seeds; omit tenant/customer/message/ledger backfills.',
    '-- Runtime function DML, authorization and proof/idempotency guards are intentionally retained.',
    '-- Temporary Full Access is excluded. See full_database_setup-manifest.md for every input/exclusion.',
    '-- Source order follows dependencies; security helpers must exist before later policies/functions.',
    '-- No global BEGIN/COMMIT, explicit LOCK TABLE, trigger-disable backfill or historical data scans.',
    '-- Each source uses its own transaction with lock_timeout=2s; DDL still acquires PostgreSQL locks.',
    '-- Prerequisites: Supabase auth/storage schemas, anon/authenticated/service_role, supabase_realtime.',
    '-- For psql: psql -X -v ON_ERROR_STOP=1 "$DIRECT_URL" -f supabase/full_database_setup.sql',
    '',
    guard,
    '',
    ...sections.map((section, i) => {
      const group = groups.find(([, items]) => items.includes(section.file))[0]
      const body = section.statements
        .filter((s) => !s.omitted)
        .map((s) => `-- Source statement ${s.number}\n${s.sql};`)
        .join('\n\n')
      return `-- ============================================================================
-- ${String(i + 1).padStart(2, '0')}. ${section.file} | ${group}
-- SHA256: ${section.sha256}
-- ============================================================================
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
set local search_path = public, extensions;

${body || '-- No additional statements: current schema already contains this patch.'}

commit;`
    }),
    '',
    "notify pgrst, 'reload schema';",
    '',
  ].join('\n')
  return { sql, sections, sources, files }
}

function manifest(result) {
  const removed = result.sections.flatMap((s) =>
    s.statements
      .filter((q) => q.omitted && !/^(begin|commit|set|reset)\b/i.test(q.sql))
      .map((q) => [s.file, q]),
  )
  return `# Fresh Supabase database setup inventory

พบ SQL ต้นฉบับ ${result.files.length} ไฟล์: รวมตาม dependencies ${result.sources.length} ไฟล์ และแยกไว้ ${Object.keys(excluded).length} ไฟล์
หลังสร้างไฟล์รวมจะมี SQL ทั้งหมด ${result.files.length + 1} ไฟล์ รวม full_database_setup.sql ด้วย

ไฟล์เต็ม: [full_database_setup.sql](full_database_setup.sql) (${Buffer.byteLength(result.sql)} bytes, ${result.sql.split('\n').length} lines)
ไฟล์นี้เป็น schema/bootstrap สำหรับ Supabase **ใหม่เท่านั้น** ไม่ใช่ไฟล์อัปเกรด Production หรือสำรองข้อมูล
มี guard หยุดก่อนแก้ไขหากพบตารางแอปเดิม ไม่ลบตารางเดิมเพื่อให้รันต่อ

คง Functions, Triggers, RLS, Storage และ seed ตารางแพ็กเกจ/ข้อจำกัดที่จำเป็นต่อการทำงาน
จึงไม่ได้เป็น DDL ล้วน: INSERT ค่า config ที่จำเป็นยังอยู่ แต่ไม่มีข้อมูลทดสอบ/ลูกค้าเก่าหรือ backfill บัญชี/เครดิต/ledger
คำสั่ง UPDATE/DELETE ภายใน function เป็นพฤติกรรม runtime จึงคงไว้ ไม่ได้เรียกระหว่าง setup
admin-feature-bypass.sql เป็น migration เดิมของสิทธิ์ platform admin; feature-access/ai-paid-access ใช้ตามหลังเพื่อให้ได้สิทธิ์รุ่นล่าสุด
full-access.sql เป็นตัวเลือกชั่วคราวแยกต่างหาก ไม่เปิด Full Access หรือเปิดระบบส่งข้อความอัตโนมัติจากไฟล์รวมนี้

แก้ premium-overview.sql ให้อ่าน unread_count แบบ optional เช่นเดียวกับ dashboard-performance.sql
เพราะ schema ปัจจุบันไม่มีคอลัมน์ customers.unread_count; ฐานเก่าที่มีคอลัมน์ยังอ่านค่าเดิมได้ ฐานใหม่ใช้ 0

## ลำดับไฟล์ที่รวม (อ่านตามลำดับ ห้ามเรียงตัวอักษร)

${groups
  .map(
    ([title, files]) =>
      `### ${title}\n\n` +
      files
        .map((file) => {
          const s = result.sections.find((s) => s.file === file)
          return `${result.sources.indexOf(file) + 1}. [${file}](${file}) — ${s.statements.filter((q) => !q.omitted).length} statements retained`
        })
        .join('\n'),
  )
  .join('\n\n')}

## ไฟล์ที่แยกออกทั้งหมด (ไม่ใช่ขั้นตอนติดตั้งใหม่)

| File | Reason |
| --- | --- |
${Object.entries(excluded)
  .map(([file, reason]) => `| [${file}](${file}) | ${reason} |`)
  .join('\n')}

## ท่อนที่ตัดจากไฟล์ต้นฉบับ

เลข statement นับจาก SQL parser (ไม่นับ comment; DO/function body นับเป็นหนึ่ง statement)
BEGIN/COMMIT และ lock_timeout ของต้นฉบับถูกแทนด้วย transaction รายไฟล์และ SET LOCAL lock_timeout='2s'

| Source | Statement | Omission |
| --- | --- | --- |
${removed.map(([file, q]) => `| ${file} | ${q.number}: \`${q.sql.slice(0, 80).replace(/\s+/g, ' ').replaceAll('|', '/')}…\` | ${q.omitted} |`).join('\n')}

## วิธีใช้งานและขอบเขต

1. สร้าง Supabase project ใหม่; ตรวจว่า auth/storage และ publication supabase_realtime มีอยู่แล้ว
2. เปิด full_database_setup.sql **ทั้งไฟล์** ใน SQL Editor และรันด้วย postgres ก่อนเชื่อม Dashboard/Webhook
3. หรือใช้ psql -X -v ON_ERROR_STOP=1 -f supabase/full_database_setup.sql โดยรับ connection string ผ่าน environment ตามเครื่องมือของคุณ ห้ามใช้ --single-transaction/-1
4. แต่ละ source มี transaction แยกและ lock_timeout 2s ไม่มี BEGIN/COMMIT ครอบทั้งไฟล์
5. หาก fail ระหว่าง setup ให้ตรวจ section/statement ที่ล้มเหลวก่อน อย่าลบ guard หรือรันซ้ำทับฐานข้อมูลที่เริ่มมีข้อมูล
6. รันไฟล์ *-check.sql ที่เกี่ยวข้องแยกได้หลัง setup; diagnostics/rollback/reset ไม่ใช่ migration ต่อท้าย
7. ตั้งค่า user, tenant, membership, bank/Page credentials และเปิด automation ตามต้องการแยกภายหลัง

DDL และ CREATE INDEX ยังต้องล็อกตาม PostgreSQL จึงไม่รับประกันว่า deadlock จะเป็นไปไม่ได้
สำหรับฐานข้อมูลที่ใช้งานแล้วให้ใช้ migration เฉพาะเรื่องหรือ scripts/run-safe-db-migration.cjs แทน
อ้างอิง: [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/16/sql-createindex.html)

สร้างใหม่: node scripts/build-full-database-setup.cjs
ตรวจสอบโดยไม่เขียน: node scripts/build-full-database-setup.cjs --check
ทดสอบ isolated database: node --test scripts/test-full-database-setup.cjs

## Source hashes

${result.sections.map((s) => `- ${s.file}: \`${s.sha256}\``).join('\n')}
`
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..')
  const result = build(root)
  const outputs = [
    ['supabase/full_database_setup.sql', result.sql],
    ['supabase/full_database_setup-manifest.md', manifest(result)],
  ]
  for (const [file, content] of outputs) {
    const target = path.join(root, file)
    if (process.argv.includes('--check')) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content)
        throw Error('Stale generated file: ' + file)
    } else fs.writeFileSync(target, content)
  }
  console.log(
    `${result.files.length} sources: ${result.sources.length} included, ${Object.keys(excluded).length} excluded. ${Buffer.byteLength(result.sql)} bytes.`,
  )
}

module.exports = { build, groups, excluded, omission, manifest }
