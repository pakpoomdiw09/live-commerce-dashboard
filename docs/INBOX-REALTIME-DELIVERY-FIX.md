# Inbox realtime delivery

The Inbox subscribes to message INSERT/UPDATE/DELETE events for the mounted
tenant session. RLS authorizes delivery; the selected customer ref routes events
to the current thread without recreating the channel on each selection.

Both subscription effects now depend only on the primitive tenantId. InboxClient
reads the current thread-loading callback through a ref; useInboxState already
uses a ref for its metadata refresh callback. Channel lifetime is independent of
tenant object identity, message arrays, selected room state and callback identity.
Room switching cancels thread requests but keeps the tenant-wide channel alive.
Cleanup runs on tenant changes or unmount (including React development Strict
Mode's initial cleanup/replay). Transport failures can separately trigger the
metadata hook's bounded reconnect routine.

test-inbox-render-lifecycle.cjs exercises the actual InboxClient through a
SUBSCRIBED update, 50 prop rerenders with new tenant objects, room switching and
message delivery, then verifies channel disposal on tenant change and unmount.
The server page's Inbox key is tenant ID, and PageTransition uses pathname; neither
was found to key the Inbox by a message array or random render-time value.

Each effect instance now owns a unique channel name. Asynchronous removal of an
old channel cannot reuse the new instance during navigation or Strict Mode
remounting. Disposed event callbacks and metadata status callbacks are ignored.

Channel naming does not depend on `crypto.randomUUID()`. Some browsers expose
that method only on secure origins, so using an HTTP LAN URL could throw before
the subscription was created. Both InboxClient and useInboxState now share a
non-security channel-name generator. Their fixtures run without crypto to cover
this startup failure. This does not establish the cause of a production outage.

Selected-thread messages are reconciled synchronously before customer hydration,
including customers outside the most recent 150-row snapshot. Duplicate event
IDs remain deduplicated. Metadata refresh debounce does not delay message state.

The metadata hook retries failed channels three times with 1/2/4-second delays
before enabling its 30-second polling fallback. It awaits removal of the retired
instance before replacing it, ignores retired callbacks, and cancels retry timers
on tenant changes/unmount. A successful subscription resets the retry budget;
online/visibility recovery can start another round after exhaustion. A 120-second
safety snapshot remains available during both connection and healthy operation.
This hook tracks customer/read metadata; InboxClient owns message subscriptions.

## Browser diagnostics

After loading `/inbox`, filter the browser console by `[DEBUG-REALTIME]`:

1. `Inbox effect mounted` identifies the active component and tenant. If absent,
   verify the running app/build and check client hydration errors. `/inbox` renders
   `SmartInboxV2`, which re-exports `InboxClient`; server profile logs do not prove
   that this client effect mounted.
2. `Creating channel` and `Subscribe invoked` prove registration was reached.
   `Channel Status` logs the SDK status and error for both the inbox and metadata
   channels. `ignored: true` means a callback belongs to a retired instance.
3. If no SUBSCRIBED status arrives in 15 seconds, a warning directs investigation
   to the WebSocket connection, browser session and Realtime service. This timer
   does not issue requests or recreate subscriptions.
4. `Message INSERT` logs the message/customer IDs and whether the current thread
   matches. Development also logs the full INSERT payload. Production omits
   message bodies. State reconciliation happens immediately in the callback.

Messages have `customer_id`, not `tenant_id`; their subscription has no tenant
filter. RLS remains enabled. Customer/slip filters use the tenant UUID serialized
as Supabase's `tenant_id=eq.<uuid>` syntax. Do not disable RLS to debug delivery.

Verification:

```sh
node --test scripts/test-inbox-realtime.cjs scripts/test-realtime-lifecycle.cjs
```

Tests cover incoming/outgoing messages, delivery updates, reconnect recovery,
pending customer hydration, channel remounts, stale callbacks, and stable
subscription counts across rerenders.

Production still requires messages in the supabase_realtime publication and
authenticated tenant RLS access. Check the browser's `[inbox/realtime] status`
log for SUBSCRIBED. If events never arrive, use inbox-delivery-diagnostics.sql
to inspect publication and access; inbox-realtime.sql adds missing publication
tables. These database checks and live Facebook delivery were not run locally.
