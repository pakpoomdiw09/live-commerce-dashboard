# SnapBot AI Agent Control Center Pro

Implemented at `/chatbot/conversations`, retaining the existing Keyword editor, authentication, Gemini model configuration, Inbox ownership, message delivery leases and payment systems.

## Completed

- Eight tabs: Overview, Brain & Knowledge, Keyword, Automation, Playground, Handoff, Analytics and Security. Orange SnapBot styling, responsive layout, real database records and explicit empty/configuration states.
- Central orchestrator: durable incoming-message claim → human/consent checks → ordered Keyword match → entitled AI with available credits → configured fallback or handoff. Keyword wins even in AI mode. Existing CF, slip and Vision processing remain upstream.
- AI Agent remains Pro-only according to existing database entitlements. Free/Starter keep existing Keyword behavior. No plan is unlocked by frontend flags or clicking payment buttons.
- Tenant-scoped knowledge CRUD, seven knowledge types, owner-only prompt edits and version restore, immutable historical versions, audit trail, monthly AI quota and request rate limit. Monthly quota defaults to **0**, pending an actual business allocation; AI credits are separate from existing message/slip balances.
- AI uses the existing configured Gemini model. The new path asks the model to select existing knowledge/product IDs; the server constructs responses from actual stored facts and catalog price/stock. Unsupported facts, protected payment statements and detected injection require review. No financial mutation tools are exposed.
- Existing Inbox claim/pause/resume APIs provide ownership transitions. Customer STOP pauses automation and cancels queued follow-ups through existing triggers. START clears consent refusal but does not automatically resume the bot. A database trigger prevents resuming an opted-out customer.
- Durable AI invocation ledger and dispatch marker prevent automatic retries after uncertain provider/delivery outcomes. Recovery moves expired processing jobs to review. No guessed refunds or Messenger replays.
- Playground is a deterministic simulation using saved rules/knowledge/catalog. It never calls a provider, sends Messenger or consumes credits, even if a request supplies forged live-mode fields.
- Actual provider token metadata is recorded when available. Currency cost remains unknown rather than displaying a fabricated charge.

## Files

New UI: `components/chatbot/AgentControlCenter.tsx`.

New services: `lib/agent-control-core.ts`, `lib/agent-control-flags.ts`, `lib/agent-control-ai.ts`, `lib/agent-control-server.ts`, `lib/agent-orchestrator.ts`.

Integration: `lib/ai-agent.ts`, `lib/chatbot-server.ts`, `lib/chatbot.ts`, `components/chatbot/ConversationsClient.tsx`, `app/(dashboard)/chatbot/conversations/page.tsx`.

New API routes:

| Route | Protection / purpose |
| --- | --- |
| GET `/api/agent-control` | Session, tenant membership, active AI entitlement, master/tenant flags |
| PATCH `/api/agent-control` | Same plus owner; prompt update/version audit |
| POST/DELETE `/api/agent-control/knowledge` | Same plus owner and knowledge flag; atomic scoped mutation/audit |
| POST `/api/agent-control/prompts/[version]/restore` | Same plus owner; creates a new prompt version |
| POST `/api/agent-control/playground` | Same plus playground flag; simulation only |
| POST `/api/cron/agent-control` | Server bearer secret; recovery only |

New SQL: `supabase/agent-control.sql`, `supabase/agent-control-rollback.sql`. Setup: `supabase/agent-control-setup.md`. Example environment flags only: `.env.example`; `.env.local` was not changed.

Tests: `scripts/test-agent-control.cjs`, `scripts/test-agent-control-sql.cjs`; updated legacy Gemini test sandbox to explicitly supply an empty environment.

## Verification

- Combined new and existing regression suites: **177 passed**, 0 failed.
- Real PostgreSQL engine in isolated PGlite: **22 scenarios passed**, including Pro/Starter/Free/expiry gates, zero/exhausted quota, rate limit, duplicate claims/invocations, latest inbound sequence, handoff, STOP/START, owner/tenant isolation, atomic knowledge audit, prompt restore, interrupted workers, RLS/restricted columns, migration reruns and non-destructive rollback.
- `npx.cmd tsc --noEmit`: passed.
- `npm.cmd run lint`: passed, 0 errors; 10 existing warnings elsewhere.
- `npm.cmd run build`: passed.
- Production HTTP smoke: login 200, protected page redirects 307, all new API methods reject anonymous requests with 401.
- Tests use mocked providers and isolated databases; no real AI, Messenger sends, payment approvals or production migrations were performed.

## Requires configuration / practical limits

Apply the migration after its documented dependencies, set a real per-tenant monthly AI allocation, enable selected flags and configure the authenticated recovery schedule. See setup instructions. No production deployment/database changes were made.

Provider/Messenger end-to-end verification with a test Page is still required before enabling live sends. No live cost-pricing integration or provider billing reconciliation is implemented. Token summaries cover the latest 100 ledger entries, conversation/job previews are limited to 50, knowledge management to 100 records, and prompt history previews to 30.

The new AI response path deliberately renders stored facts instead of arbitrary generated prose. Existing saved instructions guide source selection, not an unrestricted answer channel. Pattern-based injection detection is an additional control, not a guarantee against every adversarial input. Knowledge/catalog facts are snapshotted when generation begins; edits during inference are not separately reloaded at dispatch.

Turning on the new orchestrator while live sending is disabled creates drafts and can still consume AI quota when AI is enabled. Handoff can pause a conversation in that mode. For a no-provider preview, use Playground only.

Keep normal billing/payment authorization unchanged. This change adds no checkout, simulated payment success or automatic AI quota top-up product.
