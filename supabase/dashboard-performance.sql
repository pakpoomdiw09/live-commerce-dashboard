-- Apply after platform.sql, billing.sql, feature-access.sql, smart-inbox.sql,
-- agent-control.sql and commerce-v2.sql.
-- Read-only aggregates; no historical data, balances or permissions are rewritten.
begin;
create index if not exists overview_slips_time on public.slips(tenant_id,created_at desc,id);
create index if not exists overview_customers_time on public.customers(tenant_id,last_message_at desc,id);
create index if not exists overview_messages_latest on public.messages(customer_id,created_at desc,id desc) include(sender);
create index if not exists overview_messages_inbound on public.messages(customer_id,created_at) where sender='customer';
create index if not exists overview_agent_time on public.agent_message_jobs(tenant_id,created_at) include(route,status,customer_id);
create index if not exists commerce_products_page on public.products(tenant_id,created_at desc,id) where not commerce_archived;
create index if not exists commerce_products_low_stock on public.products(tenant_id,stock,id) where not commerce_archived and is_active and stock<=3;
create index if not exists commerce_orders_page on public.commerce_orders(tenant_id,created_at desc,id);
create index if not exists commerce_orders_status_page on public.commerce_orders(tenant_id,status,created_at desc,id);
create index if not exists commerce_orders_paid_time on public.commerce_orders(tenant_id,paid_at) include(total,status);
create index if not exists commerce_customers_page on public.commerce_customers(tenant_id,created_at desc,id);
create index if not exists commerce_items_tenant_order on public.commerce_order_items(tenant_id,order_id);
create index if not exists commerce_audit_entity on public.commerce_audit(tenant_id,entity_id,created_at desc,id);
create index if not exists commerce_categories_page on public.commerce_categories(tenant_id,name,id);
create index if not exists commerce_pages_page on public.commerce_pages(tenant_id,id);

