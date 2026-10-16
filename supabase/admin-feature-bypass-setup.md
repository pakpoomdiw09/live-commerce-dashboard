# Admin feature bypass

Run all of `admin-feature-bypass.sql` as `postgres` **last**, after `platform.sql`, `security.sql`, `billing.sql`, `payments.sql`, and `ai-agent-gate.sql`. Re-run it after re-running those files. The migration is transactional and safe to re-run.

Administrators must be explicitly listed in `public.platform_admins`. Neither app metadata nor user metadata grants administrator privileges. Manage this table through trusted database administration; removing a row revokes administrator status on subsequent requests. The application has no existing `profiles.role` schema.

Signed-in administrators bypass AI Agent, automatic-slip, broadcast Message Tag plan gates, and credit limits. Admin-initiated manual slip verification and broadcast sending do not deduct or refund customer credits. The actual package and credit balance remain unchanged; purchases still require verified payment proof.

Webhook automation has no signed-in administrator. To make an administrator's own shop exempt, add that trusted user to `tenant_members` with `role = 'owner'` for the shop. Only admin-owned shops receive the background exemption. An admin viewing or supporting a customer's shop does not automatically grant that customer unlimited background usage. Ordinary tenants remain metered, including requests executed by the internal service role.

SQL wrappers retain the existing atomic metering implementations under `_metered` functions and restrict them to the migration owner. Exempt requests reserve a logical batch without decrementing balances; refunds are no-ops, so failed requests cannot mint credits. Existing proof, duplicate-slip, authorization and Meta messaging-window checks remain active.

Local checks: `node scripts/test-admin-feature-bypass.cjs <path-to-@electric-sql/pglite>`, `node scripts/test-ai-agent-gate.cjs <path-to-@electric-sql/pglite>`, and `npx.cmd tsc --noEmit`. Tests use isolated PostgreSQL fixtures, never live Supabase or provider APIs.
