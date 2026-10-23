# Safe platform migration

Run the migration as three separate SQL Editor executions, in order:

1. `platform.sql` for the remaining platform columns and functions.
2. `schema_patch.sql` for the `comments` and `comment_rules` tenant columns and indexes.
3. `backfill_patch.sql` for data updates only, after step 2 succeeds.

Do not paste all three files into one SQL Editor run. A PostgreSQL DDL lock is retained until its transaction ends; separate executions let the short schema patch commit before the backfill starts. Both patches set `lock_timeout` to five seconds so blocked DDL or DML fails promptly instead of building a long lock queue. If a lock timeout occurs, allow active dashboard requests to finish and rerun that patch.

The backfill uses `FOR UPDATE SKIP LOCKED`, processes at most 500 rows per loop in stable primary-key order, and waits 50 ms between loops. It does not request an `ACCESS EXCLUSIVE` lock; ordinary reads remain compatible with its `ROW EXCLUSIVE` update lock. Rows that do not match any tenant remain unchanged. Existing non-null `tenant_id` values are preserved.

The Supabase `service_role` key authenticates API calls; it is not a PostgreSQL password and cannot execute arbitrary DDL through PostgREST. For this deployment, run these SQL files through the Supabase SQL Editor. A CLI migration runner would require a database connection string or a Supabase Management API access token instead.

Run the local SQL regression check with:

```sh
node scripts/test-platform-migration.cjs
```
