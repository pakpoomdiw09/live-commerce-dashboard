# Broadcast recipient selection

Apply `supabase/broadcast-recipient-selection.sql` after `broadcast-policy.sql` before deployment. It adds nullable `broadcasts.selected_customer_ids` and freezes the selection after a campaign starts. Legacy null selections retain their original group behavior; new checkbox selections save explicit IDs, including an empty array meaning nobody.

The Broadcast workspace shows eligible recipients as checkboxes after checking the draft. Owners can select individuals or select/clear all. Confirmation saves those IDs and refreshes the preview/fingerprint before starting transport. The sender intersects saved IDs with the tenant/group/tag audience; unchecked customers are never reserved or charged. Editing draft content/groups invalidates the preview. In-progress selections are immutable.

AI and Broadcast import `standard-message-window.ts`: valid signed inbound timestamp, not in the future, strictly less than 24 hours old. Exactly 24 hours is closed. Broadcast evidence is now restricted to the selected Page and inbound-message kind, matching AI's lookup. Outgoing messages, receipts and other Pages do not open the window. Preview and transport remain independently validated; expired recipients are skipped rather than blocking eligible customers.

Consent, owner authorization, current Page permissions, message credits and deployment readiness remain required. A 24h timestamp alone cannot remove those separate checks. The sender still uses the database's final transport check and idempotent delivery ledger. Per-recipient evidence refresh now queries only that customer's latest Page interaction, avoiding repeated full-tenant evidence scans.

Apply `supabase/broadcast-inbound-sync.sql` after the signed webhook queue and message-window migrations to write inbound `messages` and their window evidence atomically. It also repairs recent messages corroborated by the signed queue, and never uses outgoing AI messages or an uncorroborated `last_message_at` to extend the window. Preview members include `lastInteractionAt` and `windowEligible` for diagnostics.

Sending now requires `BROADCAST_STANDARD_SEND_ENABLED=true` plus real Page/recipient/credit checks. The old manual policy version/date/30-day review gate is no longer used. `.env.local` has been enabled for this requested workflow; restart the local server, and configure the same flag separately in the deployment. A true flag does not send anything by itself; the owner still selects recipients and confirms each campaign. AI on/off state does not change a customer's window or override opt-out.

Validation: `node --test scripts/test-broadcast-policy.cjs scripts/test-broadcast-drafts.cjs scripts/test-inbox-automatic-shutdown.cjs`. Live Meta transport is not exercised by these tests.
