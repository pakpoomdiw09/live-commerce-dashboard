-- Apply after live-cf-customer-variants.sql and facebook-webhook-nonblocking.sql.
begin;
create table if not exists public.auctions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 page_id text not null, live_post_id text not null check(live_post_id ~ '^[0-9]+$'),
 live_post_aliases text[] not null default '{}',
 item_name text not null check(length(trim(item_name)) between 1 and 200),
 start_price numeric(12,2) not null check(start_price>0 and start_price<=999999999),
 min_step numeric(12,2) not null check(min_step>0 and min_step<=999999999),
 shipping_fee numeric(12,2) not null default 0 check(shipping_fee>=0 and shipping_fee<=999999),
 current_price numeric(12,2) not null default 0 check(current_price>=0),
 leading_bidder_id text, leading_bidder_name text, leading_comment_id text,
 host_ids text[] not null default '{}', host_count text,
 bank_account_id uuid not null references public.bank_accounts(id),
 status text not null default 'active' check(status in ('active','closed','cancelled')),
 closed_at timestamptz, close_event_id uuid references public.facebook_webhook_events(id),
 order_id uuid unique references public.orders(id),
 created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists auctions_one_active on public.auctions(page_id,live_post_id) where status='active';
create index if not exists auctions_tenant_recent on public.auctions(tenant_id,created_at desc);
create table if not exists public.auction_bids (
 id uuid primary key default gen_random_uuid(),
 auction_id uuid not null references public.auctions(id) on delete cascade,
 event_id uuid not null unique references public.facebook_webhook_events(id),
 comment_id text not null, bidder_id text not null, bidder_name text,
 comment_text text not null, bid_amount numeric(12,2), is_opening boolean not null default false,
 status text not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(auction_id,comment_id)
);
create index if not exists auction_bids_recent on public.auction_bids(auction_id,created_at desc);
-- Transactional outbox: finalizing a sale never depends on Graph availability.
create table if not exists public.auction_deliveries (
 id uuid primary key default gen_random_uuid(),
 auction_id uuid not null references public.auctions(id) on delete cascade,
 channel text not null check(channel in ('public','private')),
 comment_id text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','requires_review')),
 started_at timestamptz, completed_at timestamptz, error_code text,
 unique(auction_id,channel)
);
create table if not exists public.auction_payment_proofs (
 order_id uuid primary key references public.orders(id),
 tenant_id uuid not null references public.tenants(id),
 slip_id uuid not null unique references public.slips(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.auctions enable row level security;
alter table public.auction_bids enable row level security;
alter table public.auction_deliveries enable row level security;
alter table public.auction_payment_proofs enable row level security;
revoke all on public.auctions,public.auction_bids,public.auction_deliveries from public,anon,authenticated;
grant all on public.auctions,public.auction_bids,public.auction_deliveries to service_role;
revoke all on public.auction_payment_proofs from public,anon,authenticated;
grant all on public.auction_payment_proofs to service_role;

-- Public signed-link uploads are evidence for an owner to review, never proof of payment.
create or replace function public.submit_auction_payment_proof(p_order uuid,p_image text)
returns uuid language plpgsql set search_path=pg_catalog,public as $$
declare o public.orders; sid uuid;
begin
 select * into o from public.orders where id=p_order and source='live_auction' for update;
 if not found or o.status<>'pending_payment' then raise exception 'AUCTION_PAYMENT_LOCKED' using errcode='P0002';end if;
 if exists(select 1 from public.auction_payment_proofs where order_id=o.id) then
  raise exception 'AUCTION_PROOF_EXISTS' using errcode='23505';
 end if;
 insert into public.slips(tenant_id,customer_id,image_path,expected_amount,status,note)
  values(o.tenant_id,o.customer_id,p_image,o.amount,'error','หลักฐานชำระประมูล: รอเจ้าของร้านตรวจสอบและอนุมัติด้วยตนเอง') returning id into sid;
 insert into public.auction_payment_proofs(order_id,tenant_id,slip_id) values(o.id,o.tenant_id,sid);
 return sid;
end $$;

create or replace function public.approve_auction_payment_proof(p_slip uuid,p_tenant uuid,p_actor uuid)
returns timestamptz language plpgsql set search_path=pg_catalog,public as $$
declare s public.slips; o public.orders; approved timestamptz;
begin
 select slip.* into s from public.slips slip join public.auction_payment_proofs proof on proof.slip_id=slip.id
  where slip.id=p_slip and slip.tenant_id=p_tenant and proof.tenant_id=p_tenant for update of slip;
 if not found or s.status not in ('error','valid','fake','amount_mismatch','wrong_receiver') then
  raise exception 'AUCTION_PROOF_NOT_APPROVABLE' using errcode='42501';
 end if;
 select sale.* into o from public.orders sale join public.auction_payment_proofs proof on proof.order_id=sale.id
  where proof.slip_id=s.id and sale.tenant_id=p_tenant and sale.customer_id=s.customer_id for update of sale;
 if not found or o.status not in ('pending_payment','paid') then
  raise exception 'AUCTION_PAYMENT_LOCKED' using errcode='42501';
 end if;
 approved:=coalesce(s.approved_at,clock_timestamp());
 update public.slips set approved_at=approved,approved_by=coalesce(approved_by,p_actor) where id=s.id;
 update public.orders set status='paid',paid_at=approved,slip_id=s.id where id=o.id and status='pending_payment';
 return approved;
end $$;

-- Comments from different bidders/host must share an ordering barrier. Messages keep
-- their existing per-customer ordering. Normalize here too for older app instances.
create or replace function public.auction_comment_ordering() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.kind='change' and new.payload->>'field' in ('feed','live_comments')
    and new.payload->'value'->>'item'='comment' then
  new.ordering_key:='comments:'||new.page_id;
 end if;
 return new;
end $$;
drop trigger if exists auction_comment_ordering on public.facebook_webhook_events;
create trigger auction_comment_ordering before insert on public.facebook_webhook_events
 for each row execute function public.auction_comment_ordering();
update public.facebook_webhook_events set ordering_key='comments:'||page_id
 where kind='change' and payload->>'field' in ('feed','live_comments')
 and payload->'value'->>'item'='comment' and status in ('pending','processing');

-- Caller owns the auction row lock. Order and notification rows commit with close.
create or replace function public.finalize_live_auction(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; c public.customers; oid uuid;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if a.status<>'active' then return jsonb_build_object('status',a.status,'orderId',a.order_id);end if;
 if not p_cancel and a.leading_bidder_id is not null then
  insert into public.customers(platform,platform_user_id,tenant_id,display_name)
   values('facebook',a.leading_bidder_id,a.tenant_id,a.leading_bidder_name)
   on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id)
   returning * into c;
  if c.tenant_id is distinct from a.tenant_id then raise exception 'AUCTION_CUSTOMER_TENANT' using errcode='42501';end if;
  insert into public.orders(tenant_id,customer_id,product_name,amount,source,source_id,live_bank_account_id)
   values(a.tenant_id,c.id,a.item_name,a.current_price+a.shipping_fee,'live_auction',a.id::text,a.bank_account_id)
   returning id into oid;
  insert into public.auction_deliveries(auction_id,channel,comment_id) values(a.id,'private',a.leading_comment_id);
 end if;
 update public.auctions set status=case when p_cancel then 'cancelled' else 'closed' end,
  closed_at=clock_timestamp(),close_event_id=p_event,order_id=oid where id=a.id;
 if p_event is not null and not p_cancel then
  insert into public.auction_deliveries(auction_id,channel,comment_id)
   select a.id,'public',payload->'value'->>'comment_id' from public.facebook_webhook_events where id=p_event;
 end if;
 return jsonb_build_object('status',case when p_cancel then 'cancelled' else 'closed' end,'orderId',oid);
end $$;

create or replace function public.process_live_auction_comment(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; e public.facebook_webhook_events; v jsonb; prior jsonb; r jsonb;
 sender text; cid text; bidder text; amount numeric; minimum numeric; outcome text; host boolean;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value'; sender:=v->'from'->>'id'; cid:=v->>'comment_id';bidder:=left(v->'from'->>'name',200);
 if sender is null or cid is null or v->>'verb'<>'add' then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=split_part(v->>'post_id','_',array_length(string_to_array(v->>'post_id','_'),1))
   or a.live_post_id=v->>'video_id' or a.live_post_id=v->>'live_video_id'
   or v->>'post_id'=any(a.live_post_aliases)),false) then
  raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';
 end if;
 select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;
 if found then return prior;end if;
 if e.created_at<a.created_at then return jsonb_build_object('status','stale');end if;
 if coalesce(v->>'created_time','') ~ '^[0-9]{10}$' and (v->>'created_time')::numeric<floor(extract(epoch from a.created_at)) then
  return jsonb_build_object('status','stale');
 end if;
 -- No worker may overtake an earlier comment even if called outside the queue loop.
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id
  and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then
  raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';
 end if;
 host:=sender=a.page_id or sender=any(a.host_ids);
 minimum:=case when a.leading_bidder_id is null then a.start_price else a.current_price+a.min_step end;
 if a.status<>'active' then outcome:='closed';
 elsif p_kind='HOST_CONTROL' and host then
  if p_control='close' then r:=public.finalize_live_auction(a.id,a.tenant_id,e.id);outcome:='closed';
  elsif p_control in ('1','2','3','นับขิง') then
   update public.auctions set host_count=p_control where id=a.id;outcome:='count';
  else return jsonb_build_object('status','ignored');end if;
 elsif host or p_kind not in ('OPENING_BID','STEP_BID','NUMERIC_BID') then
  return jsonb_build_object('status','ignored');
 elsif p_kind='OPENING_BID' and a.leading_bidder_id is not null then outcome:='already_opened';
 else
  amount:=case when p_kind='OPENING_BID' then a.start_price when p_kind='STEP_BID' then minimum else p_amount end;
  if amount is null or amount<minimum or amount>999999999 or amount<>round(amount,2) then outcome:='too_low';
  else
   update public.auctions set current_price=amount,leading_bidder_id=sender,
    leading_bidder_name=bidder,leading_comment_id=cid,host_count=null where id=a.id;
   outcome:='accepted';
  end if;
 end if;
 r:=coalesce(r,jsonb_build_object('status',outcome,'amount',coalesce(amount,a.current_price),
  'minimum',minimum,'name',bidder,'isOpening',p_kind='OPENING_BID'));
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
  values(a.id,e.id,cid,sender,bidder,left(coalesce(v->>'message',''),2000),amount,p_kind='OPENING_BID',outcome,r);
 return r;
end $$;
revoke all on function public.auction_comment_ordering(),public.finalize_live_auction(uuid,uuid,uuid,boolean),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.finalize_live_auction(uuid,uuid,uuid,boolean),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) to service_role;
revoke all on function public.submit_auction_payment_proof(uuid,text) from public,anon,authenticated;
grant execute on function public.submit_auction_payment_proof(uuid,text) to service_role;
revoke all on function public.approve_auction_payment_proof(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_auction_payment_proof(uuid,uuid,uuid) to service_role;
commit;
