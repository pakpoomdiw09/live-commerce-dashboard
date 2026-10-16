# SnapBot Premium Business Command Center

## COMPLETED

The existing `/overview` is a server-rendered Next.js App Router page using the active tenant, Supabase, shared UI cards and the existing custom `RevenueChart`. It previously queried up to 5,000 slips for a fixed recent window. Its business values were based on accepted/approved slips, not bank reconciliation. The working tree already contained extensive changes from earlier tasks; these were retained.

The new view is an optional branch of that existing page. Sidebar, navigation, authentication, payment verification, providers, AI generation, message delivery and credit mutation logic are unchanged by this task. No dependency or UI library was added. There was no reference image attached to this request; the visual implementation follows the supplied written design and code outline.

Implemented:

- Orange/coral/pink dashboard with five KPIs, chart controls, verification donut, system observations, quick actions, recent slips, recent customer chats and AI summary.
- Bangkok-calendar 7/30/90-day filters and all-time monthly aggregation. The previous calendar period is available as an alternate chart view and summary. Today is partial; the UI says so. All-time has no fabricated comparison.
- Server-side scoped search for slip notes/customer names and current chat name/latest-message previews. Search does not alter the overall KPI/chart totals. It is deliberately labelled as scoped search, not a fabricated global search service.
- Ten records per list/page, deterministic timestamp/ID ordering and validated page 1–1000. Both lists share the dashboard page parameter; aggregate totals are not truncated to the displayed records.
- A read-only slip preview reuses the existing authenticated `/api/slips/[id]` endpoint. Chat links use the existing `/inbox?customer=...` route. Other actions use real `/slips`, `/shop`, `/broadcast`, `/analytics`, `/billing`, `/select-page` and `/settings` routes.
- Existing loading/error handling plus a five-card premium skeleton, explicit errors/locked states, accessible forms, descriptive icon buttons, text equivalents for charts, dialog keyboard trapping/Escape/restore-focus and Thai/Bangkok timestamps.
- User/session and tenant membership are checked before the new service aggregation. SQL checks active tenant and database-owned, unexpired feature entitlements. The service-only RPC is revoked from anonymous/authenticated roles. Frontend plan/tenant/credit overrides are not trusted.
- Customer names/chats/messages are withheld without `customer_management`; slip metrics/credits are withheld without `slip_auto_pilot`; AI summary is withheld without `ai_agent`. Cross-tenant customer joins cannot expose another shop's name.

## Data meaning

`reconciledRevenue` is **null**: there is no authoritative bank reconciliation ledger in the existing project. The UI displays `—` and explains this, rather than claiming accepted slips equal settled bank receipts.

The separate chart is explicitly **ยอดจากสลิปผ่าน / อนุมัติ**. It uses valid slips and approved amount-mismatch/wrong-receiver/fake/error slips; duplicate or pending slips are never accepted simply because they carry an approval timestamp. Numeric money summation happens in PostgreSQL, not the browser.

Donut groups are mutually exclusive: accepted/approved, pending (including unresolved amount/receiver mismatch), rejected (duplicate/fake) and provider/error. Their sum equals the selected period's total slips.

Message count includes all stored incoming/outgoing messages in the selected time window; it is not a provider delivery-success counter. Slip credits are the current `max(quota + top-up - used, 0)`, independently of the reporting window.

Chat previews show current latest message, unread count and ownership for customers active in the reporting window. Historical chat snapshots/older message search are not implied. AI sent replies/conversations/handoff routes come only from Agent Control jobs, not generic bot messages. AI credit usage is the current UTC month and is labelled separately from the report window. No analytics are invented for legacy AI activity that was never logged.

Health statuses distinguish successful database/balance reads at the snapshot time from untested external services. SlipOK, Gemini, Messenger and Broadcast remain **Unknown**, with explanations; no real provider was probed or labelled Online.

## Files created

