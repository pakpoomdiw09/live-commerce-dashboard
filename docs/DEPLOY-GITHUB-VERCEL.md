# Deploy the dashboard through GitHub

Repository: `pakpoomdiw09/live-commerce-dashboard`, production branch: `main`.

## 1. Install the database read models first

In the **production Supabase project used by Vercel**, open SQL Editor and run the complete `supabase/dashboard-read-models.sql`, including BEGIN and COMMIT. Use the prerequisites described in `docs/DASHBOARD-READ-MODELS.md`. Do not publish the application first: GitHub pushes may immediately trigger Vercel builds.

After the SQL succeeds, run `supabase/dashboard-read-models-check.sql`. All three functions and all five indexes should report installed=true. For functions, service_can_execute must be true and client_can_execute must be false. This verifies installation and grants; it does not substitute for application smoke tests or prove that the correct Supabase project was selected.

The migration is additive and does not need to be dropped for an application rollback. On large live tables, regular index creation may block writes during the build; schedule migration accordingly.

## 2. Validate, commit and push

```powershell
npm.cmd run test:performance
node --test scripts/test-clean-cache.cjs
npm.cmd run format:check
npm.cmd run lint
npm.cmd run build
git status --short
git fetch origin main
git rev-list --left-right --count HEAD...origin/main
```

Review the changed and staged paths. Keep `.env.local`, generated caches, `.tmp` and node_modules out of the release. Removal of previously tracked `.npm-audit-cache` files is intentional. This release includes the earlier formatter changes as well as webhook diagnostics, cache cleanup, performance/RPC work and repaired mocks, so its diff spans many source files.

Commit the reviewed changes locally. Only after production SQL installation is confirmed, push with:

```powershell
git push origin main
```

Do not force push if remote main advanced; fetch and integrate the changes first. Use the full commit SHA from `git rev-parse HEAD` to identify the new deployment.

## 3. Check the exact Vercel deployment

GitHub reports two Vercel contexts for this repository: `Vercel – live-commerce-dashboard` and `Vercel – live-commerce-dashboard-faxh`. Follow the target URL for the new commit's checks. Confirm which project owns the intended production domain; a successful check on a previous commit is not proof of this release.

For each relevant project, verify:

- The deployment uses the new Git SHA, Git branch main, and the intended Production environment.
- The deployment state is Ready and Build Logs contain no failing build/type/lint errors. Existing warnings are different from build errors.
- Production environment variables point to the migrated Supabase project, especially NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Do not copy secrets into this document or Git.
- Authenticated `/customers` loads, search/status/tag filters work across pages, and paid totals remain correct. Basic Overview and AI Overview load without missing-RPC errors.
- Runtime logs do not report PGRST202/42883 (missing functions) or 42501 (permissions). Compare another tenant to confirm data remains scoped.

Verify GET webhook confirmation with the configured Verify Token if the release changes webhook behavior; do not log that token or fabricate incoming production messages.

If deployment fails, use the new deployment's Build Logs to diagnose. If code is Ready but read-model errors remain, verify the production database target and migration installation before changing application code. A rollback of the app does not roll back Supabase SQL.
