# Automatic PromptPay package payments

Run the existing schema migrations including `platform.sql`, `automation.sql`, `billing.sql`, and `security.sql`. Then run **all of `payments.sql`** in the Supabase SQL Editor as `postgres`. The migration is transactional and safe to re-run. Run it again after re-running `billing.sql`, which contains the legacy calendar credit functions.

The four requested `NEXT_PUBLIC_PROMPTPAY_ID`, `NEXT_PUBLIC_BANK_ACCOUNT_NO`, `NEXT_PUBLIC_BANK_ACCOUNT_NAME`, and `NEXT_PUBLIC_BANK_NAME` settings are saved in `.env.local` with the supplied mock values and documented in `.env.example`. Replace them with the actual platform receiver before accepting payments. The PromptPay ID must resolve to that receiving account. Configure the same main receiving account in SlipOK, and set server-only `SLIPOK_BRANCH_ID` and `SLIPOK_API_KEY`. Do not use an individual tenant's bank account for platform package fees. Restart the development server after editing environment settings.

Open `/billing` as a shop owner. Starter costs ฿9 and adds 1,500 broadcast credits; Pro costs ฿19 and adds 7,500. The backend creates a 20-minute payment session with price, credits, and receiver snapshots, generates a PromptPay payload with an amount, and returns the QR payload for `qrcode.react`. The QR amount is prefilled; the backend still independently requires an exact matching transfer amount.

Upload a JPG/PNG/WebP slip up to 5 MB. The API checks image bytes, calls SlipOK with `log:true` and the server's amount, requires genuine successful verification, and rejects duplicate/wrong-receiver results. It independently checks the amount in satang, bank, masked account with at least four correctly placed visible digits or exact PromptPay proxy, and transfer time in the checkout window (allowing two minutes of clock tolerance at the beginning). The configured SlipOK receiver check is required; a masked account match never overrides a receiver rejection.

`payment_receipts` uniquely registers both the bank transaction reference and uploaded image hash. Triggers claim a permanent shared `payment_transfer_ledger` entry under a unique bank-reference constraint, preventing concurrent reuse between customer-sales slips and package receipts. The ledger remains after deletion of a tenant, user, or sales slip.

The service-only `activate_payment` function locks the checkout, receipt, and tenant; adds the package credits; extends expiry by exactly 30 days from the later of now/current expiry; marks the receipt applied and the session paid in one transaction. Retries return the existing state without adding credits. Existing topup/slip-check credits are preserved. Purchased broadcast credits do not reset on the first day of a calendar month; at plan expiry, the normal Free-plan rules apply. Legacy manual purchases keep their calendar allowance.

The page updates React billing state from the successful API response and displays a success animation. Background App Router synchronization does not reload the browser. Top-up buttons unlock immediately and server broadcast gates read the updated plan.

If activation fails after a verified receipt is recorded, retry the same checkout: it uses the stored server proof without calling SlipOK again, even after QR expiry. If SlipOK succeeded but the database failed **before** recording proof, the API asks for administrator assistance and another transfer is not required. A SlipOK duplicate response alone cannot grant a plan.

API contracts:

- `POST /api/payments`: JSON `{tenantId, plan}`; plan is `starter` or `pro`. Amount/credits/receiver supplied by the browser are ignored.
- `POST /api/payments/verify-slip`: multipart `{sessionId, file}`. File may be omitted only when this checkout already has server-verified proof. Successful response contains `{success: true, sessionId, billing}`.
- `GET /api/payments/[id]`: checkout and `pending`, `expired`, `verified`, or `paid` status; paid status also returns safe billing fields. All endpoints require an owner or platform admin for the checkout's tenant.

Validation uses mocks and ephemeral PostgreSQL only; no real payment APIs or live Supabase changes are made by the automated tests. A real scan/transfer and SlipOK verification must be tested after setting the real receiver and applying the migration.

Run API/verification checks with `node --test scripts/test-payment-api.cjs scripts/test-payment-validation.cjs`. Run migration checks with `node scripts/test-payment-sql.cjs <path-to-@electric-sql/pglite>` using a separately installed PGlite package. The database fixture checks migration reruns, proof requirements, transfer/hash reuse, activation retries, credit arithmetic, renewal, expiry, permissions, and retained records. It does not simulate concurrent connections.

Broadcast reservations keep the existing RPC contract. Refund only the unused portion once: `refund_broadcast_credits` is atomic but has no reservation ID for deduplicating refund retries. Apply this migration again after `billing.sql` so its purchased-credit behavior remains in effect.
