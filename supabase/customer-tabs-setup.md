# Cumulative live bills and Smart Inbox

Apply `customer-tabs.sql` after `live-auctions.sql`, or use the regenerated
`complete_schema.sql` to install/upgrade atomically. Deploy the application after
the migration. Run `npm run test:customer-tabs`, `npm run test:auctions`,
`npm test`, `npm run test:schema`, and the production build.

New auction wins and Live CF orders are attached transactionally to one tab per
shop, Page, customer and canonical live-video ID. A fully paid tab stays in that
live session and reopens when the customer wins again. Shipping is charged once
per customer per live, using the first nonzero configured auction shipping fee.
CF-only sessions default to zero shipping. Use consistent video IDs when setting
up CF and auctions; verified auction post aliases are also recognized.

The ledger, not a client-side sum, determines totals. Database row locks serialize
item changes and payments. Slips are accepted only through the server's SlipOK
path with a genuine positive amount, a transfer reference, matching active shop
receiver and a valid provider timestamp. Partial transfers omit the legacy
exact-total check. The shared bank-transfer ledger rejects reuse across all
payment flows. File hashes prevent repeat provider charges. An accepted slip,
the tab payment, balance and order allocation commit together. Overpayments remain
visible as credit; they are not silently discarded. Paid items require a separate
refund review before cancellation.

Existing historical orders are left on their previous flow. This migration does
not invent payment history or import old slips as new credits. Historical
consolidation needs an explicit reconciliation of verified receipts. Rollout does
not require deleting/recreating orders, customers, slips, or message history.

`/chat` opens the existing `/inbox` Smart Inbox. Its profile/order side panel polls
bill details every three seconds, lists verified payments with slip links, and
sends a fresh bill through the existing authenticated manual reply endpoint.
Existing Messenger webhook persistence, Realtime messages and admin replies remain
in use. Private CF/auction bills are recorded in message history as well.

An Inbox slip without a signed bill scope is applied to that customer's oldest
outstanding live tab on the connected Page. A transfer for a specific live should
use that bill's signed upload link. Credit remains with its live tab rather than
being silently moved between different live sessions.

The signed existing `/pay/live/<token>` URL now shows the whole cumulative bill,
the current receiving account/QR, and accepts multiple partial payments through
SlipOK. It verifies the signed order's customer and tab on the server. Client
amounts, customer IDs and tab IDs are never accepted as financial authority.

The live controls can end a live session and schedule reminders at +1 hour and
09:00 the next day in Asia/Bangkok, or queue reminders for all debtors immediately.
Smart Inbox also queues a reminder for a selected customer. Batch request UUIDs
make the same batch idempotent. The server rechecks the current balance after AI
wording and before dispatch; settled bills are cancelled.

Configure a scheduler to call `GET /api/cron/customer-tabs` every five minutes
with `Authorization: Bearer <CRON_SECRET>`. The existing protected Facebook worker
also drains due reminders. Cron schedules depend on your hosting plan; the
repository does not modify an external scheduler or enable a paid hosting plan.
`GEMINI_API_KEY` and the existing AI entitlement/quota settings enable AI wording;
otherwise a polite deterministic Thai template is used. AI writes only the
greeting; item lists, amounts, account details and payment links come from the
verified database. Messages include all items in bounded chunks plus a payment
button; long comment-private bills use a compact latest-item summary and link to
the full bill to respect the one-reply/text-size limit.

Automatic reminders honor shop/chat pauses, messaging credits, automation safety,
the global agent kill switch and customer opt-outs,
Page readiness and the normal Messenger response window. They never use a human
agent tag to bypass policy. Outside that window, jobs show `blocked`; an admin can
review and request a new notification after the customer messages again. Unknown
provider outcomes show `requires_review` and are not automatically repeated.
These are deployment/configuration requirements, not a confirmation that real
SlipOK, Meta deliveries or external cron schedules were exercised during tests.
