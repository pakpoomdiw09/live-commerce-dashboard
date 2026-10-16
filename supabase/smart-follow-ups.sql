-- Run LAST after smart-inbox.sql, free-message-quota.sql and automation.sql.
-- Back up the database before applying in production. Never sends network requests.
begin;
alter table public.customers add column if not exists followup_opted_out boolean not null default false;
alter table public.customers add column if not exists followup_opted_out_at timestamptz;
alter table public.customers add column if not exists contact_suspended boolean not null default false;
alter table public.orders add column if not exists confirmed_at timestamptz;
update public.orders o set confirmed_at=o.created_at where o.confirmed_at is null and exists(select 1 from public.messages m where m.id=o.message_id and m.customer_id=o.customer_id and m.sender='customer');

create table if not exists public.follow_up_policies(
 tenant_id uuid primary key references public.tenants(id) on delete cascade,enabled boolean not null default false,
 timezone text not null default 'Asia/Bangkok',quiet_enabled boolean not null default false,
 quiet_start integer not null default 1320 check(quiet_start between 0 and 1439),quiet_end integer not null default 480 check(quiet_end between 0 and 1439),
 max_per_customer integer not null default 3 check(max_per_customer between 1 and 20),max_per_order integer not null default 3 check(max_per_order between 1 and 10)
);
create table if not exists public.follow_up_workflows(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,
 kind text not null check(kind in ('payment','interested','after_sales')),enabled boolean not null default false,
 use_ai boolean not null default false,stop_on_reply boolean not null default true,version integer not null default 1,
 steps jsonb not null check(jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 3),unique(tenant_id,kind)
);
create table if not exists public.order_delivery_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),order_id uuid not null unique references public.orders(id),
 customer_id uuid not null references public.customers(id),confirmed_by uuid not null references auth.users(id),
 evidence text not null check(length(trim(evidence)) between 5 and 1000),delivered_at timestamptz not null,created_at timestamptz not null default now()
);
alter table public.follow_up_jobs alter column order_id drop not null;
alter table public.follow_up_jobs drop constraint if exists follow_up_jobs_order_id_step_key;
alter table public.follow_up_jobs drop constraint if exists follow_up_jobs_status_check;
alter table public.follow_up_jobs add constraint follow_up_jobs_status_check check(status in ('scheduled','pending','processing','sent','failed','cancelled','skipped','requires_review'));
alter table public.follow_up_jobs alter column status set default 'pending';
alter table public.follow_up_jobs add column if not exists kind text not null default 'payment' check(kind in ('payment','interested','after_sales'));
alter table public.follow_up_jobs add column if not exists workflow_id uuid references public.follow_up_workflows(id);
alter table public.follow_up_jobs add column if not exists workflow_version integer not null default 1;
alter table public.follow_up_jobs add column if not exists source_message_id uuid references public.messages(id);
alter table public.follow_up_jobs add column if not exists product_id uuid references public.products(id);
alter table public.follow_up_jobs add column if not exists source_seq bigint not null default 0;
alter table public.follow_up_jobs add column if not exists anchor_at timestamptz not null default now();
alter table public.follow_up_jobs add column if not exists claim_token uuid;
alter table public.follow_up_jobs add column if not exists claim_until timestamptz;
alter table public.follow_up_jobs add column if not exists attempts integer not null default 0;
alter table public.follow_up_jobs add column if not exists dispatch_started_at timestamptz;
alter table public.follow_up_jobs add column if not exists message_id uuid references public.messages(id);
alter table public.follow_up_jobs add column if not exists provider_message_id text;
alter table public.follow_up_jobs add column if not exists reserved_monthly integer not null default 0;
alter table public.follow_up_jobs add column if not exists reserved_topup integer not null default 0;
alter table public.follow_up_jobs add column if not exists delivery_lease uuid;
alter table public.follow_up_jobs add column if not exists responded_at timestamptz;
alter table public.follow_up_jobs add column if not exists ai_approved boolean not null default false;
create unique index if not exists follow_up_order_step on public.follow_up_jobs(order_id,kind,step) where order_id is not null;
create unique index if not exists follow_up_interest_step on public.follow_up_jobs(source_message_id,step) where kind='interested';
create index if not exists follow_up_pending_due on public.follow_up_jobs(run_at,id) where status='pending';
create index if not exists follow_up_processing_lease on public.follow_up_jobs(claim_until) where status='processing';
create index if not exists follow_up_contact_rate on public.follow_up_jobs(customer_id,dispatch_started_at desc) where dispatch_started_at is not null;
create table if not exists public.follow_up_execution_logs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),job_id uuid not null references public.follow_up_jobs(id),
 status text not null,reason text,actor_id uuid references auth.users(id),created_at timestamptz not null default now()
);
create index if not exists follow_up_logs_tenant on public.follow_up_execution_logs(tenant_id,created_at desc);

