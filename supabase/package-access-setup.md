# Open AI access and package credits

Run `package-access.sql` LAST after the existing billing, payments, slip top-up and admin migrations, before using this release. It preserves balances and tenant ownership. Rerun it last if older migrations are reapplied.

This project stores subscription state in `tenants.plan` and `plan_expires_at`; no separate subscriptions table or `ai_agent_enabled` flag is used. AI is selected through `bot_settings.reply_mode='ai'` and still needs the configured AI provider credentials and the shop/chat bot toggles.

All plans may buy broadcast/slip top-ups. Approvals atomically add broadcast purchases to `broadcast_topup_credits`, slip purchases to `slip_quota_credits`, and mark the request approved. Repeated approvals do not grant credits twice. Plan purchases add to `broadcast_credits`, extend the subscription by 30 days and preserve both top-up buckets.

Authentication, owner-only checkout, tenant isolation, payment proof verification and credit consumption remain enforced. A pending purchase is reused instead of creating duplicate unpaid orders; the owner can attach a slip or cancel it in billing history.
