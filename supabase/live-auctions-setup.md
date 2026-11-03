# Live auctions

For `/live-auction`, apply `live-auction-winner-confirmation.sql` after
`live-auction-unlimited-keywords.sql` before deploying the confirmation flow.
The generated `complete_schema.sql` also includes it. This migration preserves
orders/payments and never requeues sent or ambiguous notifications.

In this workspace, close keywords (`X`, `❌`, `321`, or the saved custom list)
freeze the winning price and create the order/tab immediately. Notifications wait
in `awaiting_confirmation`. The latest closed round's winner must comment a saved
bid keyword (for example `1`) again. The database verifies the actual webhook
author, Page/live, queue order, keyword and latest round, then releases the enabled
public/private replies to that confirmation comment. Other customers cannot release
the bill. Confirmation replays never create another order or resend a completed
delivery. An unconfirmed winner can confirm during the next active round; once
confirmed, subsequent keywords in that active round become bids normally.
Both confirmation templates support `{ชื่อลูกค้า}`, `{รายการ}`, `{ราคา}`,
`{ยอดรวมสะสม}` and `{เลขบัญชี}`. The round price remains frozen; cumulative
totals and the receiving account come from the actual customer tab when dispatching.
Shipping is charged once per live by the shared tab ledger, not added again on
confirmation. Legacy public bid templates retain their restricted variables.

For cumulative bills and automatic partial payments, continue with
[customer-tabs-setup.md](customer-tabs-setup.md) after installing this base auction
schema. Its payment flow replaces manual one-order proof submission for newly
consolidated live orders; existing historical orders keep the legacy flow below.

Apply `live-auctions.sql` after `live-cf-customer-variants.sql` and
`facebook-webhook-nonblocking.sql`, before deploying the updated application.
Fresh installations can use the regenerated `complete_schema.sql`.

Use the existing `LIVE_CF_APP_URL` (or `NEXT_PUBLIC_APP_URL`) and a
`LIVE_CF_PAYMENT_LINK_SECRET` of at least 32 characters. An active receiving bank
account and a connected Facebook Page are required to open a round at `/live-cf`.
The Facebook webhook worker also drains pending auction bills. `vercel.json` has
no Vercel Cron configuration. Configure an external scheduler to request
`/api/cron/facebook-webhooks` every minute with `Authorization: Bearer <CRON_SECRET>`.
See [facebook-webhook-cron-setup.md](facebook-webhook-cron-setup.md) for the free
cron-job.org setup and verification steps.

The linked Page, the opening owner's verified Facebook ID, and Facebook IDs
explicitly entered by the owner can control an auction through comments. The API
resolves the opening owner's Facebook identity server-side; a Supabase user UUID
is never a Facebook author ID. Users signing in by email need their own Facebook
Page connection (`facebook_pages`); its token is inspected with `FB_APP_ID` and
`FB_APP_SECRET`. If the personal identity cannot be verified, reconnect Facebook
before opening a round. Existing rounds retain their saved host IDs.
Dashboard access requires tenant owner access.
At `/live-cf`, use the visible CF/Auction tabs; `/live-cf?mode=auction` opens the
auction controls directly. The opening form remains visible even when the auction
API reports missing setup or insufficient permissions. Live prices, leaders,
host counts and comment history poll every three seconds while the auction tab is
active, and refresh when returning to the browser tab.

Dashboard shortcuts send `3`, `2`, `1` or `❌` to the configured live video's
comments using the connected Page token. The server enqueues the confirmed Meta
comment in the same ordered queue as customer bids, and deduplicates Meta's later
webhook by comment ID. The shortcut cannot close the auction when publication
cannot be confirmed. For a send timeout, check the live video before trying again.
This UI update uses the existing auction and Facebook queue schema.

`เคาะ 3` records the count; only an explicit close command (`ปิด`, `x`, `❌`, etc.)
or the dashboard close button finalizes the sale. There is no countdown timer.

Customer `เปิดให้ 10 ลุ้น` means the configured opening price. `1` or `+1`
offers one minimum step (or the opening price before anyone has bid).
A plain numeric price must meet the minimum. A new accepted bid clears the count.
Auction comments for the configured live video take priority over ordinary CF rules,
including after closing so late bids cannot create CF orders accidentally.

All Page comments share the durable queue's arrival sequence. A database row lock
serializes price changes and closing. Closing inserts one order (winning bid plus
shipping) and notification outbox entries in the same transaction. Replayed events
return the stored result. Meta can delay or reorder deliveries: this is an arrival
order guarantee, not a reconstruction of comments that Meta has not delivered.
Comments with a numeric Meta timestamp before the round began are rejected.

The final bill is a comment-scoped Messenger private reply to the winner's
confirmation comment in `/live-auction` (the latest accepted bid for legacy
auctions without close-keyword settings), with a signed payment/upload link. Public replies do not
consume that private reply. Permissions and Meta private-reply restrictions still
apply. Pending outbox entries retry through cron; ambiguous sends become
`requires_review` and appear on the dashboard, to avoid duplicate bills.

The signed payment page accepts one image proof for an auction order. Uploading
evidence does **not** mark the order paid. It appears in Slips with a note requesting
manual owner review. Owner approval pays only the linked auction order. These
uploads do not consume automatic slip-verification credits.

Validate with `npm run test:auctions`, `npm test`, `npm run test:schema`,
and `npx tsc --noEmit`. `npm run test:auctions:ui` runs the real components
with mocked services in an isolated headless Chrome profile, checks mobile/tablet/
desktop layouts and form flows, and saves screenshots under `.tmp/auction-ui-preview/`.
