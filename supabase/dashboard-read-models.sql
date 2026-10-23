-- Apply after platform.sql, feature-access.sql, agent-control.sql and smart-inbox.sql.
-- Read-only RPCs. Service role only: application callers must authorize tenant membership.
begin;

-- Reuse the existing Inbox index name and sort order.
create index if not exists inbox_customers_recent on public.customers(tenant_id,last_message_at desc nulls last,id desc);
create index if not exists dashboard_valid_customer_slips on public.slips(tenant_id,customer_id) include(amount) where status='valid';
create index if not exists overview_slips_time on public.slips(tenant_id,created_at desc,id);
create index if not exists dashboard_agent_period on public.agent_message_jobs(tenant_id,created_at desc,id) include(route,status,customer_id,updated_at);
create index if not exists dashboard_agent_lifetime on public.agent_message_jobs(tenant_id,customer_id) where route='AI' and status='sent';

create or replace function public.customer_directory(
  p_tenant uuid,
  p_page integer default 1,
  p_query text default '',
  p_status text default 'all',
  p_tag text default ''
)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant and is_active)
 or not public.has_tenant_feature(p_tenant,'customer_management') then raise exception 'Forbidden' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 100000 or p_query is null or length(p_query)>100
 or p_tag is null or length(p_tag)>100 or p_status is null or p_status not in ('all','new','pending_review','paid','approved','shipped') then
 raise exception 'Invalid filters' using errcode='22023';end if;
 with matched as materialized (
  select c.id
  from public.customers c where c.tenant_id=p_tenant
  and (p_status='all' or c.order_status=p_status)
  and (p_tag='' or p_tag=any(c.tags))
  and (p_query='' or strpos(lower(coalesce(c.display_name,'ผู้ใช้ ...'||right(c.platform_user_id,4))),lower(p_query))>0
   or strpos(coalesce(c.phone,''),p_query)>0 or strpos(lower(coalesce(c.address,'')),lower(p_query))>0)
 ), meta as (
  select count(*) total,greatest(1,ceil(count(*)/50.0)::integer) pages from matched
 ), selected as materialized (
  select c.id,c.display_name,c.avatar_url,c.platform_user_id,c.last_message_at,c.phone,c.address,c.tags,c.order_status
  from public.customers c join matched m on m.id=c.id
  where c.tenant_id=p_tenant order by c.last_message_at desc nulls last,c.id desc
  limit 50 offset (select (least(p_page,pages)-1)*50 from meta)
 ), paid as (
  select s.customer_id,sum(coalesce(s.amount,0)) amount,count(*) n
  from public.slips s join matched m on m.id=s.customer_id
  where s.tenant_id=p_tenant and s.status='valid' group by s.customer_id
 )
 select jsonb_build_object(
   'rows', coalesce((
     select jsonb_agg(
       to_jsonb(c) || jsonb_build_object(
         'paidTotal', coalesce(p.amount, 0),
         'paidCount', coalesce(p.n, 0)
       ) order by c.last_message_at desc nulls last, c.id desc
     )
     from selected c left join paid p on p.customer_id = c.id
   ), '[]'::jsonb),
   'total', (select total from meta),
   'page', (select least(p_page, pages) from meta),
   'pages', (select pages from meta),
   'pageSize', 50,
   'totalPaid', coalesce((select sum(amount) from paid), 0),
   'tags', coalesce((
     select jsonb_agg(tag order by tag)
     from (
       select distinct unnest(tags) tag from public.customers where tenant_id = p_tenant
     ) t where tag is not null
   ), '[]'::jsonb)
 ) into answer;
 return answer;
end $$;

