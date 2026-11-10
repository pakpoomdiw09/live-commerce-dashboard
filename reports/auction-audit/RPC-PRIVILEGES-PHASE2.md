# RPC Privilege Hardening — Phase 2

## Final remediation and catalog alignment ? 2026-11-09

This addendum supersedes final-state signature counts and test results in the historical report below. The original 185-signature test run is retained as historical evidence. The approved final migration restricts 138 signatures: 134 previously retained restricted signatures plus the four approved trigger-function exceptions. The other 47 trigger functions remain excluded.

The local PGlite after-catalog and analysis were regenerated from the final migration. The targeted final run is recorded verbatim in [rpc-privilege-tests-final.log](./rpc-privilege-tests-final.log). It passed all five privilege tests, including 138/138 denial checks for both browser roles and the 314-function SECURITY DEFINER allow-list regression. No file matching .env* was read or loaded, and no remote connection was made.

The generated setup bundles were regenerated from the migration registry. `node scripts/build-full-database-setup.cjs --check` passes with 143 SQL sources, 125 included, 18 excluded, and a 1,249,045-byte `complete_schema.sql`.

## Scope and evidence

All catalog snapshots and privilege tests used isolated local PGlite databases. The `before.json` snapshot was captured before adding the new migration; `after.json` was captured from the fully migrated schema. No hosted DDL/DML, deployment, or Meta request was made. However, one unrelated operational script in the broader runner loaded `.env.local` and made a service-role Supabase read. The remote tenant lookup returned a result that failed the script's “exactly one active shop” check; no tenant ID or query result was printed. The previous wording that this failed “at fetch before returning data” was inaccurate. There was no network guard or isolation harness around that run.

The exact `pg_proc` outputs are [before.json](./rpc-privileges/before.json) and [after.json](./rpc-privileges/after.json). Supplemental owner, default-ACL, RLS-policy, and function-call metadata is in [before-analysis.json](./rpc-privileges/before-analysis.json) and [after-analysis.json](./rpc-privileges/after-analysis.json).

## Catalog findings

- The bootstrap check passed: `anon`, `authenticated`, and `service_role` all had `USAGE` on `public` before privilege testing.
- The pre-migration snapshot had 314 public functions, including 87 `SECURITY DEFINER` functions. Nine `SECURITY DEFINER` functions were executable by `anon` or `authenticated`: five Group C helpers and four trigger functions (`cancel_paid_follow_ups`, `commerce_product_quota`, `on_order_status`, and `schedule_follow_ups`). The four trigger functions were included in the restricted set.
- The auction pipeline signatures were present and already had effective `service_role` EXECUTE in `before.json`; `anon` and `authenticated` were denied. The earlier sentence saying that these functions lacked `service_role` execution was incorrect. This result comes from `has_function_privilege('service_role', p.oid, 'EXECUTE')`, so role membership inheritance from `postgres` is not the explanation. The source migrations also contain explicit service-role grants. The hosted database was not queried in this task.
- After migration, the only `SECURITY DEFINER` functions still executable by `authenticated` are the five Group C signatures. None is executable by `anon`. The auction processing, finalizer, and expiry signatures are service-role executable only.

## Migration and function classification

[rpc-execution-hardening.sql](../../supabase/rpc-execution-hardening.sql) is the new final source migration. The 185 entries were generated from the local catalog as the union of 82 non-Group-C `SECURITY DEFINER` signatures and 123 non-Group-C signatures with an input named `p_actor` or `p_tenant`, with 20 signatures in both sets: 82 + 123 - 20 = 185. This is not the same as “all Phase 1 Group A/B/D targets.”

Reconciliation against the Phase 1 target lists gives Group A 26 signatures (including `place_cf_order` overloads), Group B 4, Group D Tier 1 24, and Group D Tier 2 7: 61 named target signatures total. The migration includes 26 Group A, 4 Group B, 14 Group D Tier 1, and all 7 Group D Tier 2 signatures (51 total). It omits these 10 Group D Tier 1 signatures because they are neither `SECURITY DEFINER` nor named with `p_actor`/`p_tenant`: `begin_facebook_webhook_step(uuid,uuid,text)`, `claim_auction_bill_delivery(uuid,bigint)`, `claim_customer_tab_slip(uuid,uuid,text,text,uuid)`, `claim_facebook_webhook(integer)`, `complete_facebook_webhook_step(uuid,uuid,text,jsonb)`, `enqueue_facebook_webhook(text,text,jsonb)`, `finish_facebook_webhook(uuid,uuid,text,text)`, `heartbeat_facebook_webhook(uuid,uuid)`, `refresh_customer_tab(uuid)`, and `submit_auction_payment_proof(uuid,text)`. Therefore 185 is 51 Phase 1 named targets plus 134 other catalog entries, while 10 named Tier 1 targets remain outside this migration.

Those 134 additional entries consist of 52 non-Group-C `SECURITY DEFINER` signatures and 82 identity-parameter signatures outside the Phase 1 target names. Fifty of the additional `SECURITY DEFINER` entries are trigger functions. Their inclusion also conflicts with the Phase 1 instruction not to revoke trigger functions. The migration itself contains no `DROP FUNCTION` or function definition. These scope mismatches are recorded here rather than represented as a complete Phase 1 group mapping.

