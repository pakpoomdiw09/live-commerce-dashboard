# Customer / Slip / AI Overview aggregates

## Resulting behavior

- `/customers` uses one `customer_directory` RPC with 50 customer rows per page. Search, order-status and tag filters run before pagination. Sort order is `last_message_at DESC NULLS LAST, id DESC` so equal timestamps have a deterministic tie break. Previous/next links retain filters; a submitted search starts again on page 1. Out-of-range pages clamp to the last page. Invalid filters are rejected before calling the RPC. The matched set materializes only IDs; full customer fields are fetched only for the current page.
- Paid amount/count per customer include all lifetime `valid` slips for that customer and tenant. The header count and paid amount represent the full filtered customer set, not just the current page. Customers without valid slips remain visible with zero totals. Tag facets come from the tenant, not only the loaded page.
- AI Overview calls `agent_overview_stats` once for 7/30/90-day metrics, daily series and the latest 10 jobs. It retains the lifetime distinct count of customers with sent AI jobs. Future jobs are excluded, Bangkok calendar days are used, invalid negative elapsed times are excluded from the average, and empty averages/success rates remain null. Customer names are still fetched only when the existing customer entitlement allows them.
- Basic Overview calls `basic_overview_stats` once for the 14 Bangkok calendar days ending today, with a complete status/count/revenue aggregate and at most eight attention records. It no longer loads up to 5,000 slips to compute statistics in Node. This also aligns status totals with the 14-day chart: the previous query could include about 15 days and truncate results. Revenue still includes valid slips and permitted manual approvals, never approved duplicate/pending slips.
- Basic Overview Realtime subscriptions now include the selected tenant filter.

Aggregation reduces network payload and Serverless memory; exact counts and lifetime totals still require database work proportional to the qualifying data/index entries. OFFSET pages can become slower at deep offsets. A cursor API or maintained summary tables are later options if production measurements justify them.

## Installation order

1. Review and apply the project's existing schema, `platform.sql`, `feature-access.sql`, `agent-control.sql` and related Inbox/tenant upgrades as documented for the current deployment. The new SQL expects existing customer `avatar_url`, tags/order status, slip tenant/customer/approval fields and agent jobs.
2. Apply **`supabase/dashboard-read-models.sql` before deploying this application change** in the matching Supabase project. It adds read-only RPCs and supporting indexes inside a transaction and can be run repeatedly. Test it in staging first. On large live tables, coordinate index creation with the database's load; regular index creation can block writes while each index is built. Review installed indexes to avoid equivalent indexes under other names; the slip period index reuses `overview_slips_time` from `dashboard-performance.sql`.
3. Deploy the code to Vercel with the same Supabase environment. No new environment variables are required.
4. Open `/customers` with filters and navigate pages; inspect Basic Overview and AI Overview with an account that has the appropriate feature access. Verify two different tenants independently.

This implementation does not apply SQL to a live database or deploy Vercel automatically. If the new RPCs are missing or fail, the application shows an error and logs a safe error code instead of fabricating zero statistics or falling back to unbounded reads. An application rollback can leave these additive functions/indexes installed.

## Authorization

The three functions are invoker-security functions with a fixed search path. EXECUTE is revoked from PUBLIC, anon and authenticated, and granted only to service_role. Server pages/services authorize the active tenant before calling them; Customer and Basic Overview RPCs additionally check the existing feature entitlement. AI Overview retains its existing membership/feature model so expired subscriptions can still see control status. No service keys, raw proofs or job payloads are returned.

## Mock repairs

- `test-dashboard-recovery.cjs`: supplies explicit shop setup when testing the failing overview data provider, so the test reaches the intended failure rather than an unrelated missing tenant-query mock. The assertion still requires an unavailable error, not zero metrics.
- `test-platform-dashboard-api.cjs`: uses the real image signature helper and supplies the banking export expected by the real payment validator. Forged-image, ownership, payment amount/provider, duplicate and activation-failure assertions remain active.
- `test-agent-overview.cjs`: mocks the aggregate receipt and asserts that no job-history table pagination runs; repairs stale module paths and saved-reply/knowledge fixtures. Routing assertions now explicitly model keyword/AI modes and current handoff behavior when AI is disabled.
- `test-dashboard-page-scope.cjs`: executes the actual nested Basic Overview component and real aggregate loaders against scoped RPC mocks. Supplies current auth/role/avatar-check mocks and a known payment feature environment, so assertions exercise data access instead of failing during fixture initialization.
- The broader Premium Overview fixtures now include current metrics/activity/setup fields and real shared presentational components. Their assertions still check tenant guards, unavailable errors, escaped text, locked modules and absence of fabricated online/revenue claims. The commerce performance fixture also now models the existing category-options query and current shared UI/core exports; no commerce production code changed.

## Validation

```sh
npm run test:performance
```

Verified locally: 100 tests passed, production build passed, TypeScript passed (including `--allowImportingTsExtensions` for the existing test imports), formatter passed, and the architecture checker found no violations. ESLint reports zero errors and the same 12 existing hook/image warnings. The SQL suite was also rerun after the final migration edits.

The SQL tests run in isolated PostgreSQL/PGlite, with 1,201 customers and more than 6,000 slips. They check pagination without overlap, cross-tenant slip exclusion, literal search, full lifetime totals, tag/status filters, roles and inactive tenants, migration repeatability, Bangkok boundaries, null/empty metrics and SQL parity with the AI reference implementation. These tests use no production credentials and send no external messages or payments.

Measure authenticated TTFB, response bytes, Supabase execution times and query plans with representative production data after rollout. Local correctness tests do not establish a production latency improvement percentage.
