# Realtime lifecycle investigation

An AST scan of 116 component/hook files found no `useEffect`/`useLayoutEffect` calls without a dependency argument. That alone does not exclude dependency feedback loops or a production problem.

Confirmed subscription churn risk: Inbox metadata refresh depended on the loaded customer-ID key, and the subscription effect depended on that refresh callback. Discovering customers therefore tore down/recreated the channel and immediately queried metadata again. The hook now keeps its tenant-scoped subscription stable and calls the latest refresh through a ref. Changed customer IDs schedule one debounced refresh without reopening the channel or resetting loaded state.

The main Inbox thread/channel effects also depended on the entire `tenant` prop object. They now depend on the primitive tenant ID, so server revalidation with equivalent tenant settings does not reset the thread and channel. Both effects still clean up on tenant change/unmount.

The installed `@supabase/ssr` implementation already defaults to a singleton in browsers. `supabaseBrowser` now adds an explicit browser-only cache and requests that singleton explicitly. SSR clients remain request-local. The separate login client intentionally uses custom cookie-lifetime behavior and is called from auth actions, not render effects; it was not replaced with a global session client.

Validation: `node --test scripts/test-realtime-lifecycle.cjs scripts/test-inbox-realtime.cjs scripts/test-background-refresh.cjs`. The lifecycle harness verifies repeated renders and changed customer lists keep one channel, tenant changes remove the old channel, and unmount clears listeners/timers. It also tests 100 browser client calls returning one instance and SSR calls returning separate instances.

Use `supabase/realtime-cpu-diagnostics.sql` to compare cumulative calls and execution times by database role, active connection/application counts and logical replication backlog without returning query bodies. Realtime uses logical replication and database authorization checks, so counts involving WAL/session setup are not themselves proof that React ran an infinite loop. Compare browser Network request/channel joins with database execution time and Realtime metrics before attributing the remaining load.

Sources: https://supabase.com/docs/reference/self-hosting-realtime and https://supabase.com/docs/guides/troubleshooting/high-cpu-usage. No remote metrics or production database were accessed by this review. No RLS, publication or Realtime service settings were disabled.
