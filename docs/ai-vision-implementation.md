# SnapBot AI Vision Center

## COMPLETED

The existing Next.js App Router, Supabase session/membership checks, database feature entitlements,
Gemini SDK, product catalog, SlipOK pipeline, Inbox handoff/leases and message credits are reused.

- `/chatbot/images`: actual server-backed usage, settings, owner rule CRUD/toggles/priority,
  real-image playground, latest 30 jobs, private image history, safe retry and `/billing` link.
- Categories: PRODUCT, PAYMENT_SLIP, GENERAL, UNKNOWN. Confidence below configured threshold
  (minimum 0.8) goes to review/handoff. Exactly one active rule wins by descending priority,
  then ascending ID. Product rules remain available to Starter; catalog matching requires Pro's
  actual `ai_agent` entitlement **and** the database product-search flag.
- Gemini receives image bytes and this shop's active catalog (up to 100 entries). Product ID
  must resolve against that catalog. Reply price, name and stock come exclusively from DB rows.
  Model descriptions never become customer replies or payment confirmations.
- Slip classification calls the existing `processSlip` only for live Messenger jobs. Its
  package/credit, receiving-account, duplicate transfer and outstanding-order checks remain.
  `notifySlipResult` derives payment wording from the real verifier verdict. Slip rules are
  retained in the editor but never override a verifier verdict or confirm payment independently.
- Private uploads check MIME, magic bytes and 5 MB size. Playground body reading is bounded
  even without Content-Length. Remote downloads accept HTTPS Meta CDN hosts fbcdn.net/fbsbx.com
  only, reject redirects and enforce streaming limits. No client-provided remote URL is fetched.
- API session + tenant authorization + `has_tenant_feature` run before privileged reads/uploads.
  Settings/retry require owner or platform admin; package entitlements still apply to admins.
  Browser RLS restricts each new table and forbids changes to quotas/settings/jobs/plan limits.
- Durable tenant/source/idempotency keys prevent duplicate jobs. Atomic quota reservation and
  SKIP LOCKED claims prevent multiple workers from processing the same job. Markers commit
  before provider and delivery calls. Provider/send uncertainty always requires manual review.
- A crash **before** the provider marker refunds the reservation and safely retries at most
  three local attempts. A crash **after** that marker never automatically replays the provider
  or customer dispatch. Only jobs which never started AI and no longer hold quota may be
  requeued by the owner. New file selection deliberately creates a new paid analysis request.
- Quota refunds before provider start are idempotent. Actual AI attempts, including ambiguous
  failures or invalid model output, count against the monthly limit. Slip and message credits
  are independently charged by the existing services; they do not buy Vision quota.
- DB audit logs record job state changes, rule changes, settings changes, safe retries and
  ingestion failures. Logs do not contain API keys, Page tokens or image URLs.

## Package policy

Existing confirmed access stays intact: Free image assistant remains locked; Starter and Pro
retain image rules; AI Agent remains Pro. The attachment's Free trial was an example, so no new
Free entitlement was silently granted. New Vision limits are database-owned defaults:

| Plan | Images per UTC calendar month | Catalog matching |
| --- | ---: | --- |
| Free | 0 (locked) | No |
| Starter | 100 | No |
| Pro | 1,000 | Yes, with `ai_agent` entitlement |

`vision_plan_limits` can be configured by a trusted DB administrator. Rerunning the migration
preserves configured limits. Existing broadcast/slip balances, paid-plan activation, prices,
customer data and existing image rules are never reset by this migration. Upgrades are picked
up from the real tenant plan/expiry; no fake payment path or client-controlled plan was added.

## APIs

| Route | Purpose | Access |
| --- | --- | --- |
| GET `/api/chatbot/vision?tenantId=...` | Usage/settings/latest jobs | Session + tenant + image feature |
| PATCH `/api/chatbot/vision` | Save mode/confidence/opt-in/handoff | Owner + DB feature; tenantId in JSON |
| POST `/api/chatbot/vision/test?tenantId=...` | Multipart file + UUID requestId, real classification preview | Session + tenant + feature + Vision quota |
| GET `/api/chatbot/vision/jobs/[id]/image?tenantId=...` | 60-second signed private image redirect | Session + tenant + feature |
| POST `/api/chatbot/vision/jobs/[id]/retry?tenantId=...` | Requeue only never-started work | Owner + DB feature + safe state |
| POST `/api/cron/vision` | Process one durable queued job | CRON_SECRET or INTERNAL_API_SECRET bearer |

