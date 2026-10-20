-- Apply after smart-follow-ups.sql. Uses the existing enqueue and pre-send guards.
begin;
alter table public.follow_up_jobs add column if not exists manual_without_order boolean not null default false;
create unique index if not exists follow_up_manual_open_step
 on public.follow_up_jobs(tenant_id,customer_id,kind,step)
 where manual_without_order and status in ('pending','processing','requires_review');
create or replace function public.add_manual_follow_up(p_tenant uuid,p_actor uuid,p_customer uuid,p_kind text,p_reference uuid default null)
returns setof public.follow_up_jobs
language plpgsql security definer set search_path=pg_catalog,public as $$
declare source uuid; existing_ids uuid[]; c public.customers; w public.follow_up_workflows; st jsonb; n integer:=0; anchor timestamptz:=clock_timestamp();
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_kind not in ('payment','interested','after_sales') or p_kind is null then raise exception 'Invalid kind' using errcode='22023';end if;
 -- Same lock order as dispatch. Existing unique source/order indexes make retries idempotent.
 perform 1 from public.tenants where id=p_tenant for update;
 perform 1 from public.customers where id=p_customer and tenant_id=p_tenant for update;
 if not found then raise exception 'Invalid customer' using errcode='22023';end if;
 if p_reference is null then
  select * into c from public.customers where id=p_customer and tenant_id=p_tenant;
  select * into w from public.follow_up_workflows where tenant_id=p_tenant and kind=p_kind and enabled;
  if w.id is null or not exists(select 1 from public.follow_up_policies where tenant_id=p_tenant and enabled)
   or c.followup_opted_out or c.contact_suspended or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed'
   or (p_kind<>'payment' or w.use_ai) and not public.has_tenant_feature(p_tenant,'ai_agent') then return;end if;
  for st in select value from jsonb_array_elements(w.steps) loop
   n:=n+1;
   insert into public.follow_up_jobs(tenant_id,customer_id,kind,workflow_id,workflow_version,step,text,run_at,anchor_at,source_seq,status,manual_without_order)
   values(p_tenant,p_customer,p_kind,w.id,w.version,n,
    'สวัสดีค่ะ ขออนุญาตติดตามนะคะ หากต้องการข้อมูลหรือความช่วยเหลือเพิ่มเติม แจ้งได้เลยค่ะ',
    anchor+make_interval(mins=>(st->>'delay_minutes')::integer),anchor,c.inbound_seq,'pending',true)
   on conflict do nothing;
  end loop;
  return query select j.* from public.follow_up_jobs j where j.tenant_id=p_tenant and j.customer_id=p_customer
   and j.kind=p_kind and j.manual_without_order and j.status in ('pending','processing','requires_review') order by j.step;
  return;
 end if;
 if p_kind='interested' then
  select id into source from public.messages where customer_id=p_customer and sender='customer'
   order by created_at desc,id desc limit 1;
 end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into existing_ids from public.follow_up_jobs
 where tenant_id=p_tenant and customer_id=p_customer and kind=p_kind
  and ((p_kind='interested' and source_message_id=source) or (p_kind<>'interested' and order_id=p_reference));
 perform public.enqueue_follow_up(p_tenant,p_customer,p_kind,
  case when p_kind<>'interested' then p_reference end,source,
  case when p_kind='interested' then p_reference end);
 -- New manual entries start pending; AI approval is still enforced by prepare_follow_up.
 update public.follow_up_jobs set status='pending',reason=null
 where tenant_id=p_tenant and customer_id=p_customer and kind=p_kind
  and not (id=any(existing_ids)) and status='requires_review' and reason='ai_draft';
 return query select j.* from public.follow_up_jobs j
 where j.tenant_id=p_tenant and j.customer_id=p_customer and j.kind=p_kind
  and ((p_kind='interested' and j.source_message_id=source and j.product_id=p_reference)
    or (p_kind<>'interested' and j.order_id=p_reference))
  and j.status in ('pending','requires_review') order by j.step;
end $$;
revoke all on function public.add_manual_follow_up(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.add_manual_follow_up(uuid,uuid,uuid,text,uuid) to service_role;

-- Extend installed worker gates without replacing any other deployed safety checks.
-- Supports both the base prepare function and the stronger presend migration.
do $$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('public.prepare_follow_up(uuid,uuid)'::regprocedure);
 updated:=replace(definition,
  'if reason is null and j.kind in (''payment'',''after_sales'') then',
  'if reason is null and j.kind in (''payment'',''after_sales'') and not j.manual_without_order then');
 updated:=replace(updated,
  'if reason is null and w.use_ai and not j.ai_approved then',
  'if reason is null and (w.use_ai or j.manual_without_order) and not j.ai_approved then');
 updated:=replace(updated,'elsif reason is null and j.kind=''interested'' then',
  'elsif reason is null and j.kind=''interested'' and not j.manual_without_order then');
 if updated=definition and position('or j.manual_without_order' in definition)=0 then
  raise exception 'Unsupported prepare_follow_up definition; manual migration not applied';
 end if;
 execute updated;
 if to_regprocedure('public.authorize_follow_up_dispatch(uuid,uuid)') is not null then
  definition:=pg_get_functiondef('public.authorize_follow_up_dispatch(uuid,uuid)'::regprocedure);
  updated:=replace(definition,'if block_reason is null and j.kind=''payment'' then',
   'if block_reason is null and j.kind=''payment'' and not j.manual_without_order then');
  if updated=definition and position('not j.manual_without_order' in definition)=0 then
   raise exception 'Unsupported authorize_follow_up_dispatch definition; manual migration not applied';
  end if;
  -- Approval also remains mandatory at the final network gate.
  if position('j.manual_without_order and not j.ai_approved' in updated)=0 then
   if position('if block_reason is null and (c.last_message_at is null' in updated)=0 then
    raise exception 'Unsupported dispatch approval gate; manual migration not applied';
   end if;
   updated:=replace(updated,'if block_reason is null and (c.last_message_at is null',
    'if block_reason is null and j.manual_without_order and not j.ai_approved then block_reason:=''ai_draft'';next_status:=''requires_review'';end if; if block_reason is null and (c.last_message_at is null');
  end if;
  execute updated;
 end if;
end $$;
commit;
