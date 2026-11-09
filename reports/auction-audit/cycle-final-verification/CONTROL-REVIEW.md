# Live Auction: current controls and remaining UI work

This review follows the user's question about controlling counting, closing, and restarting from the dashboard. It distinguishes implemented code from live deployment evidence. No production SQL, Meta call, or credential inspection was performed.

| Requested behavior | Current state | Evidence |
| --- | --- | --- |
| Configure host counting tags | Implemented in the unified dashboard form; save is required | `components/live-cf/AuctionUnifiedForm.tsx:592`–601; API preserves and normalizes configured tags |
| Configure closing words | Implemented; words such as ปิด/x/custom text are matched for a recognized host | Unified form `:582`; `supabase/live-auction-auto-cycle.sql:19` host command classifier |
| Count 3 → 2 → 1 | Updates host_count; it does not itself close unless one of those tags is explicitly configured as a closing word | `scripts/test-auction-auto-cycle.cjs:21`; separate and multiline sequences tested |
| Close and immediately start the next round | Implemented atomically when autoCycleRounds is enabled and a saved template exists | Auto-cycle SQL `:40` successor helper and public comment RPC; tests cover a 200-baht successor, a second rollover, and rollback/replay |
| Stop automatic cycling | Implemented as a saved auto-cycle setting | Unified form `:603`–605; turning this off prevents the next successor. It does not immediately stop bids on the current round |
| Previous winner confirms while a new round receives bids | Implemented; only the locked winner invoices the old round | Real-parser/PGlite tests and server routing/outbox tests; active auto-cycled rounds cannot be invoiced before host closure |
| Count/close buttons directly on the current dashboard | **Not implemented in the unified form** | `/live-auction` renders LiveSessionDashboard (`app/(dashboard)/live-auction/page.tsx:25`), which renders AuctionUnifiedForm (`LiveSessionDashboard.tsx:511`). The direct host-action buttons are in the older LiveAuctionPanel component (`:513`–540), not this page's form |
| Immediate whole-session pause/stop button on the current dashboard | **Not implemented** | The active unified form offers configuration and save controls, not an immediate command/auction pause control. Pausing commands, closing a round, disabling the next cycle, and ending a session require distinct behavior and must not be treated as interchangeable |
| Confirmed operation on the active Supabase/Meta connection | **Unverified** | Local code and tests do not establish that the required migration chain was applied or that a live worker/provider connection is operating |

## What was completed in this verification pass

The engine already performed host closure → locked previous winner → one active successor. Review found a polling cutoff that could hide delayed old-winner confirmations while a newer round was active. The poller now also reads the oldest unconfirmed winner for the **same tenant/Page/video** and uses that round's start as an eligibility floor. The existing 20-second high-water overlap is preserved. Server/SQL still decide which auction owns each comment and enforce each round's stale boundary.

New tests first failed on the previous poller, then passed after the fix:

- Delayed confirmation remains eligible inside the overlap even if it predates the current active round.
- Pagination does not stop prematurely at the newer round boundary.
- Confirmed winners and foreign-tenant/other-live rounds do not widen the selected session window.

`targeted.log` records 49 passing checks, including the real SQL auto-cycle tests and server confirmation/outbox routing. Full-repository, typecheck, and build outcomes are recorded in `SUMMARY.md` and the adjacent evidence. Comments older than the bounded overlap are not guaranteed to be recovered; this does not implement the separately gated identity-unverified/durable recovery workflow.

## Release / completion assessment

The configurable engine is implemented, but the current dashboard is not a complete direct-control console. A requirement to click Count / Close / Stop immediately on that page still requires UI wiring and an explicit distinction between closing the current round with cycling, stopping future cycles, and pausing the whole session. This review does not claim those missing controls were added.

The required schema chain remains deadlines → audit 1 → audit 2 → manual-host-close → auto-cycle, after earlier prerequisites. Save the desired template and tags after the schema is installed. A live operator must confirm applied migrations, worker scheduling, and actual Meta permissions before live behavior can be asserted. Stored bootstrap bundles remain intentionally stale; regeneration is still a separate task.
