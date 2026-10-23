-- Optional Premium Overview aggregation. Run after security.sql, feature-access.sql,
-- customer-profiles.sql and smart-inbox.sql. No network calls or data mutations.
begin;
create or replace function public.premium_overview_summary(
 p_tenant uuid,p_from timestamptz,p_to timestamptz,p_previous timestamptz default null,
 p_page integer default 1,p_query text default ''
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare slips_allowed boolean;customers_allowed boolean;ai_allowed boolean;result jsonb;
 slip_data jsonb:='{}';chat_data jsonb:='{}';ai_data jsonb;bucket text;
begin
 -- Service-only RPC: the application checks session and tenant membership before invoking it.
 if p_to is null or p_to>now()+interval '2 minutes' or p_from>p_to or p_previous>p_from
  or p_page is null or p_page not between 1 and 1000 or length(coalesce(p_query,''))>100 then
  raise exception 'Invalid dashboard filters' using errcode='22023';
 end if;
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) then raise exception 'Tenant unavailable' using errcode='42501';end if;
 slips_allowed:=public.has_tenant_feature(p_tenant,'slip_auto_pilot');
 customers_allowed:=public.has_tenant_feature(p_tenant,'customer_management');
 ai_allowed:=public.has_tenant_feature(p_tenant,'ai_agent');
 bucket:=case when p_from is null then 'month' else 'day' end;
 if slips_allowed then
  with scoped as(
   select s.*,case when s.status='valid' or (s.approved_at is not null and s.status in ('amount_mismatch','wrong_receiver','fake','error')) then 'passed'
    when s.status in ('pending','amount_mismatch','wrong_receiver') then 'pending' when s.status='error' then 'error' else 'rejected' end outcome
   from public.slips s where s.tenant_id=p_tenant and (p_from is null or s.created_at>=p_from) and s.created_at<p_to
  ), matched as(
   select s.id,s.created_at,case when customers_allowed then c.display_name else null end customer,s.amount,s.outcome result,s.note
   from scoped s left join public.customers c on customers_allowed and c.id=s.customer_id and c.tenant_id=p_tenant
   where coalesce(p_query,'')='' or strpos(lower(coalesce(s.note,'')),lower(p_query))>0 or (customers_allowed and strpos(lower(coalesce(c.display_name,'')),lower(p_query))>0)
  ), previous as(
   select count(*) total,count(*) filter(where status='valid' or (approved_at is not null and status in ('amount_mismatch','wrong_receiver','fake','error'))) approved,
    coalesce(sum(amount) filter(where status='valid' or (approved_at is not null and status in ('amount_mismatch','wrong_receiver','fake','error'))),0) amount
   from public.slips where tenant_id=p_tenant and p_previous is not null and created_at>=p_previous and created_at<p_from
  ), current_days as(
   select date_trunc(bucket,created_at at time zone 'Asia/Bangkok') as bucket_at,count(*) count,coalesce(sum(amount) filter(where outcome='passed'),0) amount from scoped group by 1
  ), previous_days as(
   select (created_at at time zone 'Asia/Bangkok')::date+((p_from at time zone 'Asia/Bangkok')::date-(p_previous at time zone 'Asia/Bangkok')::date) as bucket_at,
    count(*) count,coalesce(sum(amount) filter(where status='valid' or (approved_at is not null and status in ('amount_mismatch','wrong_receiver','fake','error'))),0) amount
   from public.slips where tenant_id=p_tenant and p_previous is not null and created_at>=p_previous and created_at<p_from group by 1
  ), days as(
   select generate_series(coalesce(date_trunc(bucket,p_from at time zone 'Asia/Bangkok'),(select min(bucket_at) from current_days)),date_trunc(bucket,p_to at time zone 'Asia/Bangkok'),case when bucket='month' then interval '1 month' else interval '1 day' end) as bucket_at
  ) select jsonb_build_object(
   'totalSlips',(select count(*) from scoped),'approved',(select count(*) from scoped where outcome='passed'),
   'pending',(select count(*) from scoped where outcome='pending'),'verifiedSlipAmount',(select coalesce(sum(amount),0) from scoped where outcome='passed'),
   'results',(select jsonb_build_object('passed',count(*) filter(where outcome='passed'),'pending',count(*) filter(where outcome='pending'),'rejected',count(*) filter(where outcome='rejected'),'error',count(*) filter(where outcome='error')) from scoped),
   'previous',case when p_previous is null then null else (select jsonb_build_object('approved',approved,'totalSlips',total,'verifiedSlipAmount',amount) from previous) end,
   'series',(select coalesce(jsonb_agg(jsonb_build_object('day',to_char(d.bucket_at,'YYYY-MM-DD'),'count',coalesce(c.count,0),'amount',coalesce(c.amount,0),'previousCount',case when p_previous is null then null else coalesce(p.count,0) end,'previousAmount',case when p_previous is null then null else coalesce(p.amount,0) end) order by d.bucket_at),'[]') from days d left join current_days c using(bucket_at) left join previous_days p on p.bucket_at=d.bucket_at::date),
   'slipMatches',(select count(*) from matched),'slips',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from matched order by created_at desc,id limit 10 offset (p_page-1)*10) r)
  ) into slip_data;
 end if;
 if customers_allowed then
  with scoped as(
   -- Legacy installations may store unread_count; Smart Inbox derives it per user.
   -- Do not require a column that the current fresh-install schema never creates.
   select c.id,c.display_name name,c.avatar_url,c.last_message_at,
    coalesce((to_jsonb(c)->>'unread_count')::integer,0) unread_count,
    case when c.assigned_user_id is not null then 'แอดมินรับแชท' when c.bot_enabled then 'บอท' else 'รอแอดมิน' end owner,m.body
   from public.customers c left join lateral(select body from public.messages where customer_id=c.id order by created_at desc,id desc limit 1)m on true
   where c.tenant_id=p_tenant and (p_from is null or c.last_message_at>=p_from) and c.last_message_at<p_to
  ), matched as(select * from scoped where coalesce(p_query,'')='' or strpos(lower(coalesce(name,'')||' '||coalesce(body,'')),lower(p_query))>0)
  select jsonb_build_object('messages',(select count(*) from public.messages m join public.customers c on c.id=m.customer_id where c.tenant_id=p_tenant and (p_from is null or m.created_at>=p_from) and m.created_at<p_to),
   'chatMatches',(select count(*) from matched),'chats',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from matched order by last_message_at desc,id limit 10 offset (p_page-1)*10)r)) into chat_data;
 end if;
 if ai_allowed and to_regclass('public.agent_message_jobs') is not null then
  execute $q$select jsonb_build_object('replies',count(*) filter(where route='AI' and status='sent'),'conversations',count(distinct customer_id) filter(where route='AI' and status='sent'),'handoffs',count(*) filter(where route='ADMIN'),'usage',null,'limit',null) from public.agent_message_jobs where tenant_id=$1 and ($2 is null or created_at>=$2) and created_at<$3$q$ into ai_data using p_tenant,p_from,p_to;
  if to_regclass('public.agent_ai_monthly_usage') is not null then
   execute $q$select $1||jsonb_build_object('usage',coalesce((select used from public.agent_ai_monthly_usage where tenant_id=$2 and month=date_trunc('month',now() at time zone 'UTC')::date),0),'limit',(select ai_monthly_limit from public.agent_control_settings where tenant_id=$2))$q$ into ai_data using ai_data,p_tenant;
  end if;
 end if;
 select jsonb_build_object('shop',jsonb_build_object('id',id,'name',name),'updatedAt',now(),
  'access',jsonb_build_object('slips',slips_allowed,'customers',customers_allowed,'ai',ai_allowed),
  'metrics',jsonb_build_object('reconciledRevenue',null,'messages',chat_data->'messages','approved',slip_data->'approved','totalSlips',slip_data->'totalSlips','pending',slip_data->'pending',
   'verifiedSlipAmount',slip_data->'verifiedSlipAmount','slipCredits',case when slips_allowed then greatest(0,slip_quota::bigint+slip_quota_credits::bigint-slip_used::bigint) else null end),
  'previous',slip_data->'previous','results',slip_data->'results','series',coalesce(slip_data->'series','[]'),'bucket',bucket,
  'slips',coalesce(slip_data->'slips','[]'),'slipMatches',coalesce(slip_data->'slipMatches','0'),'chats',coalesce(chat_data->'chats','[]'),'chatMatches',coalesce(chat_data->'chatMatches','0'),'ai',ai_data)
 into result from public.tenants where id=p_tenant;
 return result;
end $$;
revoke all on function public.premium_overview_summary(uuid,timestamptz,timestamptz,timestamptz,integer,text) from public,anon,authenticated;
grant execute on function public.premium_overview_summary(uuid,timestamptz,timestamptz,timestamptz,integer,text) to service_role;
-- Reuse the index names from tenants.sql / platform.sql; avoid duplicate indexes.
create index if not exists slips_tenant on public.slips(tenant_id,created_at desc);
create index if not exists customers_tenant on public.customers(tenant_id,last_message_at desc);
notify pgrst,'reload schema';
commit;
