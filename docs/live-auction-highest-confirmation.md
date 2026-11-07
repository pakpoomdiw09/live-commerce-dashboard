# Highest-bid winner confirmation

Active auction comments are handled before CF matching. Numeric bids update the round's highest bidder/price using the existing minimum and increment rules. Confirmation defaults to `1` when the configured keyword list is empty; custom keywords match exactly after Unicode, case and whitespace normalization.

Only the current highest bidder can confirm. Supabase locks the auction row, validates Page/tenant/post, new-comment eligibility and receipt ordering, then atomically records the winner confirmation, closes the round, creates the winner's invoice and queues delivery. The winning item price comes from `auctions.current_price`; configured shipping remains a separate bill charge. Wrong-sender confirmations, ties, duplicate comments and late bids cannot create another invoice. Historical on-demand self-billing is no longer a confirmation path.

After commit the webhook immediately drains the winner outbox. The private reply includes item name, winning price, shipping, outstanding balance, bank account and a signed QR/payment/slip-upload link. Confirmed winners receive one complete message regardless of the older split-summary setting. Existing pending legacy deliveries retain their recovery behavior. Failed/uncertain sends retain the durable outbox review safeguards. Page credentials, an active bank account, payment-link configuration and enabled private replies are required for delivery.

Deploy `supabase/live-auction-highest-confirmation.sql` after `live-auction-on-demand.sql`, before deploying the matching application change. It is rerunnable, does not send messages, and is included in the generated fresh-install/upgrade bundles. It leaves historical invoices intact.

Validation: `npm.cmd test`, `npm.cmd run test:auctions`, `npm.cmd run test:schema`, `npm.cmd run build`.
