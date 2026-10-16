# Facebook multi-admin

Run `facebook-multi-admin.sql` after the existing `facebook-tenants.sql` in Supabase SQL Editor, then deploy the updated application.

Both OAuth callbacks obtain Pages directly from Meta using the OAuth user token. Only Pages with an explicit `MANAGE` task and a valid matching Page token with `pages_messaging` enter the service-only synchronization RPC. Missing permissions or failed verification never grant membership. Browser-supplied Page IDs or tokens cannot invoke this RPC.

New Pages create a tenant and owner membership. Existing Pages retain their tenant, original owners, billing balances and settings; a verified Facebook administrator becomes an additional owner. A verified existing staff member is promoted to owner. Repeated callbacks do not duplicate tenants or memberships. Inactive tenants are skipped and remain suspended.

Connecting an account grants persistent SnapBot membership. Removing someone's Facebook access does not automatically revoke an existing SnapBot membership; remove that membership separately when offboarding.

Test with a second Facebook administrator through Login or Connect Facebook: it should see the same tenant ID in `/select-page`. Accounts with messaging access alone must not gain automatic ownership.
