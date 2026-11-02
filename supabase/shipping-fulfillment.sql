-- Apply after live-session-dashboard.sql. Parcel allocation never changes the payment ledger.
begin;
create table if not exists public.shipping_settings (
 tenant_id uuid primary key references public.tenants(id),sender_name text not null default '',sender_phone text not null default '',
 sender_address text not null default '',default_courier text not null default 'Bee Move',revision bigint not null default 0
);
create table if not exists public.shipping_profiles (
 tenant_id uuid not null references public.tenants(id),customer_id uuid not null references public.customers(id),
 address jsonb not null,confirmed_at timestamptz,pending_candidate_id uuid,primary key(tenant_id,customer_id)
);
create table if not exists public.shipping_shipments (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid not null references public.customers(id),
 customer_tab_id uuid references public.customer_tabs(id),live_session_id uuid references public.live_sessions(id),
 recipient_name text not null default '',phone_number text not null default '',shipping_address text not null default '',
 subdistrict text not null default '',district text not null default '',province text not null default '',zipcode text not null default '',
 tracking_number text,courier_name text not null default 'Bee Move',note text not null default '',
 fulfillment_status text not null default 'pending_address' check(fulfillment_status in ('pending_address','ready_to_ship','shipped','cancelled')),
 address_confirmed_at timestamptz,label_printed_at timestamptz,label_print_count integer not null default 0,
 address_candidate_id uuid,revision bigint not null default 0,paid_amount numeric(14,2) not null default 0,
 created_at timestamptz not null default clock_timestamp(),shipped_at timestamptz
);
create unique index if not exists shipping_one_open_tab on public.shipping_shipments(customer_tab_id) where customer_tab_id is not null and fulfillment_status not in ('shipped','cancelled');
create index if not exists shipping_tenant_queue on public.shipping_shipments(tenant_id,fulfillment_status,created_at desc);
create index if not exists shipping_customer_queue on public.shipping_shipments(tenant_id,customer_id,created_at desc);
create table if not exists public.shipping_shipment_items (
 order_id uuid primary key references public.orders(id),shipment_id uuid not null references public.shipping_shipments(id),
 item_name text not null,amount numeric(12,2) not null,cancelled boolean not null default false
);
create index if not exists shipping_items_parcel on public.shipping_shipment_items(shipment_id);
create table if not exists public.shipping_address_candidates (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),customer_id uuid not null references public.customers(id),
 source_message_id uuid not null unique references public.messages(id),address jsonb not null,
 status text not null default 'pending' check(status in ('pending','confirmed','superseded')),
 notified_at timestamptz,created_at timestamptz not null default clock_timestamp(),confirmed_message_id uuid references public.messages(id)
);
create unique index if not exists shipping_one_pending_address on public.shipping_address_candidates(tenant_id,customer_id) where status='pending';
create table if not exists public.shipping_print_batches (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),actor_id uuid not null references auth.users(id),
 format text not null check(format in ('thermal','a4','csv')),sender jsonb not null,sender_revision bigint not null,shipments jsonb not null,
 created_at timestamptz not null default clock_timestamp(),opened_at timestamptz
);
create table if not exists public.shipping_action_receipts (
 tenant_id uuid not null references public.tenants(id),request_id uuid not null,actor_id uuid not null references auth.users(id),
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,request_id)
);
do $$declare tab text;begin
 foreach tab in array array['customer_tabs','orders'] loop
  execute format('alter table public.%I add column if not exists shipping_shipment_id uuid references public.shipping_shipments(id),
   add column if not exists recipient_name text,add column if not exists phone_number text,add column if not exists shipping_address text,
   add column if not exists tracking_number text,add column if not exists courier_name text,
   add column if not exists fulfillment_status text default ''pending_address'' check(fulfillment_status in (''pending_address'',''ready_to_ship'',''shipped'',''cancelled'')),
   add column if not exists label_printed_at timestamptz',tab);
 end loop;
 foreach tab in array array['shipping_settings','shipping_profiles','shipping_shipments','shipping_shipment_items','shipping_address_candidates','shipping_print_batches','shipping_action_receipts'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
 end loop;
end $$;
create or replace function public.shipping_address_valid(v jsonb) returns boolean language sql immutable set search_path=pg_catalog,public as $$
 select jsonb_typeof(v)='object' and coalesce(length(trim(v->>'recipient_name')) between 2 and 200,false)
 and coalesce(v->>'phone_number' ~ '^0[1-9][0-9]{7,8}$',false)
 and coalesce(length(trim(v->>'shipping_address')) between 10 and 1200,false)
 and coalesce(length(trim(v->>'subdistrict')) between 1 and 100,false)
 and coalesce(length(trim(v->>'district')) between 1 and 100,false)
 and coalesce(length(trim(v->>'province')) between 1 and 100,false)
 and coalesce(v->>'zipcode' ~ '^[1-9][0-9]{4}$',false)
$$;
create or replace function public.shipping_payment_ready(p_shipment uuid) returns boolean language sql stable set search_path=pg_catalog,public as $$
 select coalesce((select s.fulfillment_status='shipped' or (
  exists(select 1 from public.shipping_shipment_items i join public.orders o on o.id=i.order_id where i.shipment_id=s.id and not i.cancelled and o.status='paid')
  and not exists(select 1 from public.shipping_shipment_items i join public.orders o on o.id=i.order_id where i.shipment_id=s.id and not i.cancelled and (o.status<>'paid' or o.paid_amount<o.amount and o.customer_tab_id is not null))
  and (s.customer_tab_id is null or exists(select 1 from public.customer_tabs t where t.id=s.customer_tab_id and t.total_amount>0 and t.remaining_amount=0)))
 from public.shipping_shipments s where s.id=p_shipment),false)
$$;
create or replace function public.shipping_mirror_fields() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.orders set shipping_shipment_id=new.id,recipient_name=new.recipient_name,phone_number=new.phone_number,shipping_address=new.shipping_address,
  tracking_number=new.tracking_number,courier_name=new.courier_name,fulfillment_status=new.fulfillment_status,label_printed_at=new.label_printed_at
  where id in(select order_id from public.shipping_shipment_items where shipment_id=new.id);
 update public.customer_tabs set recipient_name=new.recipient_name,phone_number=new.phone_number,shipping_address=new.shipping_address,
  tracking_number=new.tracking_number,courier_name=new.courier_name,fulfillment_status=new.fulfillment_status,label_printed_at=new.label_printed_at
  where id=new.customer_tab_id and shipping_shipment_id=new.id;
 return new;
end $$;
drop trigger if exists shipping_mirror on public.shipping_shipments;
create trigger shipping_mirror after update on public.shipping_shipments for each row execute function public.shipping_mirror_fields();

create or replace function public.reconcile_shipping(p_tab uuid,p_order uuid default null) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare t public.customer_tabs;o public.orders;s public.shipping_shipments;p public.shipping_profiles;tid uuid;cid uuid;ready boolean;cash numeric;ses uuid;changed integer:=0;added integer:=0;desired text;
begin
 if p_tab is not null then
  select * into t from public.customer_tabs where id=p_tab for update;
  if not found then return;end if;tid:=t.tenant_id;cid:=t.customer_id;ses:=t.live_session_id;cash:=t.paid_amount;ready:=t.total_amount>0 and t.remaining_amount=0;
  select * into s from public.shipping_shipments where customer_tab_id=t.id and fulfillment_status not in ('shipped','cancelled') for update;
 else
  select * into o from public.orders where id=p_order and customer_tab_id is null for update;
  if not found then return;end if;tid:=o.tenant_id;cid:=o.customer_id;cash:=case when o.status in ('paid','shipped') then o.amount else 0 end;ready:=o.status='paid';
  select parcel.* into s from public.shipping_shipments parcel join public.shipping_shipment_items i on i.shipment_id=parcel.id where i.order_id=o.id for update of parcel;
  if s.fulfillment_status in ('shipped','cancelled') then return;end if;
 end if;
 if s.id is null and ready and exists(select 1 from public.orders pending where pending.tenant_id=tid and pending.customer_id=cid and pending.status='paid'
  and (p_tab is not null and pending.customer_tab_id=p_tab or p_tab is null and pending.id=p_order)
  and not exists(select 1 from public.shipping_shipment_items assigned where assigned.order_id=pending.id)) then
  select * into p from public.shipping_profiles where tenant_id=tid and customer_id=cid;
  insert into public.shipping_shipments(tenant_id,customer_id,customer_tab_id,live_session_id,recipient_name,phone_number,shipping_address,subdistrict,district,province,zipcode,address_confirmed_at,address_candidate_id,courier_name)
   values(tid,cid,p_tab,ses,coalesce(p.address->>'recipient_name',''),coalesce(p.address->>'phone_number',''),coalesce(p.address->>'shipping_address',''),
    coalesce(p.address->>'subdistrict',''),coalesce(p.address->>'district',''),coalesce(p.address->>'province',''),coalesce(p.address->>'zipcode',''),p.confirmed_at,p.pending_candidate_id,
    coalesce((select default_courier from public.shipping_settings where tenant_id=tid),'Bee Move')) returning * into s;
  if p_tab is not null then update public.customer_tabs set shipping_shipment_id=s.id where id=p_tab;end if;
 end if;
 if s.id is null or s.fulfillment_status in ('shipped','cancelled') then return;end if;
 if ready then
  insert into public.shipping_shipment_items(order_id,shipment_id,item_name,amount)
   select pending.id,s.id,pending.product_name,coalesce(pending.item_amount,pending.amount) from public.orders pending
    where pending.tenant_id=tid and pending.customer_id=cid and pending.status='paid'
     and (p_tab is not null and pending.customer_tab_id=p_tab or p_tab is null and pending.id=p_order)
   on conflict(order_id) do nothing;
  get diagnostics added=row_count;
 end if;
 update public.shipping_shipment_items i set item_name=existing.product_name,amount=coalesce(existing.item_amount,existing.amount),cancelled=existing.status='cancelled'
  from public.orders existing where existing.id=i.order_id and i.shipment_id=s.id
   and (i.item_name,i.amount,i.cancelled) is distinct from (existing.product_name,coalesce(existing.item_amount,existing.amount),existing.status='cancelled');
 get diagnostics changed=row_count;
 desired:=case when not exists(select 1 from public.shipping_shipment_items where shipment_id=s.id and not cancelled) then 'cancelled'
   when ready and s.address_confirmed_at is not null and public.shipping_address_valid(to_jsonb(s)) then 'ready_to_ship' else 'pending_address' end;
 if changed>0 or added>0 or s.paid_amount<>cash or s.fulfillment_status<>desired then
  update public.shipping_shipments set paid_amount=cash,label_printed_at=null,revision=revision+1,fulfillment_status=desired where id=s.id;
 end if;
end $$;

create or replace function public.shipping_order_changed() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' then
  if new.status=old.status and new.amount=old.amount and new.paid_amount=old.paid_amount and new.product_name=old.product_name then return new;end if;
 end if;
 perform public.reconcile_shipping(new.customer_tab_id,case when new.customer_tab_id is null then new.id else null end);
 return new;
end $$;
drop trigger if exists shipping_order_sync on public.orders;
create trigger shipping_order_sync after insert or update of status,amount,paid_amount,product_name on public.orders for each row execute function public.shipping_order_changed();
create or replace function public.shipping_balance_changed() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.total_amount is distinct from old.total_amount or new.paid_amount is distinct from old.paid_amount then perform public.reconcile_shipping(new.id);end if;
 return new;
end $$;
drop trigger if exists shipping_tab_sync on public.customer_tabs;
create trigger shipping_tab_sync after update of total_amount,paid_amount on public.customer_tabs for each row execute function public.shipping_balance_changed();
create or replace function public.shipping_guard_dispatched() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.shipping_shipments where id=old.shipping_shipment_id and fulfillment_status='shipped') and
  (new.customer_id<>old.customer_id or new.customer_tab_id is distinct from old.customer_tab_id or new.amount<>old.amount or new.item_amount is distinct from old.item_amount
   or new.product_name<>old.product_name or new.status not in ('paid','shipped') or old.status='shipped' and new.status<>'shipped') then raise exception 'SHIPPING_ALREADY_DISPATCHED' using errcode='40001';end if;
 return new;
end $$;
drop trigger if exists shipping_dispatched_order_guard on public.orders;
create trigger shipping_dispatched_order_guard before update on public.orders for each row execute function public.shipping_guard_dispatched();

create or replace function public.shipping_snapshot(p_tenant uuid,p_ids uuid[] default null,p_session uuid default null) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('customer_name',coalesce(nullif(c.display_name,''),c.platform_user_id),
  'payment_ready',public.shipping_payment_ready(s.id),'items',coalesce((select jsonb_agg(jsonb_build_object('order_id',i.order_id,'item_name',i.item_name,'amount',i.amount) order by i.order_id) from public.shipping_shipment_items i where i.shipment_id=s.id and not i.cancelled),'[]')) order by s.created_at desc,s.id),'[]')
 from public.shipping_shipments s join public.customers c on c.id=s.customer_id and c.tenant_id=p_tenant
 where s.tenant_id=p_tenant and (p_ids is null or s.id=any(p_ids)) and (p_session is null or s.live_session_id=p_session)