-- Preserve existing opt-in, custom steps, history and queued jobs. New workflows start disabled.
insert into public.follow_up_policies(tenant_id,enabled) select t.id,coalesce(s.followup_enabled,false) from public.tenants t left join public.bot_settings s on s.tenant_id=t.id on conflict do nothing;
insert into public.follow_up_workflows(tenant_id,kind,enabled,steps)
 select t.id,'payment',coalesce(s.followup_enabled,false),case when jsonb_array_length(coalesce(s.followup_steps,'[]')) between 1 and 3 then s.followup_steps else '[{"delay_minutes":30,"text":"คุณ {ชื่อลูกค้า} ออเดอร์ยอด {ยอดเงิน} บาทยังรอชำระนะคะ"},{"delay_minutes":180,"text":"สอบถามอีกครั้งค่ะ ยังต้องการออเดอร์นี้ไหมคะ"}]'::jsonb end
 from public.tenants t left join public.bot_settings s on s.tenant_id=t.id on conflict do nothing;
insert into public.follow_up_workflows(tenant_id,kind,steps)
 select id,'interested','[{"delay_minutes":60,"text":"คุณ {ชื่อลูกค้า} ต้องการข้อมูลเพิ่มเติมเกี่ยวกับ {สินค้า} ไหมคะ"}]'::jsonb from public.tenants on conflict do nothing;
insert into public.follow_up_workflows(tenant_id,kind,steps)
 select id,'after_sales','[{"delay_minutes":60,"text":"คุณ {ชื่อลูกค้า} ได้รับสินค้า {สินค้า} เรียบร้อยไหมคะ หากมีปัญหาแจ้งแอดมินได้เลยค่ะ"}]'::jsonb from public.tenants on conflict do nothing;
update public.follow_up_jobs j set workflow_id=w.id,workflow_version=w.version,source_seq=c.inbound_seq,anchor_at=coalesce(o.created_at,j.created_at)
 from public.follow_up_workflows w,public.customers c,public.orders o where j.workflow_id is null and w.tenant_id=j.tenant_id and w.kind=j.kind and c.id=j.customer_id and o.id=j.order_id;
update public.follow_up_jobs set status='pending' where status='scheduled';

do $$declare tab text;begin
 foreach tab in array array['follow_up_policies','follow_up_workflows','order_delivery_events','follow_up_execution_logs'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists tenant_read on public.%I',tab);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.can_access_tenant(tenant_id) and public.has_tenant_feature(tenant_id,''customer_follow_up''))',tab);
 end loop;
end $$;
-- Workflow mutations, cancellation, claims and opt-out go through checked server APIs.
revoke update(status,reason) on public.follow_up_jobs from authenticated;
revoke insert,update,delete on public.follow_up_jobs from authenticated,anon;
grant select(followup_opted_out,followup_opted_out_at,contact_suspended) on public.customers to authenticated;
grant select(confirmed_at) on public.orders to authenticated;

create or replace function public.log_follow_up_state() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status or new.reason is distinct from old.reason then
  insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason) values(new.tenant_id,new.id,new.status,new.reason);
 end if;return new;
end $$;
drop trigger if exists follow_up_state_log on public.follow_up_jobs;
create trigger follow_up_state_log after insert or update on public.follow_up_jobs for each row execute function public.log_follow_up_state();