create or replace function public.overview_dashboard_stats(p_tenant uuid,p_from timestamptz,p_to timestamptz,p_previous timestamptz,p_page integer,p_query text)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;slip_access boolean;chat_access boolean;ai_access boolean;
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant and is_active) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 1000 or p_query is null or length(p_query)>100 or p_to is null or not isfinite(p_to)
 or p_from is not null and (not isfinite(p_from) or p_from>=p_to or p_to-p_from>interval '91 days')
 or p_previous is not null and (p_from is null or not isfinite(p_previous) or p_previous>=p_from or p_from-p_previous>interval '90 days') then raise exception 'Invalid filters' using errcode='22023';end if;
 slip_access:=public.has_tenant_feature(p_tenant,'slip_auto_pilot');
 chat_access:=public.has_tenant_feature(p_tenant,'customer_management');
 ai_access:=public.has_tenant_feature(p_tenant,'ai_agent');
 with
 slip_source as materialized (
  select s.id,s.customer_id,s.created_at,s.amount,s.note,s.trans_ref,
   case when s.status='valid' or s.approved_at is not null and s.status in ('amount_mismatch','wrong_receiver','fake','error') then 'passed'
   when s.status in ('pending','amount_mismatch','wrong_receiver') then 'pending' when s.status='error' then 'error' else 'rejected' end result
  from public.slips s where slip_access and s.tenant_id=p_tenant and s.created_at<p_to and (coalesce(p_previous,p_from) is null or s.created_at>=coalesce(p_previous,p_from))
 ), current_slips as materialized (select * from slip_source where p_from is null or created_at>=p_from),
 previous_slips as (select * from slip_source where p_previous is not null and created_at<p_from),
 slip_matches as materialized (
  select s.id,s.created_at,c.display_name customer,to_jsonb(c)->>'avatar_url' avatar_url,s.amount,s.result,s.note
  from current_slips s left join public.customers c on chat_access and c.id=s.customer_id and c.tenant_id=p_tenant
  where p_query='' or strpos(lower(coalesce(s.note,'')),lower(p_query))>0 or strpos(lower(coalesce(s.trans_ref,'')),lower(p_query))>0 or strpos(lower(coalesce(c.display_name,'')),lower(p_query))>0
 ), inbound as materialized (
  select m.customer_id,date_trunc(case when p_from is null then 'month' else 'day' end,m.created_at at time zone 'Asia/Bangkok') as day,
   floor(extract(hour from m.created_at at time zone 'Asia/Bangkok')/3)::integer bin,count(*) messages
  from public.customers c join public.messages m on m.customer_id=c.id
  where chat_access and c.tenant_id=p_tenant and m.sender='customer' and m.created_at<p_to and (p_from is null or m.created_at>=p_from)
  group by 1,2,3
 ), active_customers as (select distinct customer_id from inbound),
 chat_matches as materialized (
  select c.id,c.display_name name,to_jsonb(c)->>'avatar_url' avatar_url,c.last_message_at,
   coalesce((to_jsonb(c)->>'unread_count')::integer,0) unread_count,
   case when to_jsonb(c)->>'assigned_user_id' is not null then 'แอดมินรับแชท' when c.bot_enabled then 'บอท' else 'รอแอดมิน' end owner
  from public.customers c
  where chat_access and c.tenant_id=p_tenant and c.last_message_at<p_to and (p_from is null or c.last_message_at>=p_from)
  and (p_query='' or strpos(lower(coalesce(c.display_name,'')),lower(p_query))>0 or exists(
   select 1 from (select m.body from public.messages m where m.customer_id=c.id and m.created_at<p_to and (p_from is null or m.created_at>=p_from) order by m.created_at desc,m.id desc limit 1) latest
   where strpos(lower(coalesce(latest.body,'')),lower(p_query))>0))
 ), slip_days as (
  select date_trunc(case when p_from is null then 'month' else 'day' end,created_at at time zone 'Asia/Bangkok') as day,
   count(*) count,coalesce(sum(round(amount*100)) filter(where result='passed'),0)/100 amount from current_slips group by 1
 ), previous_days as (
  select date_trunc('day',(created_at+(p_from-p_previous)) at time zone 'Asia/Bangkok') as day,count(*) count,
   coalesce(sum(round(amount*100)) filter(where result='passed'),0)/100 amount from previous_slips group by 1
 ), slip_axis as (
  select generate_series(coalesce(p_from at time zone 'Asia/Bangkok',greatest((select min(day) from slip_days),date_trunc('month',p_to at time zone 'Asia/Bangkok')-interval '119 months')),
   p_to at time zone 'Asia/Bangkok',case when p_from is null then interval '1 month' else interval '1 day' end)::date as day
  where p_from is not null or exists(select 1 from slip_days)
 ), activity_days as (
  select day,sum(messages) messages,count(distinct customer_id) customers from inbound group by 1
 ), activity_axis as (
  select generate_series(coalesce(p_from at time zone 'Asia/Bangkok',greatest((select min(day) from activity_days),date_trunc('month',p_to at time zone 'Asia/Bangkok')-interval '119 months')),
   (p_to at time zone 'Asia/Bangkok')-interval '1 microsecond',case when p_from is null then interval '1 month' else interval '1 day' end)::date as day
  where chat_access and (p_from is not null or exists(select 1 from activity_days))
 ), hours as (select bin,sum(messages) messages from inbound group by 1),
 genders as (select lower(trim(to_jsonb(c)->>'gender')) gender from public.customers c join active_customers a on a.customer_id=c.id where c.tenant_id=p_tenant),
 jobs as (select route,status,customer_id from public.agent_message_jobs where ai_access and tenant_id=p_tenant and created_at<p_to and (p_from is null or created_at>=p_from))
 select jsonb_build_object(
  'access',jsonb_build_object('slips',slip_access,'customers',chat_access,'ai',ai_access),
  'totals',(select jsonb_build_object('totalSlips',count(*),'approved',count(*) filter(where result='passed'),'pending',count(*) filter(where result='pending'),'verifiedSlipAmount',coalesce(sum(round(amount*100)) filter(where result='passed'),0)/100) from current_slips),
  'results',(select jsonb_build_object('passed',count(*) filter(where result='passed'),'pending',count(*) filter(where result='pending'),'rejected',count(*) filter(where result='rejected'),'error',count(*) filter(where result='error')) from current_slips),
  'previous',case when p_previous is null then null else (select jsonb_build_object('totalSlips',count(*),'approved',count(*) filter(where result='passed'),'verifiedSlipAmount',coalesce(sum(round(amount*100)) filter(where result='passed'),0)/100) from previous_slips) end,
  'series',coalesce((select jsonb_agg(jsonb_build_object('day',a.day,'amount',coalesce(s.amount,0),'count',coalesce(s.count,0),'previousAmount',case when p_previous is not null then coalesce(v.amount,0) end,'previousCount',case when p_previous is not null then coalesce(v.count,0) end) order by a.day) from slip_axis a left join slip_days s on s.day=a.day left join previous_days v on v.day=a.day),'[]'),
  'slipMatches',(select count(*) from slip_matches),
  'slips',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id) from (select * from slip_matches order by created_at desc,id limit 10 offset (p_page-1)*10) s),'[]'),
  'messages',(select coalesce(sum(messages),0) from inbound),'uniqueCustomers',(select count(*) from active_customers),
  'customerGenders',(select jsonb_build_object('male',count(*) filter(where gender in ('male','ชาย','เพศชาย')),'female',count(*) filter(where gender in ('female','หญิง','เพศหญิง')),'unspecified',count(*) filter(where gender is null or gender not in ('male','ชาย','เพศชาย','female','หญิง','เพศหญิง'))) from genders),
  'activity',coalesce((select jsonb_agg(jsonb_build_object('key',a.day,'messages',coalesce(d.messages,0),'customers',coalesce(d.customers,0)) order by a.day) from activity_axis a left join activity_days d on d.day=a.day),'[]'),
  'hours',(select jsonb_agg(jsonb_build_object('bin',b,'messages',coalesce(h.messages,0)) order by b) from generate_series(0,7) b left join hours h on h.bin=b),
  'chatMatches',(select count(*) from chat_matches),
  'chats',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('body',latest.body) order by c.last_message_at desc,c.id)
   from (select * from chat_matches order by last_message_at desc,id limit 10 offset (p_page-1)*10) c
   left join lateral (select m.body from public.messages m where m.customer_id=c.id and m.created_at<p_to and (p_from is null or m.created_at>=p_from) order by m.created_at desc,m.id desc limit 1) latest on true),'[]'),
  'ai',(select jsonb_build_object('replies',count(*) filter(where route='AI' and status='sent'),'conversations',count(distinct customer_id) filter(where route='AI' and status='sent'),'handoffs',count(*) filter(where route='ADMIN'),'usage',null,'limit',null) from jobs)
 ) into answer;
 return answer;
