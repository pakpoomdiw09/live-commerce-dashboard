# SnapBot Payment Verification Pro

## COMPLETED

This implementation extends the existing Next.js 15 / Supabase / SlipOK project. Existing
uncommitted work, secrets, package pricing, billing activation and balances were preserved.
No production migration, deployment, real verification or Messenger message was performed.

### Backend and payment safety

- `processSlip` dispatches into Pro only when the server master switch, tenant opt-in and
  `riskEngine` are enabled. Otherwise the existing verifier runs with its original contract.
- The **existing** `verifyWithSlipOK` adapter is reused without changing its endpoint, API key,
  multipart/QR field names or `log=true` default. Compatibility tests were run before editing
  integration. Protocol fields were checked against [SlipOK Check Slip documentation](https://slipok.com/api-documentation/check-slip/).
- AI classification is never payment evidence. Vision and Facebook images reach the same
  `processSlip` entry point; manual verification and Inbox verification do too.
- Amounts use integer satang, computed from a locked server-side snapshot of pending orders.
  Frontend expectedAmount, plan, credit and proof claims cannot authorize a payment.
- Active receiver accounts are read per tenant. The SQL transaction independently verifies
  bank aliases, masked account digits and registered PromptPay identifiers. A name alone
  cannot approve a receiver. A branch-1014 slip still has to match the shop's actual account.
- A provider-verified transfer reference, exact amount, valid transfer time and matching
  recipient are required. Missing/mismatched data goes to REVIEW_REQUIRED. Transfer time
  must be within 24 hours of verification, no more than two minutes in the future, and no
  earlier than the snapshotted order minus two minutes.
- Tenant + proof SHA-256 uniqueness prevents duplicate requests from charging or calling
  SlipOK twice. Atomic claims ensure concurrent requests have one provider owner. Reusing
  another customer's proof returns a duplicate result and never confirms that customer paid.
- The permanent shared transaction ledger is reused across sales and package/billing payments.
  Accepted image hashes also use the shared image ledger. Failed applications roll back their
  ledger claims, order updates and state changes together.
- The database state machine protects terminal records. Only trusted server evidence can
  produce VERIFIED; owner review cannot force-approve an invalid provider result or amount.
- Successful application atomically claims proof, updates only the snapshotted orders,
  updates the customer's payment status and stops pending payment follow-ups. Existing paid
  order triggers remain active. A send already dispatched cannot be recalled.
- Legacy approval routes redirect Pro proofs to Pro review. Database guards additionally
  prevent broad legacy approval from attaching a Pro slip to later/new orders, even after
  flags are disabled. This closes a proof-reuse path without changing non-Pro approvals.

### Credits, restart and notifications

- The existing atomic `consume_slip_credit` and `refund_slip_credit` are used. Admins do not
  bypass the DB package or quota guard. Pro credits are the existing slip credits, separate
  from broadcast/message and Vision balances.
- Credits are taken only immediately before the provider request. Known provider faults
  refund exactly once inside the result transaction. Uncertain provider execution is retained
  for review rather than guessed/refunded and retried.
- The recovery cron turns expired VERIFYING claims into review; it never re-calls SlipOK.
- Owners can explicitly retry an image only if no provider request ever started and no credit
  was charged, at most three local attempts. QR-only and uncertain provider calls cannot be
  replayed. The saved image is reused; no new image or payment is invented.
- Automatic Pro notifications require all of: production environment, server live-send switch,
  tenant `messengerAutomation`, and a verified payment. Development/tests cannot send Pro
  notifications. Duplicate requests cannot notify again. Existing Messenger idempotency,
  message credits and delivery leases are reused.
- Reviewing/approving/rejecting/cancelling in the Pro dashboard does **not** send a message.
  The existing explicitly requested manual confirmation remains a separate legacy operation.

### Dashboard

When the backend `advancedDashboard` flag is enabled, `/slips` adds the orange/pink Pro view:

- Actual 30-day overview/analytics, with aggregate SQL over all matching records.
- Latest 500 attempts, review queue and duplicate/amount/receiver filters.
- Actual shared slip-credit usage and Pro charged/refunded counts.
- Private slip image and receiver/amount/transaction details via the existing authorized API.
- Owner-only review actions with a required audit reason.
- CSV export of at most 10,000 tenant records from the last 30 days, with formula injection
  escaping and private/no-store response headers.
- Latest 100 audit events. The page refreshes Pro data every 30 seconds and after review.
- Provider configuration presence is shown honestly: a configured key/branch is **not**
  reported as a successful live connection. Dashboard GET never probes/charges SlipOK.

Legacy history and manual-upload UI remain visible, preserving access to old records.

## Feature flags

Server environment examples are in `.env.example`; `.env.local` was not edited:

| Setting | Default | Effect |
| --- | --- | --- |
| PAYMENT_PRO_ENABLED | false | Master gate; off keeps legacy verification |
| PAYMENT_PRO_KILL_SWITCH | false | Emergency disables Pro entry points and automatic Pro approvals |
| PAYMENT_PRO_SEND_ENABLED | false | Additional production-only gate for Pro automatic messages |

`payment_pro_settings` is backend-owned and has no browser write grants or public flag-setting
API. Missing flags are false. Tenant `enabled` defaults false, with no opt-in rows seeded.

- `riskEngine`: opt in to the new transaction-based verifier.
- `orderMatching` + `autoConfirmation`: both required for automatic confirmation.
- `messengerAutomation`: production notification opt-in, also subject to server live-send gate.
- `advancedDashboard`: access to Pro dashboard/API/CSV/review.
- `analytics`: enable the aggregate analytics query and cards.
- `duplicateDetection` / `followUpIntegration`: compatibility configuration names retained from
  the supplied starter example. **They cannot disable permanent ledger uniqueness or the
  existing mandatory stop-on-paid follow-up safety.** Those protections are always enforced.

The emergency switch stops the new Pro functionality; it does not stop the existing legacy
slip verifier. To stop all automatic verification, also use the shop's existing auto-verify
switch. For an immediate database-level stop of in-flight Pro application, disable the shop's
`payment_pro_settings.enabled` (see the rollback script).

## API changes

| Route | Access / behavior |
| --- | --- |
| GET `/api/payment-pro?tenantId=...` | Session, membership, slip package, master/tenant/dashboard flags |
| GET same route with `format=csv` | Same guard, fixed export columns and tenant filter |
| POST `/api/payment-pro/[id]/review?tenantId=...` | Owner/admin session; approve, reject, cancel, safe image retry; required reason |
| POST `/api/cron/payment-pro` | Configured CRON_SECRET bearer (or INTERNAL_API_SECRET fallback); recovery only |
| Existing `/api/slips/verify`, Inbox verification, signed webhook and Vision worker | Existing auth/scopes/contracts; shared `processSlip` dispatcher |
| Existing `/api/slips/[id]/approve` | Non-Pro unchanged; Pro records return 409 directing owner to Pro review |

New APIs do not accept package, credit, actor or provider-proof overrides from frontend.
RLS enforces membership + package. Browser sessions cannot mutate Pro settings, attempts,
audit or credits; raw provider evidence and claim tokens are not granted to browser roles.

## File manifest

Created:

- `lib/features/payments/payment-pro-core.ts`: flags/types, integer money, decision/state machine, timestamp and CSV helpers.
- `lib/features/payments/payment-pro-flags.ts`: server kill/master gates and DB configuration.
- `lib/features/payments/payment-pro.ts`: provider integration, durable claim, safe retry and result metadata.
- `lib/features/payments/payment-pro-server.ts`: API authorization, scoped lists/credits/analytics.
- `app/api/payment-pro/route.ts`, `app/api/payment-pro/[id]/review/route.ts`, `app/api/cron/payment-pro/route.ts`.
- `components/slips/PaymentProDashboard.tsx`, `components/slips/PaymentProEvidence.tsx`.
- `supabase/payment-pro.sql`, `supabase/payment-pro-rollback.sql`, `supabase/payment-pro-setup.md`.
- `scripts/test-payment-pro.cjs`, `scripts/test-payment-pro-sql.cjs`, this report.

Modified:

- `lib/features/slips/process.ts`: off-by-default dispatcher and Pro result metadata.
- `lib/features/slips/notify.ts`: suppress Pro notification unless explicitly allowed.
- `app/api/slips/[id]/approve/route.ts`: prevent broad legacy approval of Pro proofs.
- `app/(dashboard)/slips/page.tsx`, `components/slips/SlipsDashboard.tsx`: conditional Pro view.
- `components/slips/VerifySlipForm.tsx`: display duplicate-proof explanation when no new row is created.
- `.env.example`: three disabled server switches; no real credentials changed.
- `scripts/test-dashboard-page-scope.cjs`: mock optional Pro config as off for existing page regression tests.

## TESTED

- Pre-integration legacy compatibility: 16 tests passed before changing the dispatcher.
- Combined Payment Pro, billing/payment, slip, Vision, Inbox, AI, security and follow-up suite:
  **156 tests passed**, including 19 new Payment Pro tests.
- Isolated PostgreSQL: **31 Pro integration scenarios passed**. The tests use real feature,
  Inbox, Smart Follow-up and permanent ledger SQL, not a mocked payment transaction.
- Covers approval/rejection/review, amount/receiver/time, duplicate proof/transfer/image,
  provider fault refunds, missing credits, same-proof concurrency, cross-tenant references,
  owner-only review, legacy-approval guards, order changes, stopped follow-ups, worker recovery,
  safe pre-provider retry, migration reruns and non-destructive rollback.
- `npx.cmd tsc --noEmit`: passed. `npm.cmd run lint`: zero errors, 10 existing warnings.
- `npm.cmd run build`: passed, including production compile and type checking.
- Production HTTP smoke checks passed: login 200; `/slips` redirects 307 to login; dashboard,
  CSV, review, recovery cron and legacy verification endpoints return 401 without credentials.
  The temporary test server was stopped after verification.
- No provider or Messenger network calls occurred during tests. Mock assertions validate request compatibility;
  these tests do not claim a successful live SlipOK connection or production deployment.

## Remaining setup / intentionally unavailable

- Apply the migration to staging first, after the prerequisite migrations. No migration was
  applied to the connected production project. See `supabase/payment-pro-setup.md`.
- No public UI/API was added to enable production flags. A trusted administrator must opt in
  through backend configuration after authorization and staging verification.
- The upload form without a linked customer/order can still verify a slip, but Pro cannot
  auto-pay an arbitrary frontend amount. It stays in review with ORDER_REQUIRED. Linking an
  unbound upload to an order is not implemented by this change; use the customer's Inbox
  image-verification flow for automatic matching.
- No force approval for invalid/missing provider evidence, no bank-reconciliation connector,
  no automatic replay of uncertain provider work, and no QR-payload retention/retry.
- Provider status is configuration-only; live health/quota probes were deliberately not run.
- No deployed scheduler, production rollout, historical data import or unlimited/paginated
  export was added. Existing history/ledgers/credits are preserved.

## Rollback

1. Set the server Pro emergency switch and/or master off, then restart the app.
2. With database-owner authorization, run `supabase/payment-pro-rollback.sql` to disable all
   tenant opt-ins, including in-flight Pro application. It preserves flags and all data.
3. Keep tables and proof/order guards installed. Never delete an accepted transfer/image ledger
   or erase audit history; already-confirmed payments remain paid and cannot be reused.
4. Re-enable only after investigation; review interrupted attempts through the trusted flow.
   No automatic uncertain-provider retry is performed during rollback or restart.

Run locally with `npm.cmd run dev`. All new switches remain off until explicitly configured.
