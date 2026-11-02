# Live auctions

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
The existing Facebook webhook worker cron also drains pending auction bills.

Only the linked Page and the Facebook IDs explicitly entered by the owner can
control an auction through comments. Dashboard access requires tenant owner access.
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

The final bill is a comment-scoped Messenger private reply to the winner's latest
accepted bid, with a signed payment/upload link. Public bid confirmations do not
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
