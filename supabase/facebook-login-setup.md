# Facebook Login setup

1. Apply the existing schema migrations, including `platform.sql` and `security.sql`.
2. Run the entire `facebook-tenants.sql` file in the Supabase SQL editor as `postgres`. It runs transactionally, permits tenants without payment details, ensures a unique `page_id`, adds `page_name`, and installs the service-role-only Page upsert function. It is safe to re-run and fails without merging/deleting data if existing Page IDs are duplicated.
3. Enable the Facebook provider in Supabase Authentication and configure the Meta app ID and secret there.
4. In Supabase Authentication → URL Configuration, use the actual development origin for Site URL, e.g. `http://localhost:3000`. Add `http://localhost:3000/**` to Redirect URLs for local development (and the equivalent for another port or `127.0.0.1` only if used). The auth SDK can append an `sb_flow_id` query parameter. Use the Supabase provider callback URL shown in that dashboard, `https://<project-ref>.supabase.co/auth/v1/callback`, as Meta's Valid OAuth Redirect URI; this is different from the application's `/auth/callback`. Production needs its own allowlisted callback URL.
5. Ensure `.env.local` contains `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service role key is server-only.
6. The current OAuth scopes are `email,public_profile,pages_show_list,pages_messaging`; allow these permissions in the Meta app and select the Pages during Facebook consent. Facebook must supply a confirmed user email for Supabase account creation. In Meta development mode, the user needs an app role/tester invitation.

Both login and Page connection use the current browser origin plus `/auth/callback`. A short-lived cookie scoped to that callback remembers the internal destination. Start and finish OAuth on the same origin and browser so the PKCE verifier cookie is available. Do not switch between localhost and 127.0.0.1 or change ports during login.

The server exchanges the authorization code once and passes `sb_flow_id` when present so the matching PKCE verifier is used. Code-exchange/provider failures return safe, specific error categories to `/login`; raw codes, provider tokens and secrets are not logged or displayed. OAuth errors returned in the URL fragment are also translated on the login page. Page synchronization failures after a successful session exchange remain on `/select-page` rather than being presented as a failed login.

Troubleshooting: `oauth_email_missing` means Facebook did not supply an email; `pkce_code_verifier_not_found` or `bad_code_verifier` means restart login from the same origin/browser; `flow_state_expired`/`flow_state_not_found` means start a new login instead of refreshing the old callback; `missing_code` means inspect the redirect allowlist and start again. A populated `.env.local` alone cannot verify the Meta app secret or permissions; check Supabase Auth logs if the provider still rejects the flow.

References: [Supabase Facebook login](https://supabase.com/docs/guides/auth/social-login/auth-facebook), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [PKCE code exchange](https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession).

Run `node scripts/test-facebook-login.cjs` and `npx.cmd tsc --noEmit` to check the local callback/routing behavior without live credentials.

The callback exchanges the Supabase authorization code, reads `session.provider_token`, retrieves `/v19.0/me/accounts?fields=id,name,access_token,category` with cursor pagination, and upserts tenants by their unique `page_id`. Existing shop names, bank details, settings, and quotas are preserved. Only an existing tenant's owner or platform admin may refresh its Page token; another user cannot claim it. New tenants receive owner membership, no verification credits, and disabled automation until configured.

The callback reports database/Graph failures on `/select-page` without exposing tokens. No Pages or permissions produces a visible error. Selecting a Page continues through the existing active-tenant API. The previous direct Meta OAuth routes remain available for the existing manual connection workflow.

An authenticated browser can read `page_name` and `page_token_set`, but cannot read `page_access_token`. Running `security.sql` again retains the `page_name` grant after this migration.

End-to-end validation requires a real Facebook login and an applied migration: connect at least one Page, confirm its card appears, select it, reconnect to confirm there is no duplicate tenant, and verify payment details and quotas remain intact.

## Fix for database error 42501

The original function used the caller's privileges (`SECURITY INVOKER`) to read `auth.users`. On this project, `service_role` can call the function but cannot select that table, so the function fails with `42501: permission denied for table users` before saving any Pages.

The corrected function uses `SECURITY DEFINER`, is owned by `postgres`, and has an empty search path with fully qualified relations. Execute access remains revoked from `PUBLIC`, `anon`, and `authenticated`; only `service_role` may invoke it with Pages verified by the server callback. The change does not grant direct access to `auth.users` to the application or browser.

After running the migration, run `facebook-tenants-check.sql`. Confirm `security_definer = true`, owner `postgres`, and only `service_role_can_execute = true`; bank fields are nullable, Page IDs have a unique index, and RLS is enabled. `page_name_readable` must be true; `token_readable`, `browser_can_insert`, and `browser_can_update` must be false. The migration also requests a PostgREST schema-cache reload.

Then sign in again. The callback distinguishes database permission errors, missing schema, constraint errors, and Page ownership conflicts without exposing tokens in redirects or logs.

## Page card connection status

The Page picker reads `tenants` through the session/RLS client. `page_id` is the saved Page link, `page_token_set` indicates a stored token, `page_name` provides the saved display name, and `auto_reply_enabled` is only the automation switch. The raw `page_access_token` is read server-side in a batch and never passed to the card.

Connection verification uses Meta's read-only `/debug_token`: the token must be valid, be a Page token for the saved Page ID, and not be expired. `pages_messaging` determines whether messaging permissions are ready. Missing profile metadata permissions do not determine connection status; name/picture loading is decorative and uses the saved `page_name` on failure.

Cards distinguish missing Page, missing token, verified token, missing messaging permission, invalid token, and verification unavailable. Database/Meta outages and failed debug authorization are shown as unavailable, rather than claiming that a saved token is invalid. Verification prefers the configured Meta app ID/secret for debug authorization; if missing, it attempts the Page token and reports unavailable when Meta rejects the check.

The automation label means that automatic replies are enabled in settings. Neither that label nor successful token verification confirms webhook subscription or actual event delivery. The Supabase OAuth callback still does not subscribe webhooks; configure and verify message delivery separately in Meta.
