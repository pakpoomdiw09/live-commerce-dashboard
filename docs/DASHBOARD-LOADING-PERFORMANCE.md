# Dashboard loading review

Follow-up: customer/slip and AI Overview aggregation is now implemented in [Dashboard read models](DASHBOARD-READ-MODELS.md), including required SQL installation before deployment. The expensive-query table below records the original findings; the first three entries have now been addressed by the new RPCs.

## Changes in this review

- `lib/auth.ts`: layout's `requireDashboardUser()` and the actor/tenant helpers share the same verified `getUser()` result using React `cache`. This removes a second authentication round trip during a Server Component render. The cache lasts for one request, not across users. API requests still verify authentication normally.
- `app/(dashboard)/layout.tsx`: billing, feature access and plan-expiry requests now start together after authentication and tenant resolution. Their independent waits overlap rather than adding together. Billing still refreshes its credits and access checks still fail closed.
- The layout has an outer Suspense fallback. The segment's existing `loading.tsx` lives below its layout, so it could not cover the layout's own database waits.
- Facebook Page profile lookup streams in a separate Suspense boundary. The shell can show the saved shop name while Meta is unavailable or slow. Page connection permissions are unchanged.
- `app/(dashboard)/chatbot/loading.tsx`: adds a table skeleton for chatbot routes; customers and overview already have route skeletons.
- Customer listing now selects only fields used by the table/search. Large customer notes and unrelated conversation state no longer travel from Supabase into the Server Component and browser payload. Paid-total calculations remain unchanged.

## Remaining expensive queries

These are code findings, not measured production latency. No production database schema or deployment configuration was changed.

| Path | Current cost | Next step |
| --- | --- | --- |
| `app/(dashboard)/customers/page.tsx` | Up to 500 customers with every matching valid `slips(amount)` row; total/count computed in JS | Add a tenant-scoped SQL aggregate and server pagination/search. Keep lifetime totals calculated over all valid slips, not just a page of slips. Existing search/filter operates on the loaded 500 customers, so adding pagination requires moving filters to the server as well. |
| `lib/features/agents/agent-overview-server.ts` | Sequential 1,000-row pages over all job history | SQL aggregate for range metrics and lifetime distinct customer count, plus a separate latest-10 query. Applying only a date filter would change the lifetime metric. |
| `components/overview/BasicOverviewPage.tsx` | Up to 5,000 slips with customer names, aggregates in JS | Aggregate chart/KPI data in SQL and query a separate bounded activity list. Check existing premium overview RPCs before introducing another one. |
| `lib/feature-access.ts` | Five parallel feature RPCs in the shell; pages can check features again | Consider one DB-owned entitlement snapshot RPC. Retain authorization at API/mutation boundaries and expire any display cache on plan changes. |
| `lib/features/billing/billing.ts` | Credit refresh RPC and tenant read on shell render | Measure query/lock times first. Do not cache credit enforcement or skip rollover logic just to improve display latency. |

## Cache and Vercel guidance

Use request-scoped React `cache` to share authentication/tenant reads during Server Component rendering. Existing `getTenants`, `getActiveTenant`, and `getViewer` already use it. Creating a cache wrapper inside a component does not share results with other callers. See [React cache](https://react.dev/reference/react/cache).

Do not switch every Supabase fetch from `no-store` to `force-cache`: the same URL can depend on cookies, access permissions and the selected tenant. Message history, current credits, session state and authorization need fresh checks. Persistent caching is appropriate only for carefully selected display data, keyed by tenant and scoped after authorization, with explicit invalidation after updates. In-memory maps in serverless instances do not provide a shared cache or reliable invalidation.

Keep `loading.tsx` near routes and use Suspense around independent slow sections. A skeleton improves feedback, not database execution time. See [Next.js loading](https://nextjs.org/docs/app/api-reference/file-conventions/loading).

Before changing regions, compare the deployed Vercel Function region with the Supabase region. Choose nearby regions based on the actual deployment. Increasing `maxDuration` does not make queries faster. Avoid initializing external providers or doing Graph diagnostics in the critical path of ordinary dashboard navigation.

## Verify on production

1. Measure authenticated requests to overview, customers and chatbot with the same tenant/data volume, separating first request from repeated navigation. Record TTFB, total response time and response bytes; compare p50/p95 across multiple requests.
2. Inspect Supabase Query Performance for slow queries, RLS policy costs, lock waits and sequential scans. Use read-only EXPLAIN first; do not run EXPLAIN ANALYZE on writes.
3. Review the existing indexes in `supabase/dashboard-performance.sql` and the database's installed indexes before adding duplicates. That migration includes RPCs and prerequisites, so review the complete file before applying it.
4. Simulate a slow Facebook profile service: the shell should appear with the shop name while the profile waits. Test an unauthenticated request still redirects to login, and two tenants cannot read one another's data.
5. Confirm dashboard filters, customer paid totals and AI lifetime metrics retain their original meaning after future SQL aggregation changes.
