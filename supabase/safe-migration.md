# Safe local platform migration

Use Node.js 20.12+ (22/24 supported). The preferred runner executes each DDL
statement and each backfill batch separately; previous committed work is resumable.
It never wraps the whole platform/schema/backfill in one transaction.

## Configure and run from PowerShell

```powershell
Copy-Item scripts/migration.env.example .env.migration.local
```

Edit **only your local `.env.migration.local`** and replace `DIRECT_URL` with the
PostgreSQL URL from Supabase's Direct Connection or **Session Pooler, port 5432**.
Use the actual database password, URL-encoding special characters. The service-role
API key and `https://...supabase.co` URL cannot execute DDL. Never put credentials in
a tracked SQL/script file or send them in chat. `.env*` files are already ignored.

Direct connections may require IPv6 connectivity; Session Pooler is the alternative
for networks without it. **Transaction Pooler on port 6543 is rejected**, because
the runner uses a session advisory lock and per-session settings. TLS certificate
verification stays enabled. If your server needs a custom CA, download the trusted
database CA and set `SAFE_MIGRATION_CA_FILE` to its local path; do not disable TLS
verification. `DIRECT_URL` is preferred over `DATABASE_URL`. An explicit `--env-file`
overrides connection variables from `.env.local`; the target hostname/database is
printed with credentials hidden, so inspect it in the preview first.

```powershell
# Preview only: no database connection, no writes.
npm run db:migrate:safe -- --env-file=.env.migration.local --dry-run

# Execute: short transactions, 200 rows per batch, 75ms pauses after COMMIT.
npm run db:migrate:safe -- --env-file=.env.migration.local --apply

# Optional: keep retrying transient lock/deadlock errors until Ctrl+C.
npm run db:migrate:safe -- --env-file=.env.migration.local --apply --max-retries=0
```

For a fresh checkout, `npm ci` installs the local `pg` driver from the lockfile.
No database connection was run automatically when these scripts were created.

## What is executed

1. Parse the current `platform.sql` into supported DDL operations, not naive `;`
   splitting (SQL function/DO bodies contain semicolons). Unknown statements stop
   planning before writes. Existing columns, valid indexes and quota functions
   are skipped **before requesting a table lock**. Existing Full Access function
   implementations and billing balances are preserved.
2. Parse `schema_patch.sql` for the comments/comment_rules tenant columns and
   indexes. For DDL, `lock_timeout=3s`, `statement_timeout=60s`, NOWAIT locks in
   deterministic table order, and one COMMIT per statement. Constraint creation
   uses NOT VALID followed by a separate validation transaction.
3. Execute the same matching rules as `backfill_patch.sql`, using real transactions
   of at most `--batch-size` rows (default 200, allowed 1–1000), ordered by primary
   key, `FOR UPDATE SKIP LOCKED`, and a 50–100ms configurable pause **after COMMIT**.
   Existing non-null tenant IDs and unmatched rows remain unchanged. A zero-row
   batch checks for still-locked eligible rows instead of falsely reporting done.

The original `backfill_patch.sql` loops inside DO blocks; sleeping or selecting a
small batch inside a DO block does **not** release its prior row locks. The Node
runner intentionally executes equivalent single-batch updates instead of sending
those long DO blocks to the database.

Deadlocks (40P01), lock timeouts (55P03), serialization failures (40001) and statement
timeouts (57014) roll back the affected transaction before exponential backoff with
jitter. Default is 20 retries; `--max-retries=0` removes that limit for transient
errors. Invalid schema, credentials, uniqueness/check/FK violations do not retry
blindly. After 600 empty-but-pending batches the runner stops for investigation;
rerun once the long-lived row locks have cleared. Ctrl+C stops after the current
bounded operation; a second Ctrl+C disconnects, rolling back its open transaction.

Indexes are built CONCURRENTLY outside BEGIN. A failed build may leave an invalid
index. The runner only cleans up an invalid index OID left by **its own** failed
creation when no build is active, then retries; it refuses to remove a pre-existing
invalid index or an index whose identity changed. Inspect/rebuild those separately.
No sessions are killed, replication disabled, RLS disabled, or existing rows deleted.

This improves resilience but cannot guarantee 100% completion under permanent locks,
missing base tables, invalid data, unavailable networking or insufficient privileges.
Already committed work is safe to resume; an all-or-nothing rollback is intentionally
not provided for this sequence of short transactions.

## Manual SQL alternative

`supabase/safe_full_setup.sql` is generated from the same plan. It has a separate
BEGIN/COMMIT for each DDL operation with `lock_timeout=2s`, ordinary
`CREATE INDEX IF NOT EXISTS` commands compatible with SQL Editor transactions,
and a **session-local procedure** that commits every backfill batch. Ordinary
index creation can block writes while building; the Node runner still builds
indexes concurrently outside transactions.

Run the complete file using `psql -X -v ON_ERROR_STOP=1 -f supabase/safe_full_setup.sql`
with your normal PostgreSQL connection environment. **Do not use `psql -1` or
`--single-transaction`.** The manual DDL commands do not provide Node's retry loop.

In Supabase SQL Editor, the transaction-controlling final CALL cannot
be treated as part of an enclosing transaction/request. Run the structural commands as
separate executions, then select and run **only** the final `CALL` in the same
session, outside BEGIN. Session-local helpers also require that session to persist;
use the Node runner or psql for reliable one-shot execution. Pasting the whole file
into one SQL Editor Run is not a supported workaround for database transaction rules.

Regenerate the SQL after editing its source migrations:

```powershell
npm run db:migrate:sql
npm run test:db-migration
```

Tests execute real SQL using isolated PGlite/PostgreSQL, including repeated DDL,
concurrent indexes, per-batch commits, preserved functions and manual CALLs; injected
deadlocks verify rollback-before-backoff. They never load production credentials.