The signed Facebook webhook queues images only when **both** the server automation flag and
the shop's Vision switch are enabled. When opted in, image + caption is handled by Vision only
to avoid duplicate text-bot replies. A disabled center preserves the legacy SlipOK image flow.
Failed image ingestion is audited and the original incoming image remains in Inbox; it does
not fall back to verifying an unclassified photo as a payment slip. A human can inspect it there.

## Files

Created:

- `supabase/ai-vision.sql`, `supabase/ai-vision-setup.md`
- `lib/features/vision/vision-types.ts`, `lib/features/vision/vision-image.ts`, `lib/features/vision/vision-provider.ts`, `lib/features/vision/vision-server.ts`, `lib/features/vision/vision.ts`
- `components/chatbot/VisionCenter.tsx`
- All five `/api/chatbot/vision` routes in the table above and `/api/cron/vision/route.ts`
- `scripts/test-ai-vision.cjs`, `scripts/test-ai-vision-sql.cjs`, this report

Modified:

- `app/(dashboard)/chatbot/images/page.tsx`
- `components/chatbot/ImageRulesClient.tsx`, `lib/features/vision/image-rules.ts`
- `app/api/webhook/facebook/route.ts`
- `.env.example` (safe off-by-default automation flag; `.env.local` was not changed)

## TESTED

- Unit/API/adapter/worker tests use mocked external providers; no real customer messages,
  payment verification or Gemini requests are sent during tests.
- PostgreSQL tests run the actual `image-response-rules.sql`, `feature-access.sql`, and
  `smart-inbox.sql` / `ai-vision.sql` migrations in isolated PGlite, including migration reruns, configured-limit
  preservation, Free/Starter/Pro, expiry, quota, recovery, handoff, tenant isolation and RLS.
- Combined Vision and regression suite: **93 tests passed**, including 20 Vision tests.
- Isolated PostgreSQL Vision suite: **25 scenarios passed**. Existing image-rule CRUD/RLS
  integration suite also passed separately.
- `npx.cmd tsc --noEmit`: passed. `npm.cmd run lint`: no errors, 10 existing warnings in
  other/previous code. `npm.cmd run build`: production compile/type checking succeeded.
- Production HTTP smoke checks: login 200; protected Vision page 307 to login; all five
  session-protected Vision route operations and the secret-protected cron endpoint returned
  401 without credentials. The temporary production test server was stopped afterwards.
- These checks do not claim equivalent results against a live Supabase project or Meta Page.

## BLOCKED / setup required before live use

No production deployment or database migration has been performed. Apply the migration to a
staging database, configure Gemini, verify actual image results, verify a test Page's token and
SlipOK receiving accounts, then configure the authenticated cron caller. Enabling production
automation requires the project owner's explicit authorization. Setup instructions are linked
in `supabase/ai-vision-setup.md`.

## NOT IMPLEMENTED / practical limits

- No Free trial, new Vision payment product/top-up or change to existing payments was added.
  Vision is monthly quota; existing broadcast/slip packs remain separate. Extra Vision allowance
  must currently be configured in `vision_plan_limits` by a trusted administrator.
- Catalog matching uses Gemini's image interpretation plus catalog text, not an embedding
  index or pixel comparison against all product photos. It is not guaranteed recognition.
  Confidence, real catalog ID validation and handoff constrain uncertain answers.
- No automatic resending of uncertain work. No automatic retries for an image that failed to
  download before a job existed; the ingestion audit and original Inbox image are available.
- No long-running external queue service or scheduler deployment was created. One worker call
  handles at most one image, which fits the existing serverless 60-second execution model.
- History shows the latest 30 jobs; a full retention/archival/automatic deletion policy and
  history pagination are not part of this change. Image storage remains private.
