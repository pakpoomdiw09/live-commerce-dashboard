# Flexible On-Demand Winner Flow

The default session setting is `winnerFlow: "on_demand"`. Saved `keywords` are confirmation triggers, including repeated tags; no default keywords are invented. A configured trigger takes precedence over numeric/opening parsing.

Each signed comment is scoped to its tenant, Page, live post and current product round. Numeric comments retain the sender's actual price, including prices below the global leader. A confirmation looks up that sender's highest numeric price in the round. Without numeric history it produces no order or reply. The confirmation does not synthesize an opening or incremental price.

Confirmation works before and after closing. Comment timestamps do not disqualify bids or confirmations. Closing records the round state; it does not create a winner bill or send a preliminary winner announcement. A new product round uses its own bid history.

One claim per round and Facebook sender links to one order. Repeated confirmations reuse the order and update its unpaid item amount when necessary. Orders join the existing customer tab; shipping remains once per customer/live session, with existing shipping overrides preserved. Paid, partially paid and shipped amounts require review before repricing.

Public and private delivery independently respect the saved switches. Private replies target the confirmation comment and include the cumulative balance, receiving account and signed payment link. The transactional outbox deduplicates webhook replays, supersedes unsent older summaries and serializes sending against claim revisions. Ambiguous provider sends require review rather than automatic duplicate delivery.

Messenger slip routing and SQL settlement recognize claim ownership even when that customer is not the global leader and the round remains active. Tenant/customer identity and exact outstanding tab amount checks still apply. Claim orders use the existing paid-order shipping flow. Dashboard auction sales include billed claim items.

## Database rollout

Apply `supabase/live-auction-on-demand.sql` **after** `supabase/live-auction-production-readiness.sql` before deploying the updated webhook worker. For an existing database use these forward migrations, not the fresh-install bundles. The new migration adds claim records and revision-aware delivery metadata, updates modern settings to the new default, and adopts existing billed orders without deleting payments. It supersedes unsent old automatic close notifications; existing sent and ambiguous deliveries remain recorded.

An explicitly configured `winnerFlow: "highest_bid"` retains compatibility with the legacy console. Modern settings without a mode migrate to on-demand. Fresh database bundles include the migration in dependency order.

Local verification uses `npm run test:auctions`, `npm run test:live-auction-dashboard`, `npm run test:shipping`, schema checks and TypeScript/lint checks. SQL tests execute the full schema with PGlite; Meta sends are mocked. This verifies application behavior, not a live Facebook delivery or production database rollout.