Group C preserves `EXECUTE` for `authenticated` and `service_role` on:

- `can_access_tenant(uuid)`
- `can_manage_bank_accounts(uuid)`
- `can_manage_image_rules(uuid)`
- `has_tenant_feature(uuid,text)`
- `is_platform_admin()`

The local RLS catalog uses these helpers in authenticated policies. The test confirms a tenant member can still read through the RLS policy path. It also confirms all five functions execute as `service_role` when `auth.uid()` is null. The migration adds no `auth.uid()` checks and changes no function bodies.

The before-catalog audit found no Group A/B/D target referenced by an RLS policy or by an authenticated-executable invoker function. No function was held pending user confirmation. The known policy helpers are the explicit Group C exceptions.

## Dynamic RPC and fixture audit

The `.rpc(` search found three variable or expression call sites in runtime code:

- [orders.ts](../../lib/features/commerce/orders.ts): the `rpc` parameter is called only with the fixed `place_cf_order` name. It does not dispatch to `place_live_cf_order`.
- [customer-tab-slip.ts](../../lib/features/slips/customer-tab-slip.ts): `completeRpc` is restricted to `complete_auction_customer_tab_slip` or `complete_customer_tab_slip`.
- [sessions/route.ts](../../app/api/live-cf/sessions/route.ts): the expression selects only `live_session_tab_proof` or `live_session_dashboard`.

The requested names `place_live_cf_order`, `confirm_live_auction_winner`, and `premium_overview_summary` have no application `.rpc(` call site, including through those variable dispatchers. They remain in the catalog and receive service-role-only grants; none was dropped. A generic `f.db.rpc(name, args)` occurrence is confined to a test harness.

The existing authenticated-role checks in `tests/features/commerce/live-cf-setup.test.ts` are negative permission assertions. `tests/standalone-slip.test.ts` checks table RLS and does not call a restricted RPC directly. `scripts/test-full-database-setup.cjs` already exercises a denied authenticated RPC and then its service-role path. No successful restricted call was found running as `anon` or `authenticated`, so no fixture callsite needed conversion.

## Default privileges

The local PGlite session and all 314 public function owners were `postgres`; the fixture has no `supabase_admin` role. Both default-privilege statements explicitly use `FOR ROLE postgres`: one role-wide and one `IN SCHEMA public`. The role-wide revoke is necessary because the built-in function `EXECUTE` default is global: a test-created function showed the schema-scoped revoke alone still allowed `anon`. The regression test creates a function after the migration and confirms that neither client role receives `EXECUTE`. There is no `FOR ROLE supabase_admin` statement because that owner was absent locally; hosted object ownership was not inspected.

No hosted role ownership was inspected. If a deployed database also creates public functions as `supabase_admin`, add a corresponding default-privilege statement only after confirming that owner on that database.

## Test results

The captured privilege-test TAP output is [rpc-privilege-tests.log](./rpc-privilege-tests.log):

- 185/185 restricted overload calls returned SQLSTATE `42501` for `anon`, with `RESET ROLE` after each call.
- 185/185 restricted overload calls returned SQLSTATE `42501` for `authenticated`, with `RESET ROLE` after each call.
- `service_role` retained `EXECUTE` on all 185 restricted overloads.
- The Group C authenticated RLS path and service-role calls passed.
- The auction bid → host close → winner confirmation/order and expiry report flow passed as `service_role`.
- The 314-function after-snapshot regression passed; only the five Group C signatures retain authenticated execution among `SECURITY DEFINER` functions.

Other local verification passed:

- `npm.cmd test`: 131 passed, 0 failed.
- `node --test --test-concurrency=1 scripts/test-auction-*.cjs scripts/test-live-auction*.cjs`: 136 passed, 0 failed.
- `scripts/test-full-database-setup.cjs` and `scripts/test-auction-preflight.cjs`: 6 passed, 0 failed.
- Six local commerce, follow-up, agent-control, and AI-quota SQL suites: 6 passed, 0 failed.
- `node scripts/build-full-database-setup.cjs --check`: 143 SQL sources, 125 included, 18 excluded; generated schema parity passed.

An earlier broad run hit the known `test-admin-feature-bypass.cjs` fixture/schema error (`record "t" has no field "is_active"`), which the prior audit recorded as baseline-shared. `test-overview-fetch.cjs` and `test-followup-and-broadcast.cjs` were mistakenly included because the audit runner auto-discovered every `scripts/test-*.cjs` file. The `npm test` command did not include either script; it runs only `tests/*.test.ts` and `tests/features/commerce/*.test.ts`.

The repository audit runner now explicitly withdraws both operational scripts from auto-discovery in [run-suite.cjs](./run-suite.cjs). This is a filename exclusion, not a network guard: the runner does not block `fetch`, `http`, `https`, TLS, or raw socket connections and does not prevent a test from loading `.env.local`. Task 12's global `*.supabase.co` outbound guard remains unimplemented; the old 1,021-test log is historical evidence of the pre-exclusion run and was not regenerated.

## Change boundary

No function was dropped. This Phase 2 task added one source migration and did not edit an existing source migration. The migration registry and generated bootstrap bundles were updated to place the new migration last. The workspace already contained unrelated changes, including a pre-existing edit to `live-auction-auto-cycle.sql`; that file was not changed during this Phase 2 task.
