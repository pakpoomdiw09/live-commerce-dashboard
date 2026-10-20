# Chatbot modes and keyword limits

`bot_settings.reply_mode` selects independent behavior in both live handlers and test endpoints:

- `ai`: no keyword rule query/matching. Grounded AI uses current tenant shop rules/persona, all active products (paged), active `agent_knowledge_sources`, and all Saved Replies within their existing 100-record storage limit. AI feature/credit, service-window, emergency and ownership guards remain required. Failures transfer to staff; no generic fallback.
- `keyword`: match active tenant rules by the existing exact/contains match type and priority. A match sends its configured answer without AI quota. An unmatched message does not call AI or send a fallback. Human requests and protected input may still transfer to staff.

Apply `supabase/keyword-reply-limits.sql` after automation, billing and security migrations. This is required to enforce creation limits in production. It uses the tenant's database subscription, not request parameters, browser state or platform admin privileges:

- Free/standard, expired/unset subscription: 3 total keyword replies.
- Active Starter or Pro with future `plan_expires_at`: 20 total keyword replies.

Disabled rules count too. A database trigger serializes creation against the tenant row, covers direct browser/API/service-role inserts and tenant moves, and raises `P0422` at the limit. The editor displays a Thai error. Existing over-limit rows are not deleted on downgrade: editing/deletion remain possible, but creation is blocked until below the current limit. RLS continues authorizing tenant membership separately.

No change to Saved Replies UI or keyword UI separation; backend knowledge sharing applies only to AI. Independent comment rules and other automation are outside this keyword reply limit.

Validation: `node --test scripts/test-keyword-reply-limits.cjs scripts/test-ai-only-routing.cjs scripts/test-shop-persona.cjs scripts/test-inbox-reply-isolation.cjs scripts/test-ai-paid-runtime.cjs`.
