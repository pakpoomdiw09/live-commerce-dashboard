# Overview data diagnostics

From the project root, run:

```sh
node scripts/test-overview-fetch.cjs --tenant=<selected-shop-uuid>
```

If the selected shop is unknown, `--first-active` explicitly tests one active shop.
That does not prove another selected shop or Vercel's environment is configured the
same way. The script loads `.env.local` without printing credentials and performs
only reads. It prints the Supabase project hostname, HTTP status, query name,
Postgres/PostgREST code, counts and response shape. No customer/message/slip rows
are printed. Service-role reads bypass RLS: zero rows alone are not an RLS diagnosis.

On Vercel open the deployed project's **Logs**, filter `/overview` or
`/api/overview`, refresh Overview and search `[overview]`. Entries contain `stage`,
`tenantId`, `status`, `code`, `message`, `details`, `hint` and stack when available.
Credentials/JWTs are redacted and the search term/payload are not logged.

- `tenants.credit_columns`: the optional credit-column lookup failed. The reader
  retries only `id,name` and keeps unrelated statistics available.
- `rpc.overview_dashboard_stats`: the aggregate query failed. `PGRST202`/`42883`
  means the RPC/signature/schema cache is missing; its definition lives in
  `supabase/dashboard-performance.sql`, not `dashboard-read-models.sql`. Review
  that file's prerequisites before applying it to the correct project.
- `42703`: a referenced column is missing; use the error's column name to find the
  relevant prerequisite migration. `57014` or fetch timeout means a query timed out.
- `42501`, HTTP 401/403: authorization/active-shop failure. The recovery path is
  deliberately not used for these responses.
- `rpc.overview_dashboard_stats.shape` / `rpc.activity.date`: an incomplete or
  incompatible response. Valid sections remain visible; missing counters use 0.
- `recovery.*`: a specific direct SQL-count query failed. Other successful counts
  remain visible. Messages are scoped through `customers.tenant_id`, since
  messages do not have their own tenant_id column.

When the main RPC is unavailable, recovery uses server-side exact counts with a
bounded response, never downloading the entire history to aggregate in JavaScript.
Distinct customers are counted as parent customer rows with matching inbound
messages. Revenue, time-series, demographics and recent lists are not fabricated:
they remain empty/defaults when the aggregate cannot provide them. A small neutral
status explains temporary zero values; the large alert is reserved for a fatal
failure (no usable shop/database data or authorization failure).

In temporary Full Access mode the fetcher also ignores the legacy
`PREMIUM_OVERVIEW_ENABLED=false` switch, matching the route which always renders
Premium. Provider credentials and tenant-membership checks remain mandatory.

Local regression tests:

```sh
node --test scripts/test-overview-reader.cjs scripts/test-overview-premium-error.cjs
```
