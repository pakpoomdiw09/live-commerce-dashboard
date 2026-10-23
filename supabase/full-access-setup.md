# Temporary Full Access

This release enables the source-controlled `temporaryFullAccess` switch in
`lib/full-access.ts`. It applies to every active shop, including Free and expired
subscriptions. It does not approve payments or change subscription dates/balances.

## Activate in production

1. Run **all of `supabase/full-access.sql`** in the SQL Editor of the same Supabase
   project used by Vercel. Run it last, after feature-access, AI paid access,
   agent-overview, AI vision, commerce and keyword/follow-up migrations.
2. The SQL runs in one transaction and saves the installed function definitions.
   If it reports a missing prerequisite or unexpected expression, stop and resolve
   that migration mismatch; no partial activation should be committed.
3. Deploy the matching application commit. This repository does not automatically
   execute SQL on a GitHub push. The UI switch alone cannot unlock database RPCs
   or restrictive RLS policies. Until SQL is applied, existing database denials can
   still occur. Do not label that deployment as fully activated.
4. Run `supabase/full-access-check.sql`. Active-tenant feature results should all be
   true; client access to the AI reservation RPC should remain false.
5. Sign in as an existing shop member, open Overview, and verify the AI, slip and
   customer panels show real results or a truthful empty state. Test an AI draft
   and a slip with the existing provider configuration. No test invokes providers
   automatically.

Authentication, tenant membership, owner-only actions, inactive-tenant checks,
provider credentials, receiving-bank checks, emergency stops, opt-outs, message
windows, deduplication, leases and rate limits remain enforced. Full Access does
not turn on disabled automation. AI/slip/image usage continues to be recorded;
temporary broadcast reservations do not debit or refund paid balances.

## Restore package enforcement

Set `temporaryFullAccess = false` in `lib/full-access.ts`, run the complete
`supabase/full-access-rollback.sql` in the same project and deploy the flag change.
The rollback restores the original installed function bodies; it does not reset
usage or modify billing records. Keep the backup table. Do not apply unrelated
function migrations while this mode is active without reviewing their interaction
with the backup and eventual rollback.

## Local verification

`node --test scripts/test-full-access.cjs` exercises the enabled application mode
and executes activation/repeat activation/rollback against isolated PostgreSQL
(PGlite). It never loads `.env.local` or calls production/provider services.
Legacy helper tests default to Full Access disabled and still test the normal
package policy. The Full Access suite explicitly injects the actual source flag.
