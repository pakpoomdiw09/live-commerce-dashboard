-- ADMIN-ONLY QA GRANT for the exact tenant requested by the shop owner.
-- This is a test entitlement, NOT evidence of money received. No payment receipt is fabricated.
-- Run after ai-paid-access.sql. Preserves existing usage, later expiry and message/slip credits.
begin;
do $$
declare
 target constant uuid := '0f06ad7b-2b24-4a5a-87ad-a503753c0805';
 test_request constant uuid := 'a94b8668-ec6e-42f8-b4b3-85ad9a644618';
 audit_key constant uuid := 'd445fd56-375b-4c23-a0b0-bf72ef6dbbfb';
 t public.tenants; used_count integer; previous_settings jsonb;
begin
 select * into t from public.tenants where id=target for update;
 if not found or t.name<>'ดิว ไลฟ์สดพระเครื่อง 159' or not t.is_active then raise exception 'Requested test tenant not found or inactive';end if;
 if exists(select 1 from public.agent_control_audit where id=audit_key) then
   raise notice 'Test grant already applied; balances were not replenished';return;
 end if;
 if exists(select 1 from public.billing_requests where id=test_request and tenant_id<>target) then raise exception 'Test request ID belongs to another tenant';end if;
 select to_jsonb(s) into previous_settings from public.agent_control_settings s where tenant_id=target;
 select used into used_count from public.agent_ai_monthly_usage where tenant_id=target and month=date_trunc('month',timezone('UTC',now()))::date for update;
 update public.tenants set plan='pro',plan_expires_at=greatest(plan_expires_at,now()+interval '30 days') where id=target;
 -- Nominal catalog values identify the test package; no collected-payment record or broadcast balance is created.
 insert into public.billing_requests(id,tenant_id,item,price_baht,credits,status,note,decided_at)
 values(test_request,target,'pro',19,7500,'approved','[QA_TEST_AI_PRO_2026_10_17] สิทธิ์ Pro สำหรับทดสอบตามคำขอเจ้าของร้าน ไม่ใช่การรับเงินจริง และไม่ได้เพิ่มเครดิตบรอดแคสต์',now())
 on conflict(id) do nothing;
 insert into public.agent_control_settings(tenant_id,ai_monthly_limit,flags)
 values(target,coalesce(used_count,0)+1000,'{"agent_control_center_enabled":true,"agent_orchestrator_enabled":true,"agent_knowledge_base_enabled":true,"agent_playground_enabled":true,"agent_analytics_enabled":true,"agent_advanced_guardrails_enabled":true}')
 on conflict(tenant_id) do update set ai_monthly_limit=greatest(public.agent_control_settings.ai_monthly_limit,excluded.ai_monthly_limit),
 flags=excluded.flags||public.agent_control_settings.flags||'{"agent_control_center_enabled":true,"agent_orchestrator_enabled":true}';
 insert into public.agent_control_audit(id,tenant_id,event,detail)
 values(audit_key,target,'qa_test_entitlement_granted',jsonb_build_object('reason','Owner-requested QA entitlement; no funds received','test_request',test_request,'before_plan',t.plan,'before_expiry',t.plan_expires_at,'before_settings',previous_settings,'remaining_ai_at_least',1000)::text);
end $$;
commit;

select t.id,t.name,t.plan,t.plan_expires_at,s.ai_monthly_limit,
 coalesce(u.used,0) as ai_used,s.ai_monthly_limit-coalesce(u.used,0) as ai_remaining,
 public.tenant_has_paid_ai_access(t.id) as approved_entitlement
from public.tenants t join public.agent_control_settings s on s.tenant_id=t.id
left join public.agent_ai_monthly_usage u on u.tenant_id=t.id and u.month=date_trunc('month',timezone('UTC',now()))::date
where t.id='0f06ad7b-2b24-4a5a-87ad-a503753c0805';