create or replace function public.enqueue_follow_up(p_tenant uuid,p_customer uuid,p_kind text,p_order uuid default null,p_source uuid default null,p_product uuid default null) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.follow_up_workflows;c public.customers;anchor timestamptz;st jsonb;n integer:=0;source_sequence bigint;
begin
 select * into c from public.customers where id=p_customer and tenant_id=p_tenant;
 if not found or c.followup_opted_out or c.contact_suspended or not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then return;end if;
 source_sequence:=c.inbound_seq;
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not exists(select 1 from public.follow_up_policies where tenant_id=p_tenant and enabled) then return;end if;
 select * into w from public.follow_up_workflows where tenant_id=p_tenant and kind=p_kind and enabled;
 if not found then return;end if;
 if p_kind<>'payment' and not public.has_tenant_feature(p_tenant,'ai_agent') then return;end if;
 if p_kind='interested' then
  if not public.has_tenant_feature(p_tenant,'ai_agent') then return;end if;
  select created_at into anchor from public.messages where id=p_source and customer_id=c.id and sender='customer' and inbound_seq=c.inbound_seq;
  if anchor is null or not exists(select 1 from public.products where id=p_product and tenant_id=p_tenant and is_active) or exists(select 1 from public.orders where tenant_id=p_tenant and customer_id=c.id and created_at>=anchor) then return;end if;
 elsif p_kind='payment' then
  select o.confirmed_at,coalesce(m.inbound_seq,c.inbound_seq) into anchor,source_sequence from public.orders o left join public.messages m on m.id=o.message_id where o.id=p_order and o.tenant_id=p_tenant and o.customer_id=c.id and o.status='pending_payment';
 elsif p_kind='after_sales' then
  select d.delivered_at into anchor from public.order_delivery_events d join public.orders o on o.id=d.order_id where d.order_id=p_order and d.tenant_id=p_tenant and d.customer_id=c.id and o.status='shipped';
 else return;end if;
 if anchor is null then return;end if;
 for st in select value from jsonb_array_elements(w.steps) loop
  n:=n+1;
  insert into public.follow_up_jobs(tenant_id,customer_id,order_id,kind,workflow_id,workflow_version,source_message_id,product_id,step,text,run_at,anchor_at,source_seq,status,reason)
  values(p_tenant,c.id,p_order,p_kind,w.id,w.version,p_source,p_product,n,st->>'text',anchor+make_interval(mins=>(st->>'delay_minutes')::integer),anchor,source_sequence,
   case when w.use_ai then 'requires_review' else 'pending' end,case when w.use_ai then 'ai_draft' else null end)
  on conflict do nothing;
 end loop;
end $$;

-- Replaces legacy order scheduling; stock restoration in on_order_status is left intact.
create or replace function public.schedule_follow_ups() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.follow_up_jobs set status='cancelled',reason='new_order' where customer_id=new.customer_id and tenant_id=new.tenant_id and kind='interested' and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 if new.status='pending_payment' then perform public.enqueue_follow_up(new.tenant_id,new.customer_id,'payment',new.id);end if;
 return new;
end $$;
create or replace function public.confirm_cf_order() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.message_id is not null and exists(select 1 from public.messages m where m.id=new.message_id and m.customer_id=new.customer_id and m.sender='customer') then new.confirmed_at:=coalesce(new.confirmed_at,now());end if;
 return new;
end $$;
drop trigger if exists orders_confirm_cf on public.orders;
create trigger orders_confirm_cf before insert on public.orders for each row execute function public.confirm_cf_order();
create or replace function public.cancel_paid_follow_ups() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status<>old.status and new.status in ('paid','shipped','cancelled') then
  update public.follow_up_jobs set status='cancelled',reason=case when new.status='cancelled' then 'order_cancelled' else 'paid' end
  where order_id=new.id and (kind='payment' or new.status='cancelled') and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 end if;return null;
end $$;

create or replace function public.on_follow_up_customer() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.followup_opted_out or new.contact_suspended or not new.bot_enabled or new.assigned_user_id is not null or new.conversation_status='closed' then
  update public.follow_up_jobs set status='cancelled',reason=case when new.followup_opted_out then 'opt_out' when new.contact_suspended then 'contact_suspended' else 'handover' end
  where customer_id=new.id and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 end if;return null;