$$;

create or replace function public.manage_shipping(p_tenant uuid,p_actor uuid,p_request uuid,p_input jsonb) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare old public.shipping_action_receipts;cfg public.shipping_settings;s public.shipping_shipments;b public.shipping_print_batches;
 ids uuid[];op text:=p_input->>'action';v jsonb;addr jsonb;result jsonb;batch uuid;replay boolean:=false;
begin
 if p_request is null or p_actor is null then raise exception 'SHIPPING_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping-action:'||p_tenant::text,0));
 select * into old from public.shipping_action_receipts where tenant_id=p_tenant and request_id=p_request;
 if found then
  if old.actor_id<>p_actor or old.payload<>p_input then raise exception 'SHIPPING_REQUEST_REUSED' using errcode='40001';end if;
  -- A lost HTTP response is safe to retry, but must never authorize printing/exporting
  -- an address that changed after the first request committed.
  if op in ('mark_print','prepare_print','export') then replay:=true;else return old.result;end if;
 end if;
 -- Financial CF and manual corrections take this lock before their tab/order writes.
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'SHIPPING_TENANT_NOT_FOUND' using errcode='P0002';end if;
 if op='settings' then
  addr:=p_input->'settings';
  if length(trim(coalesce(addr->>'sender_name',''))) not between 2 and 200 or coalesce(addr->>'sender_phone','') !~ '^0[1-9][0-9]{7,8}$'
   or length(trim(coalesce(addr->>'sender_address',''))) not between 10 and 1200 or length(coalesce(addr->>'default_courier','')) not between 1 and 80 then raise exception 'SHIPPING_SETTINGS_INVALID';end if;
  insert into public.shipping_settings(tenant_id,sender_name,sender_phone,sender_address,default_courier)
   values(p_tenant,addr->>'sender_name',addr->>'sender_phone',addr->>'sender_address',addr->>'default_courier')
   on conflict(tenant_id) do update set sender_name=excluded.sender_name,sender_phone=excluded.sender_phone,sender_address=excluded.sender_address,default_courier=excluded.default_courier,revision=shipping_settings.revision+1;
 elsif op='mark_print' then
  select * into b from public.shipping_print_batches where id=(p_input->>'batchId')::uuid and tenant_id=p_tenant for update;
  if not found or b.format='csv' then raise exception 'SHIPPING_BATCH_NOT_FOUND' using errcode='P0002';end if;
  if (select revision from public.shipping_settings where tenant_id=p_tenant) is distinct from b.sender_revision then raise exception 'SHIPPING_PRINT_STALE' using errcode='40001';end if;
  select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(b.shipments);
 else
  if jsonb_typeof(p_input->'ids') is distinct from 'array' then raise exception 'SHIPPING_INPUT_INVALID';end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_input->'ids');
 end if;
 if op<>'settings' then
  if coalesce(cardinality(ids),0) not between 1 and 100 or (select count(distinct id) from unnest(ids) id)<>cardinality(ids) then raise exception 'SHIPPING_SELECTION_INVALID';end if;
  if (select count(*) from public.shipping_shipments where tenant_id=p_tenant and id=any(ids))<>cardinality(ids) then raise exception 'SHIPPING_SCOPE' using errcode='42501';end if;
  -- Match the ledger's tab -> order allocation lock order; addresses and prints cannot race payment changes.
  perform 1 from public.customer_tabs where id in(select customer_tab_id from public.shipping_shipments where id=any(ids)) order by id for update;
  perform 1 from public.orders where id in(select i.order_id from public.shipping_shipment_items i join public.shipping_shipments x on x.id=i.shipment_id where x.id=any(ids) and x.customer_tab_id is null) order by id for update;
  perform 1 from public.shipping_shipments where id=any(ids) order by id for update;
  if replay and op in ('prepare_print','export') then
   select * into b from public.shipping_print_batches where id=(old.result->>'batchId')::uuid and tenant_id=p_tenant;
   if op='prepare_print' and (select revision from public.shipping_settings where tenant_id=p_tenant) is distinct from b.sender_revision then raise exception 'SHIPPING_PRINT_STALE' using errcode='40001';end if;
   for v in select value from jsonb_array_elements(b.shipments) loop
    select * into s from public.shipping_shipments where id=(v->>'id')::uuid;
    if s.revision is distinct from (v->>'revision')::bigint or s.fulfillment_status not in ('ready_to_ship','shipped') or not public.shipping_payment_ready(s.id) then raise exception 'SHIPPING_PRINT_STALE' using errcode='40001';end if;
   end loop;
   return old.result;
  end if;
  if op='edit' then
   if cardinality(ids)<>1 then raise exception 'SHIPPING_SELECTION_INVALID';end if;
   select * into s from public.shipping_shipments where id=ids[1];addr:=p_input->'address';
   if s.revision is distinct from (p_input->>'revision')::bigint then raise exception 'SHIPPING_CHANGED' using errcode='40001';end if;
   if s.fulfillment_status in ('shipped','cancelled') then raise exception 'SHIPPING_NOT_EDITABLE';end if;
   if not public.shipping_address_valid(addr) then raise exception 'SHIPPING_ADDRESS_INVALID';end if;
   if length(trim(coalesce(p_input->>'courier',''))) not between 1 and 80 or length(coalesce(p_input->>'tracking',''))>100 or length(coalesce(p_input->>'note',''))>500 then raise exception 'SHIPPING_INPUT_INVALID';end if;
   update public.shipping_shipments set recipient_name=addr->>'recipient_name',phone_number=addr->>'phone_number',shipping_address=addr->>'shipping_address',
    subdistrict=addr->>'subdistrict',district=addr->>'district',province=addr->>'province',zipcode=addr->>'zipcode',
    tracking_number=nullif(trim(p_input->>'tracking'),''),courier_name=p_input->>'courier',note=coalesce(p_input->>'note',''),
    address_candidate_id=case when p_input->>'confirmed'='true' or not(to_jsonb(s) @> addr) then null else address_candidate_id end,
    address_confirmed_at=case when p_input->>'confirmed'='true' then clock_timestamp() else null end,
    fulfillment_status=case when p_input->>'confirmed'='true' and public.shipping_payment_ready(s.id) then 'ready_to_ship' else 'pending_address' end,
    revision=revision+1,label_printed_at=null where id=s.id;
   if p_input->>'confirmed'='true' and (s.address_confirmed_at is null or not(to_jsonb(s) @> addr))
    and not exists(select 1 from public.shipping_profiles where tenant_id=p_tenant and customer_id=s.customer_id and pending_candidate_id is not null and address=addr) then
    insert into public.shipping_profiles(tenant_id,customer_id,address,confirmed_at) values(p_tenant,s.customer_id,addr,clock_timestamp())
     on conflict(tenant_id,customer_id) do update set address=excluded.address,confirmed_at=excluded.confirmed_at,pending_candidate_id=null;
    update public.shipping_address_candidates set status='superseded' where tenant_id=p_tenant and customer_id=s.customer_id and status='pending';
   end if;
  elsif op in ('cancel','restore','dispatch') then
   for s in select * from public.shipping_shipments where id=any(ids) order by id loop
    if s.fulfillment_status='shipped' then raise exception 'SHIPPING_ALREADY_DISPATCHED' using errcode='40001';end if;
    if op='dispatch' and (s.fulfillment_status<>'ready_to_ship' or not public.shipping_payment_ready(s.id) or s.address_confirmed_at is null or not public.shipping_address_valid(to_jsonb(s))
      or coalesce(s.tracking_number,'') !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{3,99}$') then raise exception 'SHIPPING_NOT_READY';end if;
    if op='restore' and exists(select 1 from public.shipping_shipments other where other.customer_tab_id=s.customer_tab_id and other.id<>s.id and other.fulfillment_status not in ('shipped','cancelled')) then raise exception 'SHIPPING_OTHER_PARCEL_OPEN';end if;
   end loop;
   update public.shipping_shipments set fulfillment_status=case when op='cancel' then 'cancelled' when op='dispatch' then 'shipped'
    when address_confirmed_at is not null and public.shipping_address_valid(to_jsonb(shipping_shipments)) and public.shipping_payment_ready(id) then 'ready_to_ship' else 'pending_address' end,
    shipped_at=case when op='dispatch' then clock_timestamp() else null end,revision=revision+1,label_printed_at=case when op='dispatch' then label_printed_at else null end where id=any(ids);
   if op='dispatch' then update public.orders set status='shipped' where id in(select order_id from public.shipping_shipment_items where shipment_id=any(ids) and not cancelled) and status='paid';end if;
  elsif op in ('prepare_print','export') then
   for s in select * from public.shipping_shipments where id=any(ids) loop
    if s.fulfillment_status not in ('ready_to_ship','shipped') or not public.shipping_payment_ready(s.id) or s.address_confirmed_at is null or not public.shipping_address_valid(to_jsonb(s)) then raise exception 'SHIPPING_NOT_READY';end if;
   end loop;
   select * into cfg from public.shipping_settings where tenant_id=p_tenant;
   if op='prepare_print' and (cfg.tenant_id is null or cfg.sender_name='' or cfg.sender_phone='' or cfg.sender_address='') then raise exception 'SHIPPING_SENDER_REQUIRED';end if;
   if op='prepare_print' and coalesce(p_input->>'format','') not in ('thermal','a4') then raise exception 'SHIPPING_INPUT_INVALID';end if;
   insert into public.shipping_print_batches(tenant_id,actor_id,format,sender,sender_revision,shipments)
    values(p_tenant,p_actor,case when op='export' then 'csv' else p_input->>'format' end,coalesce(to_jsonb(cfg),'{}'),coalesce(cfg.revision,0),public.shipping_snapshot(p_tenant,ids)) returning id into batch;
  elsif op='mark_print' then
   for v in select value from jsonb_array_elements(b.shipments) loop
    select * into s from public.shipping_shipments where id=(v->>'id')::uuid;
    if s.revision is distinct from (v->>'revision')::bigint or s.fulfillment_status not in ('ready_to_ship','shipped') or not public.shipping_payment_ready(s.id) then raise exception 'SHIPPING_PRINT_STALE' using errcode='40001';end if;
   end loop;
   if not replay then
    update public.shipping_shipments set label_printed_at=clock_timestamp(),label_print_count=label_print_count+1 where id=any(ids);
    update public.shipping_print_batches set opened_at=clock_timestamp() where id=b.id;
   end if;
  else raise exception 'SHIPPING_ACTION_INVALID';end if;
 end if;
 result:=jsonb_build_object('ok',true,'batchId',batch);
 if replay then return old.result;end if;
 insert into public.shipping_action_receipts(tenant_id,request_id,actor_id,payload,result) values(p_tenant,p_request,p_actor,p_input,result);
 return result;
end $$;

create or replace function public.capture_shipping_address(p_tenant uuid,p_customer uuid,p_message uuid,p_address jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare p public.shipping_profiles;c public.shipping_address_candidates;s public.shipping_shipments;found_ready boolean:=false;
begin
 if not public.shipping_address_valid(p_address) or not exists(select 1 from public.messages m join public.customers x on x.id=m.customer_id where m.id=p_message and m.customer_id=p_customer and x.tenant_id=p_tenant and m.sender='customer') then raise exception 'SHIPPING_ADDRESS_SCOPE' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping-address:'||p_customer::text,0));
 select * into c from public.shipping_address_candidates where source_message_id=p_message;
 if found then return jsonb_build_object('candidateId',c.id,'address',c.address,'handled',true);end if;
 -- Capture only for paid, undelivered parcels. Never update an already-dispatched label.
 perform 1 from public.customer_tabs where tenant_id=p_tenant and customer_id=p_customer order by id for update;
 perform 1 from public.orders where tenant_id=p_tenant and customer_id=p_customer and customer_tab_id is null and shipping_shipment_id is not null order by id for update;
 for s in select * from public.shipping_shipments where tenant_id=p_tenant and customer_id=p_customer and fulfillment_status not in ('shipped','cancelled') order by id for update loop
  if public.shipping_payment_ready(s.id) then found_ready:=true;end if;
 end loop;
 if not found_ready then return jsonb_build_object('handled',false);end if;
 select * into p from public.shipping_profiles where tenant_id=p_tenant and customer_id=p_customer;
 if p.address=p_address then
  return jsonb_build_object('handled',true,'candidateId',p.pending_candidate_id,'address',p.address,'confirmed',p.confirmed_at is not null);
 end if;
 update public.shipping_address_candidates set status='superseded' where tenant_id=p_tenant and customer_id=p_customer and status='pending';
 insert into public.shipping_address_candidates(tenant_id,customer_id,source_message_id,address) values(p_tenant,p_customer,p_message,p_address) returning * into c;
 insert into public.shipping_profiles(tenant_id,customer_id,address,pending_candidate_id) values(p_tenant,p_customer,p_address,c.id)
  on conflict(tenant_id,customer_id) do update set address=excluded.address,pending_candidate_id=excluded.pending_candidate_id,confirmed_at=null;
 update public.shipping_shipments set recipient_name=p_address->>'recipient_name',phone_number=p_address->>'phone_number',shipping_address=p_address->>'shipping_address',
  subdistrict=p_address->>'subdistrict',district=p_address->>'district',province=p_address->>'province',zipcode=p_address->>'zipcode',
  address_confirmed_at=null,address_candidate_id=c.id,fulfillment_status='pending_address',label_printed_at=null,revision=revision+1
  where tenant_id=p_tenant and customer_id=p_customer and fulfillment_status not in ('shipped','cancelled');
 return jsonb_build_object('handled',true,'candidateId',c.id,'address',p_address);
end $$;
create or replace function public.confirm_shipping_address(p_tenant uuid,p_customer uuid,p_message uuid,p_candidate uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare p public.shipping_profiles;c public.shipping_address_candidates;msg public.messages;
begin
 select m.* into msg from public.messages m join public.customers x on x.id=m.customer_id where m.id=p_message and m.customer_id=p_customer and m.sender='customer' and x.tenant_id=p_tenant;
 if not found then raise exception 'SHIPPING_ADDRESS_SCOPE' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('shipping-address:'||p_customer::text,0));
 perform 1 from public.customer_tabs where tenant_id=p_tenant and customer_id=p_customer order by id for update;
 perform 1 from public.orders where tenant_id=p_tenant and customer_id=p_customer and customer_tab_id is null and shipping_shipment_id is not null order by id for update;
 select * into p from public.shipping_profiles where tenant_id=p_tenant and customer_id=p_customer;
 select * into c from public.shipping_address_candidates where id=coalesce(p_candidate,p.pending_candidate_id) and tenant_id=p_tenant and customer_id=p_customer;
 if c.status='confirmed' and c.confirmed_message_id=p_message then return jsonb_build_object('handled',true,'confirmed',true);end if;
 if c.id is null or c.id is distinct from p.pending_candidate_id or c.status<>'pending' or (p_candidate is null and (c.notified_at is null or msg.created_at<c.notified_at-interval '2 seconds')) then return jsonb_build_object('handled',false);end if;
 update public.shipping_address_candidates set status='confirmed',confirmed_message_id=p_message where id=c.id;
 update public.shipping_profiles set confirmed_at=clock_timestamp(),pending_candidate_id=null where tenant_id=p_tenant and customer_id=p_customer;
 update public.shipping_shipments set address_confirmed_at=clock_timestamp(),address_candidate_id=null,
  fulfillment_status=case when public.shipping_payment_ready(id) then 'ready_to_ship' else 'pending_address' end,revision=revision+1,label_printed_at=null
  where tenant_id=p_tenant and customer_id=p_customer and address_candidate_id=c.id and fulfillment_status not in ('shipped','cancelled');
 return jsonb_build_object('handled',true,'confirmed',true);
end $$;

-- Adopt fully-paid live tabs and standalone paid orders without duplicating assignments.
do $$declare r record;begin
 for r in select id from public.customer_tabs where total_amount>0 and remaining_amount=0 order by id loop perform public.reconcile_shipping(r.id);end loop;
 for r in select id from public.orders where customer_tab_id is null and status='paid' order by id loop perform public.reconcile_shipping(null,r.id);end loop;
end $$;
revoke all on function public.shipping_address_valid(jsonb),public.shipping_payment_ready(uuid),public.shipping_mirror_fields(),public.reconcile_shipping(uuid,uuid),public.shipping_order_changed(),public.shipping_balance_changed(),public.shipping_guard_dispatched(),public.shipping_snapshot(uuid,uuid[],uuid),public.manage_shipping(uuid,uuid,uuid,jsonb),public.capture_shipping_address(uuid,uuid,uuid,jsonb),public.confirm_shipping_address(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.shipping_address_valid(jsonb),public.shipping_payment_ready(uuid),public.reconcile_shipping(uuid,uuid),public.shipping_snapshot(uuid,uuid[],uuid),public.manage_shipping(uuid,uuid,uuid,jsonb),public.capture_shipping_address(uuid,uuid,uuid,jsonb),public.confirm_shipping_address(uuid,uuid,uuid,uuid) to service_role;
commit;
