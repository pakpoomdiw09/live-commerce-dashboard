-- Apply after follow-up-simplified.sql. Saves only the requested workflow/step.
begin;
create or replace function public.save_follow_up_workflow(p_tenant uuid,p_actor uuid,p_kind text,p_version integer,p_index integer,p_steps jsonb,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.follow_up_workflows; merged jsonb; st jsonb; previous integer:=0; delay integer;
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not (
  exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor)
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_kind not in ('payment','interested','after_sales') or p_kind is null or p_version is null
  or jsonb_typeof(p_steps) is distinct from 'array' or jsonb_typeof(p_config) is distinct from 'object'
  or jsonb_typeof(p_config->'enabled') is distinct from 'boolean' or jsonb_typeof(p_config->'use_ai') is distinct from 'boolean'
  or jsonb_typeof(p_config->'stop_on_reply') is distinct from 'boolean' then raise exception 'Invalid settings' using errcode='22023';end if;
 if ((p_kind<>'payment' and (p_config->>'enabled')::boolean) or (p_config->>'use_ai')::boolean)
  and not public.has_tenant_feature(p_tenant,'ai_agent') then raise exception 'Feature locked' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into w from public.follow_up_workflows where tenant_id=p_tenant and kind=p_kind for update;
 if coalesce(w.version,0)<>p_version then raise exception 'Workflow changed' using errcode='40001';end if;
 if p_index is null then merged:=p_steps;
 else
  if p_index<0 or p_index>2 or p_index>coalesce(jsonb_array_length(w.steps),0) or jsonb_array_length(p_steps)<>1 then raise exception 'Save preceding steps first' using errcode='22023';end if;
  merged:=jsonb_set(coalesce(w.steps,'[]'::jsonb),array[p_index::text],p_steps->0,true);
 end if;
 if jsonb_array_length(merged) not between 1 and 3 then raise exception 'Invalid step count' using errcode='22023';end if;
 for st in select value from jsonb_array_elements(merged) loop
  if jsonb_typeof(st->'delay_minutes') is distinct from 'number' or jsonb_typeof(st->'text') is distinct from 'string'
   or (st->>'delay_minutes')!~'^\d+$' then raise exception 'Invalid step' using errcode='22023';end if;
  delay:=(st->>'delay_minutes')::integer;
  if delay<=previous or delay>43200 or length(trim(st->>'text')) not between 1 and 2000 then raise exception 'Invalid step values' using errcode='22023';end if;
  previous:=delay;
 end loop;
 insert into public.follow_up_workflows(tenant_id,kind,enabled,use_ai,stop_on_reply,steps)
 values(p_tenant,p_kind,(p_config->>'enabled')::boolean,(p_config->>'use_ai')::boolean,case when p_kind='interested' then true else (p_config->>'stop_on_reply')::boolean end,merged)
 on conflict(tenant_id,kind) do update set enabled=excluded.enabled,use_ai=excluded.use_ai,stop_on_reply=excluded.stop_on_reply,steps=excluded.steps,version=follow_up_workflows.version+1
 returning * into w;
 update public.follow_up_jobs set status='cancelled',reason='workflow_changed',claim_token=null,claim_until=null
 where tenant_id=p_tenant and workflow_id=w.id and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 return to_jsonb(w);
end $$;
revoke all on function public.save_follow_up_workflow(uuid,uuid,text,integer,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_follow_up_workflow(uuid,uuid,text,integer,integer,jsonb,jsonb) to service_role;
commit;
