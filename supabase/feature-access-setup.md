# Package feature access

Run `feature-access.sql` LAST in Supabase SQL Editor, after `security.sql`, `automation.sql`, `image-response-rules.sql`, payment/slip migrations and `package-access.sql`. Deploy the application after applying it. No records, ownership, balances or customer data are deleted.

Confirmed access matrix:

| Feature | Free | Starter | Pro |
| --- | --- | --- | --- |
| AI Agent | Locked | Locked | Allowed |
| Image assistant | Locked | Allowed | Allowed |
| Customer management and Inbox | Locked | Allowed | Allowed |
| Customer Follow-up | Locked | Allowed | Allowed |
| Slip Auto Pilot | Locked | Allowed with credit | Allowed with credit |

Access comes from `plan_features`, the tenant's active status, `plan` and a future `plan_expires_at`. Null or expired subscription dates fail closed. No administrator metadata or feature-bypass flag overrides these feature checks. Billing remains accessible so users can purchase or renew a plan; purchased top-ups alone do not create a paid subscription. Apply `free-message-quota.sql` last to enable the shared 100-message Free quota and the Follow-up database guard.

Customer/message/comment/order access and image-rule access are protected with restrictive RLS policies on authenticated clients. AI settings writes have a database trigger. AI calls and slip processing check entitlements server-side, including background jobs. Slip quota is consumed atomically; provider failures refund the consumed credit. The existing tenant-membership policies remain in force.

The current image assistant stores response rules; the project does not yet contain a separate image-analysis AI endpoint. Any future image-analysis worker/API must call `requireFeature(db, tenantId, 'image_assistant')` before invoking a provider.

Successful trusted payment activation updates the existing tenant subscription and credits. Feature access follows those database values without a separate unlock flag. Dashboard payment success refreshes server state; the sidebar also refreshes at the subscription expiry time. Expired customers are hidden, retained, and readable again after a verified renewal.

Do not run historical permissive security/package migrations after this migration without reapplying it LAST. Test in an isolated database with `node scripts/test-feature-access-sql.cjs <path-to-@electric-sql/pglite>`, plus `node --test scripts/test-feature-access-api.cjs scripts/test-chatbot-playground.cjs`.