end $$;
drop trigger if exists customers_follow_up_stop on public.customers;
create trigger customers_follow_up_stop after update of followup_opted_out,contact_suspended,bot_enabled,assigned_user_id,conversation_status on public.customers for each row execute function public.on_follow_up_customer();
create or replace function public.on_follow_up_message() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare normalized text;
begin
 if new.sender<>'customer' then return null;end if;
 normalized:=lower(regexp_replace(coalesce(new.body,''),'[[:space:][:punct:]]','','g'));
 if normalized in ('stop','unsubscribe','ไม่รับข้อความ','หยุดส่งข้อความ','ยกเลิกติดตาม','ไม่ต้องส่งแล้ว','หยุดติดตาม','ไม่ต้องติดตาม','ไม่ต้องส่งข้อความอีก','เลิกส่งข้อความ','ไม่รับข่าวสาร','ยกเลิกข้อความ') then
  update public.customers set followup_opted_out=true,followup_opted_out_at=now() where id=new.customer_id;
 elsif normalized in ('start','subscribe','เริ่มติดตาม','รับข้อความติดตาม') then
  update public.customers set followup_opted_out=false,followup_opted_out_at=null where id=new.customer_id;
 end if;
 update public.follow_up_jobs set responded_at=coalesce(responded_at,new.created_at) where customer_id=new.customer_id and status='sent' and source_seq<new.inbound_seq and sent_at<=new.created_at;
 update public.follow_up_jobs j set status='cancelled',reason='customer_replied' from public.follow_up_workflows w
 where j.customer_id=new.customer_id and w.id=j.workflow_id and (w.stop_on_reply or j.kind='interested') and j.source_seq<new.inbound_seq and (j.status in ('pending','requires_review') or j.status='processing' and j.dispatch_started_at is null);
 return null;
end $$;
drop trigger if exists messages_follow_up_stop on public.messages;
create trigger messages_follow_up_stop after insert on public.messages for each row execute function public.on_follow_up_message();

create or replace function public.on_follow_up_delivery() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.orders where id=new.order_id and tenant_id=new.tenant_id and customer_id=new.customer_id and status='shipped' and created_at<=new.delivered_at)
  or new.delivered_at>clock_timestamp()+interval '2 minutes' then raise exception 'Actual shipped order and delivery evidence required' using errcode='22023';end if;
 perform public.enqueue_follow_up(new.tenant_id,new.customer_id,'after_sales',new.order_id);
 return null;
end $$;
drop trigger if exists delivery_schedule_follow_up on public.order_delivery_events;
create trigger delivery_schedule_follow_up after insert on public.order_delivery_events for each row execute function public.on_follow_up_delivery();

create or replace function public.claim_follow_up_jobs(p_tenant uuid default null,p_limit integer default 5) returns setof public.follow_up_jobs
language plpgsql set search_path=pg_catalog,public as $$
begin
 -- Once dispatch starts, a crashed worker must NEVER guess that the request was not delivered.
 update public.follow_up_jobs set status='requires_review',reason='worker_restarted',claim_token=null,claim_until=null
 where status='processing' and claim_until<clock_timestamp() and dispatch_started_at is not null and (p_tenant is null or tenant_id=p_tenant);
 update public.follow_up_jobs set status=case when attempts>=3 then 'failed' else 'pending' end,reason='worker_restarted',claim_token=null,claim_until=null,run_at=greatest(run_at,now()+interval '10 seconds')
 where status='processing' and claim_until<clock_timestamp() and dispatch_started_at is null and (p_tenant is null or tenant_id=p_tenant);
 return query with due as(
  select id from public.follow_up_jobs where status='pending' and run_at<=now() and attempts<3 and (p_tenant is null or tenant_id=p_tenant)
  order by run_at,id limit least(greatest(p_limit,1),10) for update skip locked
 ) update public.follow_up_jobs j set status='processing',claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,reason=null
 from due where j.id=due.id returning j.*;
end $$;

