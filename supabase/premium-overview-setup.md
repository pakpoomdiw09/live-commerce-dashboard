# Premium Overview: local/staging setup

The `premium_overview_enabled` feature defaults to false. Its server environment switch is `PREMIUM_OVERVIEW_ENABLED=true`. This task appended the documented default only to `.env.example`; it did not modify `.env.local`, start a permanent dev server or install anything into the live database.

1. Review `premium-overview.sql` and install it into a **test/staging database** after the existing security, feature-access, customer-profiles and smart-inbox migrations. Existing slip quota/top-up and approval columns are required. Agent Control tables are optional. The migration creates only a read-only aggregate function and ensures the existing tenant/date index names exist. It makes no network requests and changes no business records.
2. In a PowerShell terminal in this workspace, opt in for that process only:

```powershell
$env:PREMIUM_OVERVIEW_ENABLED = 'true'
npm.cmd run dev
```

3. Sign in, select the intended shop and open `http://localhost:3000/overview`. If an existing dev process is already using the port, stop/restart that process with the new variable, or use `npm.cmd run dev -- --port 3001` and open port 3001. A missing migration displays a setup/error notice rather than invented metrics.
4. Check 7/30/90/all filters, a second shop, Free/expired access locks, search, pagination, a read-only slip preview and Inbox links using test data. Provider checks and Messenger sends are not needed to read this page.

Production does not automatically enable this feature even if `PREMIUM_OVERVIEW_ENABLED=true`: the gate additionally requires `NODE_ENV=development` or an explicitly labelled staging deployment (`APP_ENV=staging`). Set `APP_ENV=staging` only on a staging deployment. Do not change the production environment to masquerade as staging.

## Rollback

```powershell
$env:PREMIUM_OVERVIEW_ENABLED = 'false'
npm.cmd run dev
```

Restart the intended process after changing its environment. The original page, sidebar and navigation remain present. The additive RPC/indexes can safely remain unused; no business data, balances or logs need to be removed. There is no destructive rollback SQL.

## Checks

```powershell
node --test scripts/test-premium-overview.cjs scripts/test-dashboard-page-scope.cjs
node scripts/test-premium-overview-sql.cjs PATH_TO_ISOLATED_PGLITE_MODULE
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
# Optional: Chrome headless offline layout check, uses temporary fixtures only.
node scripts/check-premium-overview-browser.cjs
```

The SQL test never loads `.env` or talks to Supabase. The browser check requires a local Chrome executable (or pass its path as the first argument), uses an isolated temporary profile and the actual production CSS from the completed build. It intentionally renders test fixtures without a login, live API data or hydrated mutation controls. It does not verify signed-in production data or provider integrations.

See `docs/premium-overview-implementation.md` for exact metric definitions, changed files, test results and unsupported data sources.
