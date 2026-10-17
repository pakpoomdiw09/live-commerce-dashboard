# Inbox V2 routing check

- `/inbox` has one route: `app/(dashboard)/inbox/page.tsx` (route groups do not change the URL).
- It renders `SmartInboxV2` from `components/inbox/SmartInboxV2.tsx`, a direct export of the V2 state owner in `InboxClient.tsx`.
- The rendered tree uses `InboxProCenter`, `ChatList`, `Conversation`, and `Inspector` directly, with no Legacy imports or V2 feature switches. Legacy source files are retained but not reached by this route.
- The root contains `data-inbox-version="v2"` and the heading displays **Smart Inbox V2**.
- Previously the header was conditional on a successful `/api/inbox/state` response. It now remains visible during loading/failure, with an explicit retry button. This could make V2 look like the older screen when state loading failed; it does not prove that this was the cause in the user's browser.
- Auth, tenant entitlements, API authorization, and Messenger policy checks remain in place. A setup/feature-lock/error screen is not a Legacy fallback.

## Cache and runtime

The route is `force-dynamic`, state requests are `no-store`, and there is no service worker or inbox rewrite in the inspected app. `next.config.mjs` separates `.next-dev` (development) from `.next` (production). The existing development cache `.next-dev/cache` was cleared, then a fresh production build was run. Generated route files confirmed no `ChatListLegacy` reference in the development inbox entry.

If a browser still shows a screen without the V2 badge, check that its hostname/port serves this workspace. Restart its development server with `npm run dev`, then hard refresh (`Ctrl+Shift+R`). A remote deployment must be rebuilt/redeployed; local changes do not update it. No logged-in user browser session or remote deployment was accessed during these checks.

## Verification

Typecheck and API/SQL/Realtime regression tests; production build; offline Chrome with the actual SmartInboxV2 entry. Browser checks cover version marker, failure/retry of state loading, notes/stars/bulk claim, event replay, race conditions, and 375/768/1440px layouts. No real customer messages are sent.