create or replace function public.agent_overview_stats(
  p_tenant uuid,
  p_days integer,
  p_now timestamptz
)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;start_at timestamptz;
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant and is_active) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_days is null or p_days not in (7,30,90) or p_now is null or not isfinite(p_now) then raise exception 'Invalid range' using errcode='22023';end if;
 start_at:=((p_now at time zone 'Asia/Bangkok')::date-(p_days-1))::timestamp at time zone 'Asia/Bangkok';
 with current_jobs as materialized (
  select customer_id,route,status,created_at,updated_at from public.agent_message_jobs
  where tenant_id=p_tenant and created_at>=start_at and created_at<=p_now
 ), daily as (
  select (created_at at time zone 'Asia/Bangkok')::date as day,count(*) messages,count(distinct customer_id) customers
  from current_jobs where route='AI' and status='sent' group by 1
 ), metrics as (
  select count(*) filter(where route='ADMIN') handoffs,
   avg(extract(epoch from updated_at-created_at)) filter(where route='AI' and status='sent' and updated_at>=created_at) average_seconds,
   100.0*count(*) filter(where route='AI' and status='sent')/nullif(count(*) filter(where route='AI' and status in ('sent','failed','review')),0) success_rate
  from current_jobs
 )
 select jsonb_build_object(
   'repliesToday', coalesce((
     select messages from daily where day = (p_now at time zone 'Asia/Bangkok')::date
   ), 0),
   'customersTotal', (
     select count(distinct customer_id) from public.agent_message_jobs
     where tenant_id = p_tenant and route = 'AI' and status = 'sent' and created_at <= p_now
   ),
   'handoffs', m.handoffs,
   'averageSeconds', m.average_seconds,
   'successRate', m.success_rate,
   'points', (
     select jsonb_agg(jsonb_build_object(
       'day', to_char(d.day, 'YYYY-MM-DD'),
       'messages', coalesce(v.messages, 0),
       'customers', coalesce(v.customers, 0)
     ) order by d.day)
     from (
       select (start_at at time zone 'Asia/Bangkok')::date + i as day
       from generate_series(0, p_days - 1) i
     ) d left join daily v on v.day = d.day
   ),
   'recent', coalesce((
     select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
     from (
       select id, customer_id, route, status, created_at, updated_at
       from public.agent_message_jobs
       where tenant_id = p_tenant and created_at <= p_now
       order by created_at desc, id limit 10
     ) r
   ), '[]'::jsonb)
 ) into answer from metrics m;
 return answer;
end $$;

create or replace function public.basic_overview_stats(p_tenant uuid, p_now timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;start_at timestamptz;
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant and is_active)
 or not public.has_tenant_feature(p_tenant,'slip_auto_pilot') then raise exception 'Forbidden' using errcode='42501';end if;
 if p_now is null or not isfinite(p_now) then raise exception 'Invalid time' using errcode='22023';end if;
 start_at:=((p_now at time zone 'Asia/Bangkok')::date-13)::timestamp at time zone 'Asia/Bangkok';
 with source as materialized (
  select s.id,s.customer_id,s.amount,s.status,s.created_at,s.approved_at,s.status='valid' or (s.approved_at is not null and s.status in ('amount_mismatch','wrong_receiver','fake','error')) counted,
   s.status='pending' or (s.status in ('amount_mismatch','duplicate','fake','wrong_receiver','error') and s.approved_at is null) attention
  from public.slips s where s.tenant_id=p_tenant and s.created_at>=start_at and s.created_at<=p_now
 ), daily as (
  select (created_at at time zone 'Asia/Bangkok')::date as day,sum(coalesce(amount,0)) amount,count(*) n from source where counted group by 1
 )
 select jsonb_build_object(
   'totalSlips', (select count(*) from source),
   'attentionCount', (select count(*) from source where attention),
   'periodTotal', coalesce((select sum(amount) from daily), 0),
   'byStatus', coalesce((
     select jsonb_object_agg(status, n)
     from (select status, count(*) n from source group by status) x
   ), '{}'::jsonb),
   'points', (
     select jsonb_agg(jsonb_build_object(
       'day', to_char(d.day, 'YYYY-MM-DD'),
       'amount', coalesce(v.amount, 0),
       'count', coalesce(v.n, 0)
     ) order by d.day)
     from (
       select (start_at at time zone 'Asia/Bangkok')::date + i as day
       from generate_series(0, 13) i
     ) d left join daily v on v.day = d.day
   ),
   'attention', coalesce((
     select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
     from (
       select s.id, s.amount, s.status, s.created_at,
         jsonb_build_object('display_name', c.display_name) customers
       from source s
       left join public.customers c on c.id = s.customer_id and c.tenant_id = p_tenant
       where s.attention order by s.created_at desc, s.id limit 8
     ) r
   ), '[]'::jsonb)
 ) into answer;
 return answer;
end $$;

revoke all on function public.customer_directory(uuid,integer,text,text,text),public.agent_overview_stats(uuid,integer,timestamptz),public.basic_overview_stats(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.customer_directory(uuid,integer,text,text,text),public.agent_overview_stats(uuid,integer,timestamptz),public.basic_overview_stats(uuid,timestamptz) to service_role;
commit;