create or replace function public.render_smart_follow_up(p_template text,p_name text,p_product text,p_total numeric) returns text
language plpgsql immutable set search_path=pg_catalog,public as $$
declare remaining text:=p_template;result text:='';matched text[];token text;at_position integer;value text;
begin
 loop
  matched:=regexp_match(remaining,'\{(name|ชื่อลูกค้า|product|สินค้า|total|ยอดเงิน)\}');
  exit when matched is null;
  token:='{'||matched[1]||'}';at_position:=strpos(remaining,token);
  value:=case when matched[1] in ('name','ชื่อลูกค้า') then coalesce(p_name,'ลูกค้า') when matched[1] in ('product','สินค้า') then coalesce(p_product,'') else to_char(coalesce(p_total,0),'FM9999999990.00') end;
  result:=result||left(remaining,at_position-1)||value;remaining:=substring(remaining from at_position+length(token));
 end loop;
 return result||remaining;
end $$;
revoke all on function public.render_smart_follow_up(text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.render_smart_follow_up(text,text,text,numeric) to service_role;

create or replace function public.prepare_follow_up(p_job uuid,p_claim uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
<<preflight>>
declare j public.follow_up_jobs;c public.customers;w public.follow_up_workflows;p public.follow_up_policies;t public.tenants;o public.orders;
 reason text;next_status text:='cancelled';local_now timestamp;next_local timestamp;minute_now integer;reservation record;lease uuid;msg uuid;rendered text;product text;total numeric;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return jsonb_build_object('status','skipped');end if;
 -- Consistent tenant -> customer -> job order, also used by completion. Customer triggers lock jobs.
 select * into t from public.tenants where id=j.tenant_id for update;
 select * into c from public.customers where id=j.customer_id for update;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.claim_until<=clock_timestamp() or j.dispatch_started_at is not null then return jsonb_build_object('status','skipped');end if;
 select * into w from public.follow_up_workflows where id=j.workflow_id and tenant_id=j.tenant_id;
 select * into p from public.follow_up_policies where tenant_id=j.tenant_id;
 if c.id is null or c.tenant_id is distinct from j.tenant_id or w.id is null or p.tenant_id is null then reason:='invalid_reference';
 elsif not public.has_tenant_feature(j.tenant_id,'customer_follow_up') or (j.kind<>'payment' or w.use_ai) and not public.has_tenant_feature(j.tenant_id,'ai_agent') then reason:='plan_required';
 elsif not p.enabled or not w.enabled or not t.auto_reply_enabled then reason:='disabled';
 elsif w.version<>j.workflow_version then reason:='workflow_changed';
 elsif c.followup_opted_out then reason:='opt_out';
 elsif c.contact_suspended then reason:='contact_suspended';
 elsif not c.bot_enabled or c.assigned_user_id is not null or c.conversation_status='closed' then reason:='handover';
 elsif (w.stop_on_reply or j.kind='interested') and c.inbound_seq>j.source_seq then reason:='customer_replied';end if;
 if reason is null and j.kind in ('payment','after_sales') then
  select * into o from public.orders where id=j.order_id and tenant_id=j.tenant_id and customer_id=j.customer_id;
  if not found then reason:='invalid_reference';
  elsif o.status='cancelled' then reason:='order_cancelled';
  elsif j.kind='payment' and o.status<>'pending_payment' then reason:='paid';
  elsif j.kind='payment' and o.confirmed_at is null then reason:='order_unconfirmed';next_status:='requires_review';
  elsif j.kind='payment' and exists(select 1 from public.slips where tenant_id=j.tenant_id and customer_id=c.id and created_at>=j.anchor_at) then reason:='slip_received';next_status:='requires_review';
  elsif j.kind='after_sales' and (o.status<>'shipped' or not exists(select 1 from public.order_delivery_events where order_id=o.id and tenant_id=j.tenant_id and delivered_at<=clock_timestamp())) then reason:='invalid_reference';end if;
  product:=o.product_name;total:=o.amount;
 elsif reason is null and j.kind='interested' then
  select name,price into product,total from public.products where id=j.product_id and tenant_id=j.tenant_id and is_active;
  if not found or not exists(select 1 from public.messages where id=j.source_message_id and customer_id=c.id and sender='customer') then reason:='invalid_reference';
  elsif exists(select 1 from public.orders where tenant_id=j.tenant_id and customer_id=c.id and created_at>=j.anchor_at) then reason:='new_order';end if;
 end if;
 if reason is null and (c.last_message_at is null or c.last_message_at<clock_timestamp()-interval '24 hours' or c.last_message_at>clock_timestamp()+interval '2 minutes') then reason:='window_closed';next_status:='requires_review';end if;
 if reason is null and w.use_ai and not j.ai_approved then reason:='ai_draft';next_status:='requires_review';end if;
 if reason is not null then
  update public.follow_up_jobs set status=next_status,reason=preflight.reason,claim_token=null,claim_until=null where id=j.id;
  return jsonb_build_object('status',next_status,'reason',reason);
 end if;
 if p.quiet_enabled then
  local_now:=clock_timestamp() at time zone p.timezone;minute_now:=extract(hour from local_now)::integer*60+extract(minute from local_now)::integer;
  if p.quiet_start=p.quiet_end or (p.quiet_start<p.quiet_end and minute_now>=p.quiet_start and minute_now<p.quiet_end) or (p.quiet_start>p.quiet_end and (minute_now>=p.quiet_start or minute_now<p.quiet_end)) then
   next_local:=date_trunc('day',local_now)+make_interval(mins=>p.quiet_end);
   if next_local<=local_now then next_local:=next_local+interval '1 day';end if;
   update public.follow_up_jobs set status='pending',reason='quiet_hours',run_at=next_local at time zone p.timezone,attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;
   return jsonb_build_object('status','deferred');
  end if;
 end if;
 if (select count(*) from public.follow_up_jobs where customer_id=c.id and dispatch_started_at>clock_timestamp()-interval '24 hours')>=p.max_per_customer
  or j.order_id is not null and (select count(*) from public.follow_up_jobs where order_id=j.order_id and dispatch_started_at is not null)>=p.max_per_order then
  update public.follow_up_jobs set status='skipped',reason='rate_limit',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','skipped','reason','rate_limit');
 end if;
 if c.outbound_lock_until>clock_timestamp() then
  update public.follow_up_jobs set status='pending',reason='delivery_busy',run_at=clock_timestamp()+interval '1 minute',attempts=greatest(0,attempts-1),claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','deferred');
 end if;
 if exists(select 1 from public.messages where external_id='followup:'||j.id::text) then
  update public.follow_up_jobs set status='requires_review',reason='delivery_unknown',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review');
 end if;
 select * into reservation from public.reserve_broadcast_credits(j.tenant_id,1);
 if reservation.monthly+reservation.topup<>1 then
  update public.follow_up_jobs set status='requires_review',reason='quota_exhausted',claim_token=null,claim_until=null where id=j.id;return jsonb_build_object('status','requires_review','reason','quota_exhausted');
 end if;
 -- The lease blocks Inbox claim/transfer while the network request is in flight.
 lease:=public.start_inbox_delivery(c.id,null);
 rendered:=public.render_smart_follow_up(j.text,c.display_name,product,total);
 insert into public.messages(customer_id,sender,external_id,body,delivery_status) values(c.id,'bot','followup:'||j.id::text,rendered,'pending') returning id into msg;
 update public.follow_up_jobs set dispatch_started_at=clock_timestamp(),message_id=msg,delivery_lease=lease,reserved_monthly=reservation.monthly,reserved_topup=reservation.topup where id=j.id;
 return jsonb_build_object('status','ready','text',rendered,'customerId',c.id,'psid',c.platform_user_id,'tenantId',j.tenant_id,'messageId',msg);
end $$;

create or replace function public.complete_follow_up(p_job uuid,p_claim uuid,p_result text,p_provider text default null,p_reason text default null) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;
begin
 select * into j from public.follow_up_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 perform 1 from public.customers where id=j.customer_id for update;
 select * into j from public.follow_up_jobs where id=p_job for update;
 if j.status<>'processing' or j.claim_token is distinct from p_claim or j.dispatch_started_at is null then return false;end if;
 if p_result not in ('sent','failed','requires_review') or (p_result='sent' and nullif(trim(p_provider),'') is null) then raise exception 'Provider receipt required' using errcode='22023';end if;
 if p_result='failed' or p_result='requires_review' and p_reason='window_closed' then perform public.refund_broadcast_credits(j.tenant_id,j.reserved_monthly,j.reserved_topup);end if;
 update public.messages set delivery_status=case when p_result='sent' then 'sent' when p_result='failed' or p_reason='window_closed' then 'failed' else 'unknown' end,provider_message_id=p_provider where id=j.message_id;
 update public.follow_up_jobs set status=p_result,reason=p_reason,provider_message_id=p_provider,sent_at=case when p_result='sent' then now() else null end,
  claim_token=null,claim_until=null,reserved_monthly=0,reserved_topup=0 where id=j.id;
 perform public.end_inbox_delivery(j.customer_id,j.delivery_lease);
 return true;
end $$;

create or replace function public.follow_up_overview(p_tenant uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('pending',count(*) filter(where status='pending'),'processing',count(*) filter(where status='processing'),'sent',count(*) filter(where status='sent'),'requires_review',count(*) filter(where status='requires_review'),'cancelled',count(*) filter(where status in ('cancelled','skipped')),'failed',count(*) filter(where status='failed'),'responded',count(distinct customer_id) filter(where responded_at is not null)) from public.follow_up_jobs where tenant_id=p_tenant and created_at>now()-interval '30 days'
$$;

-- Only the trusted worker may call execution primitives. Trigger functions are not public RPCs.
create or replace function public.save_smart_follow_up(p_tenant uuid,p_actor uuid,p_policy jsonb,p_workflows jsonb) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare row jsonb;st jsonb;previous integer;n integer;current_version integer;
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') then raise exception 'FEATURE_LOCKED' using errcode='42501';end if;
 if not exists(select 1 from pg_timezone_names where name=p_policy->>'timezone') or jsonb_typeof(p_workflows)<>'array' or jsonb_array_length(p_workflows)<>3 then raise exception 'Invalid settings' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant for update;
 for row in select value from jsonb_array_elements(p_workflows) loop
  if row->>'kind' not in ('payment','interested','after_sales') or jsonb_typeof(row->'steps')<>'array' or jsonb_array_length(row->'steps') not between 1 and 3 then raise exception 'Invalid workflow' using errcode='22023';end if;
  if ((row->>'enabled')::boolean and row->>'kind'<>'payment' or (row->>'use_ai')::boolean) and not public.has_tenant_feature(p_tenant,'ai_agent') then raise exception 'FEATURE_LOCKED: ai_agent' using errcode='42501';end if;
  previous:=0;n:=0;
  for st in select value from jsonb_array_elements(row->'steps') loop
   n:=(st->>'delay_minutes')::integer;
   if n<=previous or n>43200 or length(trim(st->>'text')) not between 1 and 2000 then raise exception 'Invalid workflow steps' using errcode='22023';end if;
   previous:=n;
  end loop;
  select version into current_version from public.follow_up_workflows where tenant_id=p_tenant and kind=row->>'kind' for update;
  if coalesce(current_version,0)<>(row->>'version')::integer then raise exception 'Workflow changed; reload' using errcode='40001';end if;
 end loop;
 if (select count(distinct value->>'kind') from jsonb_array_elements(p_workflows))<>3 then raise exception 'Duplicate workflow kind' using errcode='22023';end if;
 insert into public.follow_up_policies(tenant_id,enabled,timezone,quiet_enabled,quiet_start,quiet_end,max_per_customer,max_per_order)
 values(p_tenant,(p_policy->>'enabled')::boolean,p_policy->>'timezone',(p_policy->>'quiet_enabled')::boolean,(p_policy->>'quiet_start')::integer,(p_policy->>'quiet_end')::integer,(p_policy->>'max_per_customer')::integer,(p_policy->>'max_per_order')::integer)
 on conflict(tenant_id) do update set enabled=excluded.enabled,timezone=excluded.timezone,quiet_enabled=excluded.quiet_enabled,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,max_per_customer=excluded.max_per_customer,max_per_order=excluded.max_per_order;
 for row in select value from jsonb_array_elements(p_workflows) loop
  insert into public.follow_up_workflows(tenant_id,kind,enabled,use_ai,stop_on_reply,steps)
  values(p_tenant,row->>'kind',(row->>'enabled')::boolean,(row->>'use_ai')::boolean,(row->>'stop_on_reply')::boolean,row->'steps')
  on conflict(tenant_id,kind) do update set enabled=excluded.enabled,use_ai=excluded.use_ai,stop_on_reply=excluded.stop_on_reply,steps=excluded.steps,version=follow_up_workflows.version+1;
 end loop;
 update public.follow_up_jobs set status='cancelled',reason=case when (p_policy->>'enabled')::boolean then 'workflow_changed' else 'disabled' end where tenant_id=p_tenant and (status in ('pending','requires_review') or status='processing' and dispatch_started_at is null);
 -- Existing in-flight deliveries are never retried; changes apply to new orders/events.
end $$;

create or replace function public.act_follow_up_job(p_job uuid,p_tenant uuid,p_actor uuid,p_action text,p_text text default null) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare j public.follow_up_jobs;
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor) or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into j from public.follow_up_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found then raise exception 'Job not found' using errcode='P0002';end if;
 if (j.dispatch_started_at is not null and p_action<>'skip') or j.status not in ('pending','requires_review','failed') then raise exception 'Job cannot be resent or changed' using errcode='40001';end if;
 if p_action='cancel' then update public.follow_up_jobs set status='cancelled',reason='manual' where id=j.id;
 elsif p_action='skip' then update public.follow_up_jobs set status='skipped',reason='manual' where id=j.id;
 elsif p_action='approve' and j.status='requires_review' and j.reason='ai_draft' and length(trim(p_text)) between 1 and 2000 then
  update public.follow_up_jobs set text=trim(p_text),ai_approved=true,status='pending',reason=null,run_at=greatest(run_at,now()),attempts=0 where id=j.id;
 elsif p_action='retry' and j.status in ('failed','requires_review') and j.reason in ('worker_restarted','quota_exhausted','no_token') then
  update public.follow_up_jobs set status='pending',reason=null,run_at=greatest(run_at,now()),attempts=0 where id=j.id;
 else raise exception 'Unsafe action' using errcode='22023';end if;
 insert into public.follow_up_execution_logs(tenant_id,job_id,status,reason,actor_id) values(p_tenant,j.id,'admin_action',p_action,p_actor);
end $$;

create or replace function public.confirm_follow_up_order(p_order uuid,p_tenant uuid,p_actor uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare c uuid;
begin
 if not public.has_tenant_feature(p_tenant,'customer_follow_up') or not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner') or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'Forbidden' using errcode='42501';end if;
 update public.orders set confirmed_at=coalesce(confirmed_at,now()) where id=p_order and tenant_id=p_tenant and status='pending_payment' returning customer_id into c;
 if c is null then raise exception 'Pending order not found' using errcode='P0002';end if;
 perform public.enqueue_follow_up(p_tenant,c,'payment',p_order);
end $$;
revoke all on function public.confirm_follow_up_order(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_follow_up_order(uuid,uuid,uuid) to service_role;

revoke all on function public.save_smart_follow_up(uuid,uuid,jsonb,jsonb),public.act_follow_up_job(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_smart_follow_up(uuid,uuid,jsonb,jsonb),public.act_follow_up_job(uuid,uuid,uuid,text,text) to service_role;
revoke all on function public.enqueue_follow_up(uuid,uuid,text,uuid,uuid,uuid),public.claim_follow_up_jobs(uuid,integer),public.prepare_follow_up(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.follow_up_overview(uuid),public.log_follow_up_state(),public.confirm_cf_order(),public.on_follow_up_customer(),public.on_follow_up_message(),public.on_follow_up_delivery() from public,anon,authenticated;
grant execute on function public.enqueue_follow_up(uuid,uuid,text,uuid,uuid,uuid),public.claim_follow_up_jobs(uuid,integer),public.prepare_follow_up(uuid,uuid),public.complete_follow_up(uuid,uuid,text,text,text),public.follow_up_overview(uuid) to service_role;
do $$declare tab text;begin
 foreach tab in array array['follow_up_workflows','follow_up_policies'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then execute format('alter publication supabase_realtime add table public.%I',tab);end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
