# Live Auction readiness fixes — 6 November 2026

Implementation follows the user's four requested fixes and the subsequent instruction to use a **provisional Bee Move contract**. This is an implementation and local verification record, not a claim of deployment or successful real courier/Messenger transactions.

## Implemented

| Area | Behavior |
|---|---|
| Workspace expenses | Each `cost`, `ads`, `shipping`, `fees` value of `''` or `null` becomes numeric `0` before validation, idempotent payload creation and saving. Missing fields, negative/invalid values and >2 decimals still fail. Direct workspace RPC also normalizes empty/null expenses. |
| Session expenses | Legacy costs controller accepts empty/null values too, supports `fees`, and preserves stored fees when older callers omit that field. Session Finance displays/edits fees and includes them in profit. |
| SQL profit | `live_session_dashboard` now deducts `other_fees` in addition to cost, ads and actual shipping. Its existing revenue basis remains verified customer-tab payment receipts; this change does not reclassify unclosed bids as recognized revenue. The unified auction form's bid/sales preview remains separate. |
| Immediate winner delivery | Removed the SQL hold trigger and the TypeScript confirmation branch/guard. Closing locks the winner and queues enabled Public/Private replies to the original winning comment. A previous winner's next-round bid is no longer consumed as a confirmation. |
| Legacy deliveries | Migration releases only `awaiting_confirmation` records for closed auctions with an order and winning comment. It leaves `sent`, `sending` and `requires_review` records untouched. Confirmation metadata stays for compatibility; the service-only old RPC returns `not_required` and cannot retarget deliveries. |
| Bee Move | New `lib/integrations/shipping/beemove-adapter.ts`, provider registration, SQL allowlists and settings UI with a single API Key credential. Fixed origin prevents sending the key to an arbitrary configured host. |
| Tracking auto-notify | Provider completion and manual dispatch enqueue tracking transactionally via a shipment trigger. The API immediately drains those shipments; the existing authenticated Facebook webhook recovery cron drains pending jobs. Messages include tracking, courier and HTTPS tracking URL for the correct tenant/customer/PSID. |
| Delivery resilience | Atomic claims and message keys prevent duplicate notifications. Policy/lease blocks before a send remain pending with a five-minute retry delay. Ambiguous outcomes/stale sending leases require review. Existing sent receipts reconcile without sending again. Old shipped parcels are not backfilled/notified on migration. |
| Provider ambiguity | A malformed HTTP-success response, timeout or unconfirmed DB completion leaves a carrier job `uncertain`, preventing another parcel on a new request ID. Definite rejection may fail normally. |

Public/Private switches still control which replies are sent. Removing the confirmation gate does not enable a channel the seller disabled. Existing pause, tenant authorization, payment, address confirmation and Messenger policy checks remain in effect.

## Bee Move provisional contract

The following values were explicitly requested by the user; they are **not verified against an official Bee Move API specification**:

```text
POST https://client.beemove.co.th/api/v1/orders/create
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <persisted provider-job key>

{
  "order_id": "...",
  "shipment_id": "...",
  "recipient": { "name": "...", "phone": "...", "address": "..." },
  "sender": { "name": "...", "phone": "...", "address": "..." },
  "weight": 1,
  "courier_code": "beemove"
}

Expected response:
{ "tracking_number": "...", "label_url": "https://...", "tracking_url": "https://..." }
```

`tracking_url` may be omitted: the integration's Tracking URL Template is then used. The initial template `https://client.beemove.co.th/tracking/{tracking_number}` is also provisional and editable. `tracking_number` and `label_url` are required; the adapter never generates fake tracking or label values.

The transport performs a real HTTP request when parcel creation is invoked. Only automated tests mock the network. Do not treat its passing mock tests as evidence that this unverified endpoint accepts the production API Key or books a real courier.

There is no known authenticated read-only connection-test endpoint. `testConnection` therefore returns an explicit unavailable error rather than creating a parcel or treating a public HTML page as proof of valid credentials. Once the official spec is available, replace the path/payload/response mapping and connection test in this adapter. Keep the outbox and idempotency safeguards.

## Database rollout

Apply **`supabase/live-auction-production-readiness.sql`** to the existing database after `live-auction-empty-keyword-defaults.sql` and `shipping-integrations.sql`. It is a forward migration, so older source migrations and their recorded checksums remain unchanged. Schema bundles and the dependency manifest have been rebuilt.

For an existing installation, run this new migration in the Supabase SQL Editor as the database owner, then deploy the matching TypeScript changes. The updated `complete_schema.sql` also contains the forward migration for the normal complete-schema rollout mechanism. Do not re-run historical source migrations individually after the new one, since they can restore the old confirmation trigger/functions.

The connected local environment has **no `DIRECT_URL`/`DATABASE_URL`**, so live DDL has not been executed. A Supabase REST service key cannot execute arbitrary SQL DDL. Migration testing used disposable PostgreSQL/PGlite instances and includes repeat installation and release of held deliveries while preserving sent records.

## Required runtime settings

1. Set a stable `SHIPPING_CREDENTIALS_ENCRYPTION_KEY` on the server: 32 random bytes represented as 64 hex characters or base64. Its format is documented in `.env.example`. Never expose it via `NEXT_PUBLIC_*`, rotate it casually or use different values on different instances. This key is missing in the local environment checked during this task; no key was generated or rotated against existing ciphertext.
2. In Shipping integrations select Bee Move, enter the API Key and sender details, review the provisional tracking template, and explicitly enable the integration when ready for the agreed endpoint. No Secret Key, Access Token or Merchant ID is needed for this adapter.
3. Retain the real per-Page tokens, enabled reply switches and signed payment-link configuration. The earlier audit's expired tokens/missing subscriptions still require account setup; code changes cannot restore revoked Meta credentials.
4. Verify the external scheduler calls `/api/cron/facebook-webhooks` with `Authorization: Bearer <CRON_SECRET>`. This existing endpoint now also drains the tracking outbox. No new external scheduler or real message/parcel transaction was launched in this task.

## Verification

- `npm run test:auctions`: 37 passing, including immediate notification/no confirmation and next-round bid handling.
- `npm run test:shipping`: 16 passing, including the adapter, transactional outbox, manual/create API ordering, concurrency, replay, policy blocking and uncertain outcomes.
- `npm run test:live-auction-dashboard`: 9 passing; empty/null/invalid expenses, SQL fees, forward migration reruns and held-delivery release.
- `npm run test:schema`: 11 passing; fresh/partial/older install and repeated application; source history/checksum guards.
- Browser fixtures: unified auction card and duplicate tags; Shipping provider settings/manual dispatch/PDF labels; Session Finance fee-inclusive profit.
- TypeScript and production build pass. Lint reports 0 errors and 11 existing warnings. Logs are under `.tmp/auction-readiness-fixes/`.

Outstanding production verification: apply live migration, set the stable encryption key, confirm Bee Move's actual contract, and perform an authorized staging transaction with real tracking/label and Meta receipts. Therefore the Bee Move path is prepared as requested, but full production readiness is not certified by these local tests.
