-- Apply only with database owner authorization. No deletes, resets or ledger refunds.
begin;
update public.agent_control_settings set flags=flags||'{"agent_control_center_enabled":false,"agent_orchestrator_enabled":false,"agent_knowledge_base_enabled":false,"agent_playground_enabled":false,"agent_analytics_enabled":false,"agent_advanced_guardrails_enabled":false}'::jsonb;
-- Preserve quota configuration, opt-out consent, ownership, knowledge, prompt history and usage.
notify pgrst,'reload schema';
commit;
