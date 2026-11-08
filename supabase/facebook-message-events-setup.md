# Messenger outgoing history and receipts

Apply `facebook-message-echoes.sql` after `facebook-message-window.sql` and `smart-inbox.sql`.
The migration is also appended to the generated schema registry. It adds a service-only,
webhook-lease-checked echo RPC, preserves delivered/read status against late send responses,
and adds existing Inbox tables to the `supabase_realtime` publication.

Deploy the matching application code, then reconnect the Page in the dashboard. Both Facebook
login callbacks subscribe `messages`, `messaging_postbacks`, `message_echoes`, `message_reads`,
`message_deliveries` and `feed`. Subscription failures are surfaced instead of reported as success.
The Meta app's Page webhook configuration must also enable those fields.

The root `/webhook` URL and `/api/webhook/facebook` share signature verification and durable
queueing. The root alias bypasses browser-session middleware. HTTP 200 is returned after a
successful queue commit, before profile lookup/AI/message handling; a failed commit returns 503
so Meta can retry. An unlinked Page's inbound event retries with `PAGE_NOT_LINKED` instead of
creating a customer with `tenant_id=null`.

Tokens are loaded from `tenants.page_access_token`, with the shared environment token permitted
only for the matching `FB_PAGE_ID`. Run `node scripts/check-facebook-tokens.cjs` for read-only
expiry, Page, application and messaging-scope diagnostics. An expired token or a token from the
previous Facebook App must be reauthorized. Token/profile failure does not block inbound storage.

Existing Page subscriptions can alternatively be repaired with:

```powershell
node scripts/subscribe-page.cjs --page-id YOUR_PAGE_ID
```

The script uses the stored Page token; it does not send messages. Never paste tokens into commands.
Run `inbox-delivery-diagnostics.sql` to check publication, RLS and queue state without reading message bodies.

Incoming conversations use `messages.customer_id`, not a separate `conversation_id` column.
The browser already listens to `messages` INSERT/UPDATE through Supabase Realtime and selects the
active customer locally. No Socket.io, SSE or Pusher emitter is required.

Echoes never reach AI, unread counters or inbound 24-hour-window updates. Native Page replies
are recorded as outgoing agent messages. App sends carry `snapbot:<external_id>` metadata, allowing
an early echo to update the existing durable row. Unmatched echoes from this app are logged and
ignored rather than guessed from message text or duplicated. Older sends without metadata may
therefore need the existing Messenger sync action.

Verify with one buyer message, one reply from Meta's Page Inbox, and one reply from the dashboard.
Then read the dashboard reply as the buyer: the same row should advance sent → delivered → read.
Reconnect the dashboard and confirm neither the echo nor a late send response duplicates or
downgrades that row. Echoes and receipts must not increase unread counts or renew the service window.
