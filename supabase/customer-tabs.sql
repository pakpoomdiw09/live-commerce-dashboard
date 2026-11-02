-- Apply after live-auctions.sql. Existing historical orders retain their legacy payment path.
begin;
create table if not exists public.live_sessions (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 page_id text not null, live_post_id text not null, ended_at timestamptz,
 reminders_enabled boolean not null default true, created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,page_id,live_post_id)
);
create table if not exists public.customer_tabs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 customer_id uuid not null references public.customers(id), customer_fb_id text not null,
 page_id text not null, live_session_id uuid not null references public.live_sessions(id),
 bank_account_id uuid references public.bank_accounts(id), shipping_fee numeric(12,2) not null default 0 check(shipping_fee>=0),
 total_amount numeric(14,2) not null default 0 check(total_amount>=0),
 paid_amount numeric(14,2) not null default 0 check(paid_amount>=0),
 remaining_amount numeric(14,2) generated always as (greatest(total_amount-paid_amount,0)) stored,
 credit_amount numeric(14,2) generated always as (greatest(paid_amount-total_amount,0)) stored,
 status text not null default 'open' check(status in ('open','pending_payment','fully_paid')),
 revision bigint not null default 0, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), unique(live_session_id,customer_id)
);
alter table public.orders add column if not exists customer_tab_id uuid references public.customer_tabs(id);
alter table public.orders add column if not exists live_session_id uuid references public.live_sessions(id);
alter table public.orders add column if not exists live_post_id text;
alter table public.orders add column if not exists item_amount numeric(12,2);
alter table public.orders add column if not exists paid_amount numeric(12,2) not null default 0;
alter table public.slips add column if not exists customer_tab_id uuid references public.customer_tabs(id);
create table if not exists public.customer_tab_items (
 order_id uuid primary key references public.orders(id), tab_id uuid not null references public.customer_tabs(id),
 item_name text not null, variant_label text, amount numeric(12,2) not null check(amount>0),
 cancelled boolean not null default false, closed_at timestamptz not null default clock_timestamp()
);
create table if not exists public.customer_tab_payments (
 id uuid primary key default gen_random_uuid(), tab_id uuid not null references public.customer_tabs(id),
 slip_id uuid not null unique references public.slips(id), trans_ref text not null unique,
 amount numeric(12,2) not null check(amount>0), transferred_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.customer_tab_slip_attempts (
 slip_id uuid primary key references public.slips(id), tenant_id uuid not null references public.tenants(id),
 image_sha256 text not null, created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,image_sha256)
);
create table if not exists public.customer_tab_reminders (
 id uuid primary key default gen_random_uuid(), tab_id uuid not null references public.customer_tabs(id),
 stage text not null, run_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','processing','sent','cancelled','blocked','requires_review')),
 claim_token uuid, started_at timestamptz, completed_at timestamptz, error_code text,
 created_at timestamptz not null default clock_timestamp(), unique(tab_id,stage)
);
create index if not exists customer_tabs_customer on public.customer_tabs(tenant_id,customer_id,created_at desc);
create index if not exists customer_tabs_debt on public.customer_tabs(tenant_id,remaining_amount) where remaining_amount>0;
create index if not exists customer_tab_items_tab on public.customer_tab_items(tab_id,closed_at,order_id);
create index if not exists customer_tab_reminders_due on public.customer_tab_reminders(run_at) where status='pending';
do $$declare t text;begin foreach t in array array['live_sessions','customer_tabs','customer_tab_items','customer_tab_payments','customer_tab_slip_attempts','customer_tab_reminders'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop;end $$;

create or replace function public.refresh_customer_tab(p_tab uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare t public.customer_tabs; item record; balance numeric; fee numeric; line numeric; assigned numeric; previous text;
begin
 select * into t from public.customer_tabs where id=p_tab for update;
 if not found then raise exception 'TAB_NOT_FOUND';end if;
 update public.customer_tabs set
  total_amount=(select coalesce(sum(amount),0) from public.customer_tab_items where tab_id=t.id and not cancelled)
    + case when exists(select 1 from public.customer_tab_items where tab_id=t.id and not cancelled) then shipping_fee else 0 end,
  paid_amount=(select coalesce(sum(amount),0) from public.customer_tab_payments where tab_id=t.id),
  revision=revision+1,updated_at=clock_timestamp() where id=t.id returning * into t;
 update public.customer_tabs set status=case when t.total_amount<=t.paid_amount then 'fully_paid' else 'pending_payment' end where id=t.id;
 balance:=t.paid_amount; fee:=t.shipping_fee;
 previous:=current_setting('app.refreshing_customer_tab',true);
 perform set_config('app.refreshing_customer_tab','1',true);
 for item in select * from public.customer_tab_items where tab_id=t.id and not cancelled order by closed_at,order_id loop
  line:=item.amount+fee;fee:=0;assigned:=least(balance,line);balance:=greatest(balance-line,0);
  update public.orders set amount=line,paid_amount=assigned,
   status=case when status='shipped' then status when assigned>=line then 'paid' else 'pending_payment' end,
   paid_at=case when assigned>=line then coalesce(paid_at,clock_timestamp()) else null end
   where id=item.order_id;
 end loop;
 perform set_config('app.refreshing_customer_tab',coalesce(previous,''),true);
 if t.remaining_amount=0 then update public.customer_tab_reminders set status='cancelled' where tab_id=t.id and status in ('pending','blocked');end if;
end $$;

create or replace function public.attach_customer_tab_order() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare c public.customers; a public.auctions; r public.comment_rules; sess uuid; bill public.customer_tabs;
 page text; post text; shipping numeric:=0; bank uuid; unit numeric;
begin
 if current_setting('app.refreshing_customer_tab',true)='1' then return new;end if;
 if tg_op='UPDATE' then
  if old.customer_tab_id is null then return new;end if;
  if new.customer_tab_id is distinct from old.customer_tab_id or new.tenant_id<>old.tenant_id or new.customer_id<>old.customer_id
   or new.live_session_id is distinct from old.live_session_id then raise exception 'TAB_ORDER_SCOPE_IMMUTABLE';end if;
  if new.status='cancelled' and old.paid_amount>0 then raise exception 'TAB_REFUND_REQUIRES_REVIEW';end if;
  if new.status in ('paid','shipped') and new.paid_amount<new.amount then raise exception 'TAB_PAYMENT_NOT_COVERED';end if;
  if new.paid_amount<>old.paid_amount then raise exception 'TAB_PAYMENT_LEDGER_REQUIRED';end if;
  if new.amount<>old.amount then
   if new.variant_id is distinct from old.variant_id then new.item_amount:=new.amount;new.amount:=new.item_amount+(old.amount-old.item_amount);
   else new.item_amount:=old.item_amount+(new.amount-old.amount);end if;
  end if;
  return new;
 end if;
 if coalesce(new.source,'') not in ('live_auction','live_comment') or new.status<>'pending_payment' then return new;end if;
 select * into c from public.customers where id=new.customer_id and tenant_id=new.tenant_id and platform='facebook';
 if not found then raise exception 'TAB_CUSTOMER_SCOPE';end if;
 select page_id into page from public.tenants where id=new.tenant_id and is_active;
 if page is null then raise exception 'TAB_PAGE_SCOPE';end if;
 if new.source='live_auction' then
  select * into a from public.auctions where id::text=new.source_id and tenant_id=new.tenant_id and page_id=page;
  if not found then raise exception 'TAB_AUCTION_SCOPE';end if;
  post:=a.live_post_id;shipping:=a.shipping_fee;bank:=a.bank_account_id;unit:=a.current_price;
 else
  select * into r from public.comment_rules where id=new.live_rule_id and tenant_id=new.tenant_id and page=any(page_ids);
  if not found then raise exception 'TAB_CF_SCOPE';end if;
  post:=coalesce(new.live_post_id,r.live_post_id);bank:=r.live_bank_account_id;unit:=new.amount;
  if post is null then return new;end if;
  select live_post_id into post from public.auctions where tenant_id=new.tenant_id and page_id=page
   and (live_post_id=regexp_replace(coalesce(new.live_post_id,r.live_post_id),'^.*_','')
    or coalesce(new.live_post_id,r.live_post_id)=any(live_post_aliases)) order by created_at desc limit 1;
  post:=coalesce(post,new.live_post_id,r.live_post_id);
 end if;
 post:=regexp_replace(post,'^.*_','');
 insert into public.live_sessions(tenant_id,page_id,live_post_id) values(new.tenant_id,page,post)
  on conflict(tenant_id,page_id,live_post_id) do update set live_post_id=excluded.live_post_id returning id into sess;
 if exists(select 1 from public.live_sessions where id=sess and ended_at is not null) then raise exception 'LIVE_SESSION_ENDED';end if;
 insert into public.customer_tabs(tenant_id,customer_id,customer_fb_id,page_id,live_session_id,bank_account_id,shipping_fee)
  values(new.tenant_id,c.id,c.platform_user_id,page,sess,bank,shipping)
  on conflict(live_session_id,customer_id) do update set bank_account_id=coalesce(customer_tabs.bank_account_id,excluded.bank_account_id),
   shipping_fee=case when customer_tabs.shipping_fee=0 then excluded.shipping_fee else customer_tabs.shipping_fee end returning * into bill;
 new.customer_tab_id:=bill.id;new.live_session_id:=sess;new.live_post_id:=post;new.item_amount:=unit;
 new.amount:=unit+case when not exists(select 1 from public.customer_tab_items where tab_id=bill.id and not cancelled) then bill.shipping_fee else 0 end;
 return new;
end $$;

create or replace function public.sync_customer_tab_order() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.customer_tab_id is null or current_setting('app.refreshing_customer_tab',true)='1' then return new;end if;
 if tg_op='UPDATE' and new.amount=old.amount and new.product_name=old.product_name and new.variant_label is not distinct from old.variant_label
  and (new.status='cancelled')=(old.status='cancelled') then return new;end if;
 perform 1 from public.customer_tabs where id=new.customer_tab_id for update;
 insert into public.customer_tab_items(order_id,tab_id,item_name,variant_label,amount,cancelled,closed_at)
  values(new.id,new.customer_tab_id,new.product_name,new.variant_label,new.item_amount,new.status='cancelled',new.created_at)
  on conflict(order_id) do update set item_name=excluded.item_name,variant_label=excluded.variant_label,amount=excluded.amount,cancelled=excluded.cancelled;
 perform public.refresh_customer_tab(new.customer_tab_id);
 return new;
end $$;
drop trigger if exists customer_tab_order_guard on public.orders;
create trigger customer_tab_order_guard before insert or update on public.orders for each row execute function public.attach_customer_tab_order();
drop trigger if exists customer_tab_order_sync on public.orders;
create trigger customer_tab_order_sync after insert or update on public.orders for each row execute function public.sync_customer_tab_order();

create or replace function public.claim_customer_tab_slip(p_tab uuid,p_customer uuid,p_hash text,p_image text,p_message uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare t public.customer_tabs; s public.slips; sid uuid;
begin
 select * into t from public.customer_tabs where id=p_tab and customer_id=p_customer for update;
 if not found or t.remaining_amount<=0 then raise exception 'TAB_NOT_PAYABLE';end if;
 select slip.* into s from public.slips slip join public.customer_tab_slip_attempts attempt on attempt.slip_id=slip.id
  where attempt.tenant_id=t.tenant_id and attempt.image_sha256=p_hash;
 if found then
  if s.customer_id<>p_customer or s.customer_tab_id<>t.id then raise exception 'TAB_PROOF_SCOPE';end if;
  return jsonb_build_object('claimed',false,'slipId',s.id,'imagePath',s.image_path);
 end if;
 insert into public.slips(tenant_id,customer_id,customer_tab_id,message_id,image_path,expected_amount)
  values(t.tenant_id,t.customer_id,t.id,p_message,p_image,t.remaining_amount) returning id into sid;
 insert into public.customer_tab_slip_attempts(slip_id,tenant_id,image_sha256) values(sid,t.tenant_id,p_hash);
 return jsonb_build_object('claimed',true,'slipId',sid,'imagePath',p_image);
end $$;

create or replace function public.complete_customer_tab_slip(p_slip uuid,p_tenant uuid,p_customer uuid,p_verdict text,p_amount numeric,p_ref text,p_paid_at timestamptz,p_raw jsonb,p_note text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.slips; t public.customer_tabs;
begin
 select * into s from public.slips where id=p_slip and tenant_id=p_tenant and customer_id=p_customer for update;
 if not found or s.customer_tab_id is null then raise exception 'TAB_SLIP_SCOPE';end if;
 select * into t from public.customer_tabs where id=s.customer_tab_id and tenant_id=p_tenant and customer_id=p_customer for update;
 if not found then raise exception 'TAB_SLIP_SCOPE';end if;
 if s.status='pending' then
  if p_verdict='valid' and (p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or nullif(trim(p_ref),'') is null
   or p_paid_at is null or p_paid_at<t.created_at-interval '60 seconds' or p_paid_at>clock_timestamp()+interval '2 minutes') then
   raise exception 'TAB_PAYMENT_EVIDENCE_INVALID';
  end if;
  perform set_config('app.completing_customer_tab_slip','1',true);
  update public.slips set status=p_verdict,amount=p_amount,trans_ref=p_ref,raw=p_raw,note=p_note,verified_at=clock_timestamp() where id=s.id;
  perform set_config('app.completing_customer_tab_slip','',true);
  if p_verdict='valid' then
   insert into public.customer_tab_payments(tab_id,slip_id,trans_ref,amount,transferred_at) values(t.id,s.id,p_ref,p_amount,p_paid_at);
   perform public.refresh_customer_tab(t.id);
  end if;
 end if;
 select * into t from public.customer_tabs where id=t.id;
 return jsonb_build_object('tabId',t.id,'totalAmount',t.total_amount,'paidAmount',t.paid_amount,'remainingAmount',t.remaining_amount,'status',t.status);
end $$;

create or replace function public.guard_customer_tab_slip() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and old.customer_tab_id is not null and (new.customer_tab_id is distinct from old.customer_tab_id
  or new.customer_id is distinct from old.customer_id or new.tenant_id is distinct from old.tenant_id) then raise exception 'TAB_SLIP_SCOPE_IMMUTABLE';end if;
 if new.customer_tab_id is null then return new;end if;
 if tg_op='UPDATE' and old.status='valid' and (new.status<>old.status or new.amount is distinct from old.amount
  or new.trans_ref is distinct from old.trans_ref or new.customer_tab_id is distinct from old.customer_tab_id
  or new.customer_id is distinct from old.customer_id or new.tenant_id is distinct from old.tenant_id) then raise exception 'TAB_VERIFIED_PROOF_IMMUTABLE';end if;
 if new.status='valid' and (tg_op='INSERT' or old.status<>'valid') and coalesce(current_setting('app.completing_customer_tab_slip',true),'')<>'1' then
  raise exception 'TAB_PAYMENT_LEDGER_REQUIRED';end if;
 return new;
end $$;
drop trigger if exists customer_tab_slip_guard on public.slips;
create trigger customer_tab_slip_guard before insert or update on public.slips for each row execute function public.guard_customer_tab_slip();
revoke all on function public.guard_customer_tab_slip() from public,anon,authenticated;

create or replace function public.end_customer_tab_live(p_session uuid,p_tenant uuid,p_reminders boolean default true)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare sess public.live_sessions; ended timestamptz;
begin
 select * into sess from public.live_sessions where id=p_session and tenant_id=p_tenant for update;
 if not found then raise exception 'LIVE_SESSION_NOT_FOUND';end if;
 if exists(select 1 from public.auctions where tenant_id=p_tenant and page_id=sess.page_id and live_post_id=sess.live_post_id and status='active') then raise exception 'LIVE_AUCTION_STILL_ACTIVE';end if;
 ended:=coalesce(sess.ended_at,clock_timestamp());
 update public.live_sessions set ended_at=ended,reminders_enabled=p_reminders where id=sess.id;
 if p_reminders then
  insert into public.customer_tab_reminders(tab_id,stage,run_at)
   select id,'after_live_1h',ended+interval '1 hour' from public.customer_tabs where live_session_id=sess.id and remaining_amount>0 on conflict(tab_id,stage) do nothing;
  insert into public.customer_tab_reminders(tab_id,stage,run_at)
   select id,'next_morning',((date_trunc('day',ended at time zone 'Asia/Bangkok')+interval '1 day 9 hours') at time zone 'Asia/Bangkok')
    from public.customer_tabs where live_session_id=sess.id and remaining_amount>0 on conflict(tab_id,stage) do nothing;
 else update public.customer_tab_reminders set status='cancelled' where tab_id in(select id from public.customer_tabs where live_session_id=sess.id) and status in ('pending','blocked');end if;
end $$;

create or replace function public.queue_customer_tab_reminders(p_tenant uuid,p_customer uuid,p_request uuid) returns integer
language plpgsql set search_path=pg_catalog,public as $$
declare count_jobs integer;
begin
 if p_request is null then raise exception 'TAB_REQUEST_REQUIRED';end if;
 insert into public.customer_tab_reminders(tab_id,stage,run_at)
  select id,'manual:'||p_request::text,clock_timestamp() from public.customer_tabs
   where tenant_id=p_tenant and (p_customer is null or customer_id=p_customer) and remaining_amount>0
  on conflict(tab_id,stage) do nothing;
 get diagnostics count_jobs=row_count;return count_jobs;
end $$;
create or replace function public.claim_customer_tab_reminder() returns setof public.customer_tab_reminders
language plpgsql set search_path=pg_catalog,public as $$
begin
 update public.customer_tab_reminders set status='requires_review',error_code='LEASE_EXPIRED' where status='processing' and started_at<clock_timestamp()-interval '5 minutes';
 return query with next_job as(select job.id from public.customer_tab_reminders job join public.customer_tabs bill on bill.id=job.tab_id
  where job.status='pending' and job.run_at<=clock_timestamp() and bill.remaining_amount>0 order by job.run_at,job.id for update of job skip locked limit 1)
 update public.customer_tab_reminders job set status='processing',claim_token=gen_random_uuid(),started_at=clock_timestamp()
  from next_job where job.id=next_job.id returning job.*;
end $$;
revoke all on function public.refresh_customer_tab(uuid),public.attach_customer_tab_order(),public.sync_customer_tab_order(),public.claim_customer_tab_slip(uuid,uuid,text,text,uuid),public.complete_customer_tab_slip(uuid,uuid,uuid,text,numeric,text,timestamptz,jsonb,text),public.end_customer_tab_live(uuid,uuid,boolean),public.claim_customer_tab_reminder() from public,anon,authenticated;
grant execute on function public.refresh_customer_tab(uuid),public.claim_customer_tab_slip(uuid,uuid,text,text,uuid),public.complete_customer_tab_slip(uuid,uuid,uuid,text,numeric,text,timestamptz,jsonb,text),public.end_customer_tab_live(uuid,uuid,boolean),public.claim_customer_tab_reminder() to service_role;
revoke all on function public.queue_customer_tab_reminders(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.queue_customer_tab_reminders(uuid,uuid,uuid) to service_role;
create or replace function public.place_cf_order(
 p_tenant uuid,p_customer uuid,p_rule uuid,p_code text,p_comment text,p_post text,p_page text
) returns table(
 r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text
) language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.comment_rules;p public.products;v public.commerce_variants;o public.orders;
 price numeric;label text;new_id uuid;used integer;
begin
 if p_comment is null or length(p_comment) not between 1 and 512 or p_code is null then raise exception 'Invalid live comment' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant and is_active and page_id=p_page for update;
 if not found then raise exception 'Live CF Page not found' using errcode='42501';end if;
 if not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and platform='facebook') then raise exception 'Live CF customer not found' using errcode='42501';end if;
 select * into o from public.orders where tenant_id=p_tenant and source_id=p_comment and source in ('live_comment','facebook_comment') for update;
 if found then
  if o.source='facebook_comment' or o.status='cancelled' then return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;end if;
  if o.customer_id is distinct from p_customer or o.live_rule_id is distinct from p_rule or o.source_code is distinct from lower(trim(p_code)) then raise exception 'Live CF comment already used' using errcode='40001';end if;
  return query select 'created'::text,o.id,o.product_name,o.source_code,o.amount,o.variant_label;return;
 end if;
 select * into r from public.comment_rules where id=p_rule and tenant_id=p_tenant and mode='live_cf' and is_active and p_page=any(page_ids) for update;
 if not found or not(lower(trim(p_code))=any(r.keywords)) or (r.live_post_id is not null and regexp_replace(r.live_post_id,'^.*_','')<>regexp_replace(coalesce(p_post,''),'^.*_','')) then
  return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;
 end if;
 insert into public.live_cf_webhook_receipts(tenant_id,page_id,comment_id,live_rule_id)
 values(p_tenant,p_page,p_comment,p_rule) on conflict(tenant_id,page_id,comment_id) do nothing;
 select * into p from public.products where id=r.live_product_id and tenant_id=p_tenant and is_active and not commerce_archived for update;
 if not found then return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;end if;
 price:=p.price;label:=null;
 if r.live_variant_id is not null then
  select * into v from public.commerce_variants where id=r.live_variant_id and product_id=p.id and tenant_id=p_tenant and is_active for update;
  if not found then return query select 'no_match'::text,null::uuid,null::text,null::text,null::numeric,null::text;return;end if;
  price:=v.price;label:=v.label;
 elsif not r.live_customer_select_variant and exists(select 1 from public.commerce_variants where product_id=p.id and tenant_id=p_tenant and is_active) then
  return query select 'require_variant'::text,null::uuid,p.name,p_code,null::numeric,null::text;return;
 end if;
 select count(*) into used from public.orders where tenant_id=p_tenant and live_rule_id=r.id and status<>'cancelled';
 if p.stock<1 or (r.live_variant_id is not null and v.stock<1) or (r.live_stock_limit is not null and used>=r.live_stock_limit) then
  return query select 'sold_out'::text,null::uuid,p.name,p_code,price,label;return;
 end if;
 if r.live_deduct_stock then
  update public.products set stock=stock-1 where id=p.id and stock>0;
  if not found then return query select 'sold_out'::text,null::uuid,p.name,p_code,price,label;return;end if;
  if r.live_variant_id is not null then
   update public.commerce_variants set stock=stock-1 where id=v.id and stock>0;
   if not found then raise exception 'Live CF variant stock changed' using errcode='40001';end if;
  end if;
 end if;
 insert into public.orders(tenant_id,customer_id,product_id,product_name,amount,variant_id,variant_label,source,source_id,source_code,live_rule_id,live_bank_account_id,live_stock_deducted,live_variant_selection_required,live_post_id)
 values(p_tenant,p_customer,p.id,p.name,price,r.live_variant_id,label,'live_comment',p_comment,lower(trim(p_code)),r.id,r.live_bank_account_id,r.live_deduct_stock,r.live_customer_select_variant and exists(select 1 from public.commerce_variants where product_id=p.id and tenant_id=p_tenant and is_active),p_post) returning id into new_id;
 insert into public.commerce_audit(tenant_id,entity_id,action,detail) values(p_tenant,new_id,'live_cf_order',r.id::text);
 return query select 'created'::text,new_id,p.name,p_code,price,label;
end $$;
create or replace function public.guard_live_cf_variant_slip() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare total numeric;
begin
 if new.customer_tab_id is not null then
  if new.status='valid' and exists(select 1 from public.orders where customer_tab_id=new.customer_tab_id and status='pending_payment' and live_variant_selection_required and live_variant_confirmed_at is null) then raise exception 'LIVE_CF_VARIANT_REQUIRED';end if;
  return new;
 end if;
 if new.status<>'valid' or new.tenant_id is null or new.customer_id is null then return new;end if;
 if tg_op='UPDATE' and old.status='valid' then return new;end if;
 if not exists(select 1 from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id
  and status='pending_payment' and live_variant_selection_required) then return new;end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 perform 1 from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id and status='pending_payment' order by id for update;
 if exists(select 1 from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id
  and status='pending_payment' and live_variant_selection_required and live_variant_confirmed_at is null) then
  raise exception 'LIVE_CF_VARIANT_REQUIRED';end if;
 select sum(amount) into total from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id and status='pending_payment';
 if total is null or new.amount is null or round(new.amount*100)<>round(total*100) then raise exception 'LIVE_CF_PAYMENT_AMOUNT_CHANGED';end if;
 return new;
end $$;
create or replace function public.guard_live_cf_variant_payment() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s record;total numeric;
begin
 if new.customer_tab_id is not null and current_setting('app.refreshing_customer_tab',true)='1' then
  if new.status='paid' and new.live_variant_selection_required and new.live_variant_confirmed_at is null then raise exception 'LIVE_CF_VARIANT_REQUIRED';end if;
  return new;
 end if;
 if old.live_variant_selection_required and not new.live_variant_selection_required then
  raise exception 'LIVE_CF_SELECTION_LOCKED';end if;
 if not new.live_variant_selection_required then return new;end if;
 if old.live_variant_confirmed_at is not null and (new.variant_id is distinct from old.variant_id
  or new.amount is distinct from old.amount or new.live_variant_confirmed_at is distinct from old.live_variant_confirmed_at) then
  raise exception 'LIVE_CF_SELECTION_LOCKED';end if;
 if new.status='paid' and old.status is distinct from 'paid' then
  if old.status<>'pending_payment' then raise exception 'LIVE_CF_SELECTION_LOCKED';end if;
  if new.live_variant_confirmed_at is null or new.variant_id is null then raise exception 'LIVE_CF_VARIANT_REQUIRED';end if;
  select status,amount into s from public.slips where id=new.slip_id and tenant_id=new.tenant_id and customer_id=new.customer_id;
  if not found or s.status<>'valid' then raise exception 'LIVE_CF_PAYMENT_EVIDENCE_REQUIRED';end if;
  select sum(amount) into total from public.orders where tenant_id=new.tenant_id and customer_id=new.customer_id
   and (status='pending_payment' or status='paid' and slip_id=new.slip_id);
  if total is null or s.amount is null or round(s.amount*100)<>round(total*100) then raise exception 'LIVE_CF_PAYMENT_AMOUNT_CHANGED';end if;
 end if;
 return new;
end $$;
commit;
