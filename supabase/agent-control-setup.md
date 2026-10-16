# Agent Control installation and rollback

1. Back up the database. Apply `agent-control.sql` **after** the existing feature-access, smart-inbox, smart-follow-ups and automation migrations, plus their dependencies. Review SQL in staging first. It is additive and rerunnable; no network calls are made by the migration.
2. Keep `AGENT_CONTROL_ENABLED=false`, `AGENT_CONTROL_SEND_ENABLED=false`, `AGENT_CONTROL_KILL_SWITCH=false` initially. These defaults were added only to `.env.example`. Existing secrets/model/environment values are unchanged.
3. Through a trusted SQL administrator, configure one intended tenant. Substitute a real tenant UUID and an approved monthly allocation; do not accept these values from a browser. The zero below intentionally keeps AI unavailable until an allocation is chosen.

```sql
insert into public.agent_control_settings(tenant_id,ai_monthly_limit,requests_per_minute,flags)
values ('REPLACE_WITH_TENANT_UUID'::uuid,0,10,
 '{"agent_control_center_enabled":true,"agent_orchestrator_enabled":false,"agent_knowledge_base_enabled":true,"agent_playground_enabled":true,"agent_analytics_enabled":true,"agent_advanced_guardrails_enabled":true}'::jsonb)
on conflict(tenant_id) do update set flags=excluded.flags;
```

The conflict branch preserves existing limits. Update `ai_monthly_limit` explicitly only after deciding its value. The application still requires an active, unexpired Pro entitlement from the database. No user/tenant package is changed by this setup.

4. Set `AGENT_CONTROL_ENABLED=true` and restart the application. Start with Control Center/knowledge/Playground only. Test tenant isolation, source facts, Keyword precedence and ownership in staging. No provider is used by Playground.
5. Enable `agent_orchestrator_enabled` in that tenant's flags only when ready. With live sending disabled, real incoming events become drafts; an enabled AI path can call Gemini and spend its configured AI quota. Handoff may pause the conversation. Do not use this mode as a no-provider sandbox.
6. Before live sending, test with a dedicated Page in production mode and explicitly set `AGENT_CONTROL_SEND_ENABLED=true`. Existing message credits and Inbox delivery checks still apply. Never test against real customers without authorization.
7. Schedule authenticated POST `/api/cron/agent-control` with the existing `CRON_SECRET`, or `INTERNAL_API_SECRET` when no cron secret is configured. Supply it in the Authorization bearer header. Do not place secrets in URLs or browser code. Recovery only marks uncertain work for review; it never automatically resends.

## Emergency stop and rollback

- Set `AGENT_CONTROL_KILL_SWITCH=true` and restart to stop AI generation on both new and legacy AI entry points. Disable live sends as well.
- To revert to existing routing, execute `agent-control-rollback.sql`, then set `AGENT_CONTROL_ENABLED=false`, `AGENT_CONTROL_SEND_ENABLED=false` and restart. The rollback disables all six tenant flags while preserving knowledge, versions, quota balances, usage, ownership and consent. No tables are dropped and no deliveries are replayed.
- The consent trigger reads the tenant database flag. For a complete rollback, disable that flag using the rollback SQL as well as the environment master. Existing STOP consent remains enforced; do not erase it or resume customers automatically.
- Inspect pending/unknown deliveries manually before changing routing. Existing shared delivery IDs protect against ordinary duplicate sends, but uncertain network outcomes require human review.

## Local checks

```powershell
node --test scripts/test-agent-control.cjs
# Use an isolated PGlite installation; no live Supabase credentials required.
node scripts/test-agent-control-sql.cjs PATH_TO_PGLITE_MODULE
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
```

No migration or live flag was applied by the implementation session. See `docs/agent-control-implementation.md` for scope, regression results and remaining integration checks.