- `components/overview/PremiumOverview.tsx`: client presentation, controls, charts/lists and read-only detail dialog.
- `components/overview/PremiumOverviewPage.tsx`: authenticated server integration and recoverable setup/error state.
- `lib/premium-overview-core.ts`: date/filter validation, types, `premium_overview_enabled` defaults and environment gate.
- `lib/premium-overview-server.ts`: session/tenant guard, aggregation adapter and honest health observations.
- `app/api/overview/route.ts`: private/no-store GET endpoint.
- `supabase/premium-overview.sql`: read-only service RPC and reuse of existing index names; safe to rerun.
- `supabase/premium-overview-setup.md`: local/staging enablement and rollback.
- `scripts/test-premium-overview.cjs`, `scripts/test-premium-overview-sql.cjs`, `scripts/check-premium-overview-browser.cjs`.
- This report.

## Files modified

- `app/(dashboard)/overview/page.tsx`: feature-gated branch; legacy body retained.
- `app/(dashboard)/overview/loading.tsx`: feature-gated premium skeleton; existing loading retained.
- `components/overview/RevenueChart.tsx`: optional orange style and count formatting; existing currency/green defaults retained.
- `.env.example`: appended new opt-in variable; **`.env.local` was not changed**.
- `scripts/test-dashboard-page-scope.cjs`: explicitly mock the new flag as false to exercise real legacy compatibility.

## APIs and database

New `GET /api/overview?tenantId=...&range=7|30|90|all&page=1&q=...` calls `premium_overview_summary` after validating a real dashboard user and membership. Responses are `private, no-store`; errors fail visibly instead of producing fake zeros.

The server-rendered page uses the same aggregation service directly. Existing `getActiveTenant`, `getTenants`, `requireDashboardUser`, `getActor` and `canAccessTenant` are reused. Detailed slips reuse `/api/slips/[id]`. No new writes, payment approvals, messages, external health requests or credits are triggered by the dashboard.

SQL reads existing tenants, slips, customers and messages. Agent Control tables are optional: missing job tables produce an AI empty state. There is no new business-data table and no production migration was applied.

## TESTED

- Combined new/existing regression suite: **187 passed**, 0 failed. Includes legacy Overview tenant switching/compatibility, billing, payment validation, Payment Pro, Inbox, quotas, AI, Vision and follow-up regression suites.
- Isolated real PostgreSQL engine/PGlite: **17 scenarios passed**. Covers exact numeric totals, Bangkok midnight boundaries, previous/all-time periods, partition totals, pagination, literal search inputs, missing AI tables, Free/Starter/Pro/expired entitlements, current credits, tenant isolation, restricted RPC roles and migration reruns.
- TypeScript `npx.cmd tsc --noEmit`: passed.
- ESLint: 0 errors; 10 existing warnings elsewhere.
- Production build: passed.
- Production HTTP smoke without a session: `/login` 200, `/overview` 307 to login, new `/api/overview` 401.
- Chrome headless offline rendering with real generated Tailwind CSS at **375, 768 and 1440 px**: five cards rendered, no horizontal page overflow, SVG widths bounded, transaction table scrolls inside its container. Screenshots inspected. These are isolated SSR layout fixtures, not a signed-in live-account end-to-end test.

No real SlipOK/Gemini/Messenger calls, production deployment, production migration or data deletion was performed during verification.

## BLOCKED / requires configuration

No remaining local implementation blocker. The real authenticated account/database integration and post-migration staging check have not been performed: the optional RPC must first be installed into the intended test database by its administrator. See setup instructions. The flag remains off by default as requested.

## NOT IMPLEMENTED

- Bank reconciliation / settled cash-receipt total: no authoritative source exists.
- Cross-module global search backend: the implemented search is scoped and labelled.
- Provider health probes: Unknown is shown instead.
- Popular-question clustering and unrecorded historical AI analytics: explicit empty state.
- Pixel-exact reference-image comparison: no reference image was supplied.
- Signed-in hydrated browser end-to-end tests against real tenant data; offline browser layout and server/SQL tests were run instead.

## Run and rollback

Use `supabase/premium-overview-setup.md`. Disable `PREMIUM_OVERVIEW_ENABLED` and restart to restore the existing page. Do not drop business tables, reset credits or alter existing secrets.