end $$;

create or replace function public.commerce_dashboard_stats(p_tenant uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare result jsonb;l public.commerce_limits;today timestamptz:=date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
begin
 select * into l from public.commerce_plan(p_tenant);
 if not found or l.plan is null then raise exception 'Forbidden' using errcode='42501';end if;
 with paid as not materialized (select * from public.commerce_orders where tenant_id=p_tenant and status in ('paid','preparing','shipped','completed')),
 sales as (select (paid_at at time zone 'Asia/Bangkok')::date as day,sum(round(total*100))/100 amount from paid where paid_at>=today-interval '13 days' and paid_at<today+interval '1 day' group by 1),
 monthly as (select to_char(paid_at at time zone 'Asia/Bangkok','YYYY-MM') as month,sum(round(total*100))/100 total from paid where l.reports and paid_at is not null group by 1 order by 1 desc limit 120),
 best as (select i.name,sum(i.qty) qty from paid o join public.commerce_order_items i on i.order_id=o.id and i.tenant_id=p_tenant group by i.name order by sum(i.qty) desc,i.name limit 5)
 select jsonb_build_object(
  'products',(select count(*) from public.products where tenant_id=p_tenant and not commerce_archived),
  'customers',(select count(*) from public.commerce_customers where tenant_id=p_tenant),
  'todayOrders',(select count(*) from public.commerce_orders where tenant_id=p_tenant and created_at>=today and created_at<today+interval '1 day'),
  'pending',(select count(*) from public.commerce_orders where tenant_id=p_tenant and status='pending_payment'),
  'shipping',(select count(*) from public.commerce_orders where tenant_id=p_tenant and status in ('paid','preparing')),
  'revenue',coalesce((select amount from sales where day=(today at time zone 'Asia/Bangkok')::date),0),
  'amounts',(select jsonb_agg(jsonb_build_object('label',to_char(d,'MM-DD'),'amount',coalesce(s.amount,0)) order by d) from generate_series((today at time zone 'Asia/Bangkok')-interval '13 days',today at time zone 'Asia/Bangkok',interval '1 day') d left join sales s on s.day=d::date),
  'best',coalesce((select jsonb_agg(to_jsonb(b) order by qty desc,name) from best b),'[]'),
  'low',coalesce((select jsonb_agg(to_jsonb(p) order by stock,id) from (select id,name,stock from public.products where tenant_id=p_tenant and not commerce_archived and is_active and stock<=3 order by stock,id limit 5) p),'[]'),
  'report',case when l.reports then jsonb_build_object('monthly',coalesce((select jsonb_agg(to_jsonb(m) order by month desc) from monthly m),'[]')) end
 ) into result;
 return result;
end $$;
create or replace function public.commerce_dashboard_page(p_tenant uuid,p_product_page integer default 1,p_order_page integer default 1,p_customer_page integer default 1,p_category_page integer default 1,p_page_page integer default 1,p_query text default '',p_category uuid default null,p_sort text default 'new',p_status text default 'all')
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare answer jsonb;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and is_active) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_product_page is null or p_order_page is null or p_customer_page is null or p_category_page is null or p_page_page is null
 or least(p_product_page,p_order_page,p_customer_page,p_category_page,p_page_page)<1 or greatest(p_product_page,p_order_page,p_customer_page,p_category_page,p_page_page)>1000
 or p_query is null or length(p_query)>100 or p_sort is null or p_sort not in ('new','price','price_desc')
 or p_status is null or p_status not in ('all','pending_payment','payment_review','paid','preparing','shipped','completed','cancelled') then raise exception 'Invalid filters' using errcode='22023';end if;
 with product_matches as not materialized (
  select * from public.products where tenant_id=p_tenant and not commerce_archived and (p_category is null or commerce_category_id=p_category)
  and (p_query='' or strpos(lower(name||' '||code),lower(p_query))>0)
 ), product_page as materialized (
  select * from product_matches order by case when p_sort='price' then price end,case when p_sort='price_desc' then price end desc,created_at desc,id limit 50 offset (p_product_page-1)*50
 ), order_matches as not materialized (select id,number,customer_id,status,total,shipping,tracking,created_at,paid_at from public.commerce_orders where tenant_id=p_tenant and (p_status='all' or status=p_status)),
 order_page as materialized (select * from order_matches order by created_at desc,id limit 50 offset (p_order_page-1)*50),
 customer_page as materialized (select id,name,phone,created_at from public.commerce_customers where tenant_id=p_tenant order by created_at desc,id limit 50 offset (p_customer_page-1)*50),
 customer_orders as (select o.customer_id,count(*) order_count from public.commerce_orders o join customer_page c on c.id=o.customer_id where o.tenant_id=p_tenant group by o.customer_id),
 category_page as materialized (select id,name from public.commerce_categories where tenant_id=p_tenant order by name,id limit 50 offset (p_category_page-1)*50),
 categories as (select * from category_page
  union select c.id,c.name from public.commerce_categories c join product_page p on p.commerce_category_id=c.id where c.tenant_id=p_tenant
  union select id,name from public.commerce_categories where tenant_id=p_tenant and id=p_category),
 page_page as (select * from public.commerce_pages where tenant_id=p_tenant order by id limit 50 offset (p_page_page-1)*50)
 select jsonb_build_object(
  'products',coalesce((select jsonb_agg(to_jsonb(p) order by case when p_sort='price' then price end,case when p_sort='price_desc' then price end desc,created_at desc,id) from product_page p),'[]'),
  'variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from public.commerce_variants v join product_page p on p.id=v.product_id where v.tenant_id=p_tenant and v.is_active),'[]'),
  'orders',coalesce((select jsonb_agg(to_jsonb(o) order by created_at desc,id) from order_page o),'[]'),
  'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.order_id,i.id) from public.commerce_order_items i join order_page o on o.id=i.order_id where i.tenant_id=p_tenant),'[]'),
  'customers',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('order_count',coalesce(o.order_count,0)) order by c.created_at desc,c.id) from customer_page c left join customer_orders o on o.customer_id=c.id),'[]'),
  'categories',coalesce((select jsonb_agg(to_jsonb(c) order by name,id) from categories c),'[]'),
  'categoryRows',coalesce((select jsonb_agg(to_jsonb(c) order by name,id) from category_page c),'[]'),
  'pages',coalesce((select jsonb_agg(to_jsonb(p) order by id) from page_page p),'[]'),
  'audit',coalesce((select jsonb_agg(to_jsonb(a) order by created_at desc,id) from (select a.id,a.entity_id,a.actor_id,a.action,a.detail,a.created_at from public.commerce_audit a join order_page o on o.id=a.entity_id where a.tenant_id=p_tenant order by a.created_at desc,a.id limit 300) a),'[]'),
  'counts',jsonb_build_object('products',(select count(*) from product_matches),'orders',(select count(*) from order_matches),'customers',(select count(*) from public.commerce_customers where tenant_id=p_tenant),'categories',(select count(*) from public.commerce_categories where tenant_id=p_tenant),'pages',(select count(*) from public.commerce_pages where tenant_id=p_tenant))
 ) into answer;
 return answer;
end $$;
revoke all on function public.overview_dashboard_stats(uuid,timestamptz,timestamptz,timestamptz,integer,text),public.commerce_dashboard_stats(uuid),public.commerce_dashboard_page(uuid,integer,integer,integer,integer,integer,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.overview_dashboard_stats(uuid,timestamptz,timestamptz,timestamptz,integer,text),public.commerce_dashboard_stats(uuid),public.commerce_dashboard_page(uuid,integer,integer,integer,integer,integer,text,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
