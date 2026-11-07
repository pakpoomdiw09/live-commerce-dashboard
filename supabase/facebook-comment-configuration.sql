-- Requires the commerce/live-auction tables and ledgers. No dependency on an installed resolver body.
-- Rerunnable configuration upgrade; no event replay, invoices or sends during installation.
begin;
-- Preserve function identities/dependencies for compatible definitions. PostgreSQL cannot
-- replace input argument names or return types; drop only that incompatible identity.
-- Never CASCADE: unrelated overloads, tables, policies and dependent objects stay intact.
do $resolver_identities$
declare expected record;installed record;identity regprocedure;
begin
 for expected in select * from (values
  ('public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)','p_auction,p_tenant,p_event,p_kind,p_amount,p_control','jsonb',2),
  ('public.process_live_auction_highest_bid(uuid,uuid,uuid,text,numeric,text)','p_auction,p_tenant,p_event,p_kind,p_amount,p_control','jsonb',2),
  ('public.finalize_live_auction_highest_bid(uuid,uuid,uuid,boolean)','p_auction,p_tenant,p_event,p_cancel','jsonb',2),
  ('public.resolve_facebook_comment_settings(jsonb,jsonb)','session,snapshot','jsonb',1),
  ('public.first_configured_facebook_comment_tags(jsonb)','candidates','jsonb',0),
  ('public.facebook_comment_context(uuid,text,text[])','p_tenant,p_page,p_posts','jsonb',0),
  ('public.save_facebook_comment_config(uuid,uuid,uuid,jsonb)','p_tenant,p_session,p_actor,p_settings','jsonb',0),
  ('public.normalize_auction_tag(text)','value','text',0),
  ('public.auction_comment_tags(jsonb,text,text)','settings,field,fallback','text[]',0),
  ('public.auction_close_keyword_matches(text,jsonb)','message,keywords','boolean',0)
 ) as definitions(signature,names,result_type,defaults) loop
  identity:=to_regprocedure(expected.signature);
  if identity is null then continue;end if;
  select proargnames[1:pronargs] names,prorettype,proretset,proargmodes,pronargdefaults into installed from pg_proc where oid=identity;
  if installed.names is distinct from string_to_array(expected.names,',')
   or installed.prorettype<>expected.result_type::regtype or installed.proretset
   or installed.proargmodes is not null or installed.pronargdefaults>expected.defaults then
   execute format('drop function if exists %s',identity);
  end if;
 end loop;
end $resolver_identities$;

alter table public.auctions add column if not exists winner_locked_at timestamptz;
create or replace function public.normalize_auction_tag(value text) returns text
language sql immutable set search_path=pg_catalog,public as $$
 select translate(lower(btrim(regexp_replace(normalize(coalesce(value,''),NFKC),'\s+',' ','g'))),U&'\FE0E\FE0F','')
$$;
create or replace function public.auction_comment_tags(settings jsonb,field text,fallback text) returns text[]
language sql immutable set search_path=pg_catalog,public as $$
 select coalesce(array_agg(distinct token) filter(where token<>''),array[fallback])
 from (select public.normalize_auction_tag(tag) token from jsonb_array_elements_text(
  case when jsonb_typeof(settings->field)='array' then settings->field else '[]'::jsonb end) tag) tags
$$;
create or replace function public.auction_close_keyword_matches(message text,keywords jsonb) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
 select public.normalize_auction_tag(message)=any(public.auction_comment_tags(jsonb_build_object('closeKeywords',keywords),'closeKeywords','ปิด'))
$$;


alter table public.live_sessions add column if not exists mode text check(mode in ('auction','cf','auto')),
 add column if not exists confirmation_keywords text[], add column if not exists closing_keywords text[],
 add column if not exists cf_patterns jsonb not null default '[]',
 add column if not exists comment_settings jsonb not null default '{}';
create table if not exists public.facebook_comment_defaults (
 id boolean primary key default true check(id),settings jsonb not null
);
alter table public.facebook_comment_defaults enable row level security;
revoke all on public.facebook_comment_defaults from public,anon,authenticated;
grant all on public.facebook_comment_defaults to service_role;
insert into public.facebook_comment_defaults(id,settings) values(true,
 '{"confirmation_tags":["1"],"closing_tags":["ปิด"],"opening_tags":[],"counting_tags":{}}') on conflict do nothing;

-- Skip empty/invalid arrays after normalization and preserve configured tag order.
create or replace function public.first_configured_facebook_comment_tags(candidates jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare candidate jsonb;tag jsonb;token text;tags text[];
begin
 for candidate in select value from jsonb_array_elements(candidates) loop
  if jsonb_typeof(candidate)<>'array' then continue;end if;
  tags:='{}';
  for tag in select value from jsonb_array_elements(candidate) loop
   if jsonb_typeof(tag)<>'string' then continue;end if;
   token:=public.normalize_auction_tag(tag#>>'{}');
   if token<>'' and not token=any(tags) then tags:=array_append(tags,token);end if;
  end loop;
  if cardinality(tags)>0 then return to_jsonb(tags);end if;
 end loop;
 return '[]'::jsonb;
end $$;

create or replace function public.resolve_facebook_comment_settings(session jsonb,snapshot jsonb default '{}')
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare defaults jsonb;raw jsonb;confirmation jsonb;closing jsonb;
begin
 select settings into defaults from public.facebook_comment_defaults where id;
 raw:=coalesce(snapshot,'{}')||coalesce(nullif(session->'auction_settings','null'),'{}')||coalesce(nullif(session->'comment_settings','null'),'{}');
 -- Exact counterpart of comment-config.ts tagCandidates: dashboard, aliases, snapshot, defaults.
 confirmation:=public.first_configured_facebook_comment_tags(jsonb_build_array(
  session->'auction_settings'->'keywords',session->'keywords',session->'confirmation_keywords',session->'confirmation_tags',
  session->'comment_settings'->'confirmation_keywords',session->'comment_settings'->'confirmation_tags',session->'comment_settings'->'keywords',
  session->'auction_settings'->'confirmation_keywords',session->'auction_settings'->'confirmation_tags',
  snapshot->'auction_settings'->'keywords',snapshot->'keywords',snapshot->'confirmation_keywords',snapshot->'confirmation_tags',
  snapshot->'comment_settings'->'confirmation_keywords',snapshot->'comment_settings'->'confirmation_tags',snapshot->'comment_settings'->'keywords',
  snapshot->'auction_settings'->'confirmation_keywords',snapshot->'auction_settings'->'confirmation_tags',defaults->'confirmation_tags'));
 closing:=public.first_configured_facebook_comment_tags(jsonb_build_array(
  session->'auction_settings'->'closeKeywords',session->'closeKeywords',session->'closing_keywords',session->'closing_tags',
  session->'comment_settings'->'closing_keywords',session->'comment_settings'->'closing_tags',session->'comment_settings'->'closeKeywords',
  session->'auction_settings'->'closing_keywords',session->'auction_settings'->'closing_tags',
  snapshot->'auction_settings'->'closeKeywords',snapshot->'closeKeywords',snapshot->'closing_keywords',snapshot->'closing_tags',
  snapshot->'comment_settings'->'closing_keywords',snapshot->'comment_settings'->'closing_tags',snapshot->'comment_settings'->'closeKeywords',
  snapshot->'auction_settings'->'closing_keywords',snapshot->'auction_settings'->'closing_tags',defaults->'closing_tags'));
 return defaults||raw||jsonb_build_object('confirmation_tags',confirmation,'keywords',confirmation,'closing_tags',closing,'closeKeywords',closing);
end $$;

create or replace function public.facebook_comment_context(p_tenant uuid,p_page text,p_posts text[])
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare s public.live_sessions;defaults jsonb;raw jsonb;settings jsonb;mode text;confirm jsonb;closing jsonb;
begin
 if not exists(select 1 from public.tenants where id=p_tenant and page_id=p_page and is_active) then
  raise exception 'COMMENT_TENANT_PAGE_INVALID' using errcode='42501';end if;
 select d.settings into defaults from public.facebook_comment_defaults d where id;
 select * into s from public.live_sessions where tenant_id=p_tenant and page_id=p_page
  and live_post_id in (select regexp_replace(post,'^.*_','') from unnest(p_posts) post)
  order by created_at desc limit 1;
 raw:=coalesce(s.auction_settings,'{}')||coalesce(s.comment_settings,'{}');
 settings:=public.resolve_facebook_comment_settings(to_jsonb(s),coalesce((select a.session_automation from public.auctions a where a.tenant_id=p_tenant and a.page_id=p_page
  and a.live_post_id in (select regexp_replace(post,'^.*_','') from unnest(p_posts) post) order by a.created_at desc limit 1),'{}'));
 mode:=coalesce(s.mode,raw->>'mode');
 if mode is null then
  mode:=case when exists(select 1 from public.auctions where tenant_id=p_tenant and page_id=p_page
    and live_post_id in (select regexp_replace(post,'^.*_','') from unnest(p_posts) post)) then 'auction' else 'cf' end;
 end if;
 return jsonb_build_object('mode',mode,'session',case when s.id is null then '{}'::jsonb else to_jsonb(s) end,'settings',settings);
end $$;

create or replace function public.save_facebook_comment_config(p_tenant uuid,p_session uuid,p_actor uuid,p_settings jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.live_sessions;key text;tags jsonb;pattern jsonb;
begin
 if not(exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='owner')
  or exists(select 1 from public.platform_admins where user_id=p_actor)) then raise exception 'COMMENT_CONFIG_FORBIDDEN' using errcode='42501';end if;
 if jsonb_typeof(p_settings)<>'object' or octet_length(p_settings::text)>40000
  or (p_settings ? 'mode' and p_settings->>'mode' not in ('auction','cf','auto')) then raise exception 'COMMENT_CONFIG_INVALID' using errcode='22023';end if;
 foreach key in array array['confirmation_keywords','closing_keywords','confirmation_tags','closing_tags','opening_tags'] loop
  tags:=p_settings->key;
  if tags is not null and (jsonb_typeof(tags)<>'array' or jsonb_array_length(tags)>1000) then raise exception 'COMMENT_TAGS_INVALID' using errcode='22023';end if;
  if tags is not null and exists(select 1 from jsonb_array_elements(tags) t where jsonb_typeof(t)<>'string' or length(t#>>'{}')>100) then
   raise exception 'COMMENT_TAGS_INVALID' using errcode='22023';end if;
 end loop;
 if p_settings ? 'cf_patterns' and (jsonb_typeof(p_settings->'cf_patterns')<>'array' or jsonb_array_length(p_settings->'cf_patterns')>1000) then
  raise exception 'COMMENT_PATTERNS_INVALID' using errcode='22023';end if;
 for pattern in select * from jsonb_array_elements(coalesce(p_settings->'cf_patterns','[]')) loop
  if jsonb_typeof(pattern)<>'object' or coalesce(jsonb_typeof(pattern->'code'),'null')<>'string'
   or coalesce(jsonb_typeof(pattern->'keywords'),'null')<>'array' or coalesce(pattern->>'match_mode','strict') not in ('strict','flexible') then
   raise exception 'COMMENT_PATTERNS_INVALID' using errcode='22023';end if;
 end loop;
 foreach key in array array['private_reply_template','public_reply_template','privateText','bidText','closeText'] loop
  if p_settings ? key and (jsonb_typeof(p_settings->key)<>'string' or length(p_settings->>key)>2000) then
   raise exception 'COMMENT_TEMPLATE_INVALID' using errcode='22023';end if;
 end loop;
 foreach key in array array['privateReply','publicReply','closeEnabled','countEnabled','heartCloses'] loop
  if p_settings ? key and jsonb_typeof(p_settings->key)<>'boolean' then raise exception 'COMMENT_SETTING_INVALID' using errcode='22023';end if;
 end loop;
 if p_settings ? 'counting_tags' then
  if jsonb_typeof(p_settings->'counting_tags')<>'object' then raise exception 'COMMENT_COUNTING_TAGS_INVALID' using errcode='22023';end if;
  if exists(select 1 from jsonb_each(p_settings->'counting_tags') e where jsonb_typeof(e.value)<>'string' or length(e.key)>100 or length(e.value#>>'{}')>100) then
   raise exception 'COMMENT_COUNTING_TAGS_INVALID' using errcode='22023';end if;
 end if;
 select * into s from public.live_sessions where id=p_session and tenant_id=p_tenant for update;
 if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
 update public.live_sessions set mode=coalesce(p_settings->>'mode',mode),
  confirmation_keywords=case when p_settings ? 'confirmation_keywords' then array(select jsonb_array_elements_text(p_settings->'confirmation_keywords')) else confirmation_keywords end,
  closing_keywords=case when p_settings ? 'closing_keywords' then array(select jsonb_array_elements_text(p_settings->'closing_keywords')) else closing_keywords end,
  cf_patterns=coalesce(p_settings->'cf_patterns',cf_patterns),comment_settings=comment_settings||p_settings,
  automation_revision=automation_revision+1 where id=s.id returning * into s;
 return public.facebook_comment_context(p_tenant,s.page_id,array[s.live_post_id]);
end $$;

create or replace function public.stamp_facebook_catalog_post() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.source='facebook_comment' and nullif(current_setting('app.facebook_comment_post',true),'') is not null then
  new.live_post_id:=current_setting('app.facebook_comment_post',true);
 end if;return new;
end $$;
drop trigger if exists a_stamp_facebook_catalog_post on public.orders;
create trigger a_stamp_facebook_catalog_post before insert on public.orders for each row execute function public.stamp_facebook_catalog_post();

create or replace function public.place_facebook_catalog_order(p_tenant uuid,p_customer uuid,p_page text,p_post text,p_comment text,p_text text)
returns table(r_status text,r_order_id uuid,r_name text,r_code text,r_amount numeric,r_variant_label text)
language plpgsql set search_path=pg_catalog,public as $$
declare context jsonb;patterns jsonb;text text;code text;matches text[];previous text;
begin
 context:=public.facebook_comment_context(p_tenant,p_page,array[p_post]);
 if context->>'mode'<>'cf' then return query select 'no_match',null::uuid,null::text,null::text,null::numeric,null::text;return;end if;
 if not exists(select 1 from public.customers where id=p_customer and tenant_id=p_tenant and platform='facebook') then raise exception 'COMMENT_CUSTOMER_INVALID' using errcode='42501';end if;
 patterns:=coalesce(context->'session'->'cf_patterns','[]');text:=public.normalize_auction_tag(p_text);
 with catalog as (
  select p.code from public.products p where p.tenant_id=p_tenant and p.is_active and not p.commerce_archived
  union select v.variant_code from public.commerce_variants v join public.products p on p.id=v.product_id and p.tenant_id=v.tenant_id
   where v.tenant_id=p_tenant and v.is_active and p.is_active and not p.commerce_archived
 ), matching as (
  select distinct c.code from catalog c where nullif(c.code,'') is not null and (
   public.normalize_auction_tag(c.code)=any(string_to_array(text,' ')) or public.normalize_auction_tag(c.code)=text
   or exists(select 1 from jsonb_array_elements(patterns) pattern
    where public.normalize_auction_tag(pattern->>'code')=public.normalize_auction_tag(c.code)
    and exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(pattern->'keywords')='array' then pattern->'keywords' else '[]'::jsonb end) keyword
     where public.normalize_auction_tag(keyword)<>'' and
     case when pattern->>'match_mode'='flexible' then position(public.normalize_auction_tag(keyword) in text)>0 else public.normalize_auction_tag(keyword)=text end))
  )
 ) select array_agg(matching.code) into matches from matching;
 if coalesce(cardinality(matches),0)<>1 then return query select 'no_match',null::uuid,null::text,null::text,null::numeric,null::text;return;end if;
 code:=matches[1];previous:=current_setting('app.facebook_comment_post',true);
 perform set_config('app.facebook_comment_post',coalesce(p_post,''),true);
 return query select * from public.place_cf_order_core(p_tenant,p_customer,null,code,'facebook_comment',p_comment);
 perform set_config('app.facebook_comment_post',coalesce(previous,''),true);
end $$;

-- Explicit definitions: independent of the installed resolver body or formatting.
create or replace function public.process_live_auction_highest_bid(p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null)
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
 if a.session_automation ? 'closeKeywords' then
  if host then
   if public.auction_close_keyword_matches(v->>'message',a.session_automation->'closeKeywords') then p_kind:='HOST_CONTROL';p_control:='close';
   else return jsonb_build_object('status','ignored');end if;
  elsif exists(select 1 from jsonb_array_elements_text(a.session_automation->'keywords') k where k=lower(regexp_replace(normalize(trim(coalesce(v->>'message','')),NFKC),'\s+',' ','g'))) then p_kind:='STEP_BID';
  elsif p_kind not in ('NUMERIC_BID','OPENING_BID') then return jsonb_build_object('status','ignored');end if;
 end if;

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

create or replace function public.finalize_live_auction_highest_bid(p_auction uuid,p_tenant uuid,p_event uuid default null,p_cancel boolean default false)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions; c public.customers; oid uuid; tab public.customer_tabs;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if a.status<>'active' and not (a.status='closed' and a.winner_locked_at is not null and a.winner_confirmation_comment_id is not null and a.order_id is null) then return jsonb_build_object('status',a.status,'orderId',a.order_id);end if;
 if not p_cancel and a.leading_bidder_id is not null then
  insert into public.customers(platform,platform_user_id,tenant_id,display_name)
   values('facebook',a.leading_bidder_id,a.tenant_id,a.leading_bidder_name)
   on conflict(platform,platform_user_id) do update set tenant_id=coalesce(customers.tenant_id,excluded.tenant_id)
   returning * into c;
  if c.tenant_id is distinct from a.tenant_id then raise exception 'AUCTION_CUSTOMER_TENANT' using errcode='42501';end if;
  -- The existing order trigger attaches CF/auction items to the same tab under its row lock.
  insert into public.orders(tenant_id,customer_id,product_name,amount,source,source_id,live_bank_account_id)
   values(a.tenant_id,c.id,a.item_name,a.current_price+a.shipping_fee,'live_auction',a.id::text,a.bank_account_id)
   returning id into oid;
  select t.* into strict tab from public.customer_tabs t join public.orders o on o.customer_tab_id=t.id where o.id=oid;
  update public.customers set conversation_status='open',
    conversation_version=conversation_version+1,
    order_status=case when tab.remaining_amount>0 then 'pending_review' else 'paid' end
   where id=c.id;
  -- This is a local activity note, never an invented Messenger send or inbound message.
  -- Do not extend last_message_at/window_expires_at/inbound_seq from an auction.
  insert into public.messages(customer_id,external_id,sender,body,delivery_status)
   values(c.id,'auction-event:'||a.id::text,'bot',
    'บันทึกระบบ: ชนะประมูล '||a.item_name||' - '||case when tab.remaining_amount>0 then 'รอชำระเงิน' else 'ชำระครบแล้ว' end||
    ' • ยอดคงเหลือสุทธิ '||tab.remaining_amount::text||' บาท',null)
   on conflict(external_id) do nothing;
  if a.private_reply_enabled then
   insert into public.auction_deliveries(auction_id,channel,comment_id) values(a.id,'private',a.leading_comment_id);
   insert into public.messages(customer_id,external_id,sender,body,delivery_status)
    values(c.id,'auction-bill:'||a.id::text,'bot','รอส่งสรุปยอดประมูล '||a.item_name||' เข้า Messenger','pending')
    on conflict(external_id) do nothing;
  end if;
 end if;
 update public.auctions set status=case when p_cancel then 'cancelled' else 'closed' end,
  closed_at=clock_timestamp(),close_event_id=p_event,order_id=oid where id=a.id;
 if not p_cancel and a.public_reply_enabled and a.leading_bidder_id is not null and a.session_automation ? 'closeKeywords' then
  insert into public.auction_deliveries(auction_id,channel,comment_id) values(a.id,'public',a.leading_comment_id) on conflict(auction_id,channel) where claim_id is null do nothing;
 elsif p_event is not null and not p_cancel and a.public_reply_enabled then
  insert into public.auction_deliveries(auction_id,channel,comment_id)
   select a.id,'public',payload->'value'->>'comment_id' from public.facebook_webhook_events where id=p_event;
 end if;
 return jsonb_build_object('status',case when p_cancel then 'cancelled' else 'closed' end,'orderId',oid);
end $$;

create or replace function public.process_live_auction_comment(
 p_auction uuid,p_tenant uuid,p_event uuid,p_kind text,p_amount numeric default null,p_control text default null
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a public.auctions;e public.facebook_webhook_events;v jsonb;prior jsonb;r jsonb;
 sender text;cid text;message text;keywords text[];close_keywords text[];settings jsonb;host boolean;confirming boolean;numeric_price numeric;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 if not exists(select 1 from public.tenants where id=p_tenant and page_id=a.page_id and is_active) then
  raise exception 'AUCTION_TENANT_INVALID' using errcode='42501';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found or e.kind<>'change' then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 v:=e.payload->'value';sender:=v->'from'->>'id';cid:=v->>'comment_id';
 if sender is null or cid is null or v->>'verb' is distinct from 'add'
  or coalesce(v->>'item','') not in ('comment','live_comment') then return jsonb_build_object('status','ignored');end if;
 if not coalesce((a.live_post_id=regexp_replace(v->>'post_id','^.*_','') or a.live_post_id=v->>'video_id'
  or a.live_post_id=v->>'live_video_id' or v->>'post_id'=any(a.live_post_aliases)),false) then
  raise exception 'AUCTION_POST_MISMATCH' using errcode='42501';end if;
 select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;
 if found then return prior;end if;
 if e.created_at<a.created_at then return jsonb_build_object('status','stale');end if;
 if exists(select 1 from public.facebook_webhook_events older where older.page_id=e.page_id
  and older.ordering_key=e.ordering_key and older.sequence<e.sequence and older.status in ('pending','processing')) then
  raise exception 'AUCTION_EVENT_OUT_OF_ORDER' using errcode='40001';end if;
 host:=sender=a.page_id or sender=any(a.host_ids);
 settings:=public.resolve_facebook_comment_settings(
  (public.facebook_comment_context(p_tenant,a.page_id,array[a.live_post_id]))->'session',a.session_automation);
 if (public.facebook_comment_context(p_tenant,a.page_id,array[a.live_post_id]))->>'mode'<>'auction' then
  return jsonb_build_object('status','ignored','reason','SESSION_MODE');end if;
 message:=public.normalize_auction_tag(v->>'message');
 keywords:=public.auction_comment_tags(settings,'keywords',settings->'confirmation_tags'->>0);
 close_keywords:=public.auction_comment_tags(settings,'closeKeywords','ปิด');
 confirming:=not host and message=any(keywords);
 if a.session_automation is distinct from settings then
  update public.auctions set session_automation=settings,
   private_reply_template=coalesce(settings->>'private_reply_template',settings->>'privateText',private_reply_template),
   bid_reply_template=coalesce(settings->>'public_reply_template',settings->>'bidText',bid_reply_template),
   private_reply_enabled=coalesce((settings->>'privateReply')::boolean,private_reply_enabled),
   public_reply_enabled=coalesce((settings->>'publicReply')::boolean,public_reply_enabled) where id=a.id;
 end if;
 if host and a.status='active' and coalesce((settings->>'closeEnabled')::boolean,true)
  and message=any(close_keywords) then
  update public.auctions set status='closed',closed_at=clock_timestamp(),close_event_id=e.id,
   winner_locked_at=clock_timestamp() where id=a.id;
  r:=jsonb_build_object('status','awaiting_confirmation','amount',a.current_price,'winnerId',a.leading_bidder_id);
  insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
   values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,'closed',r);
  return r;
 end if;
 if host and a.status='active' and coalesce((settings->>'countEnabled')::boolean,false)
  and settings->'counting_tags' ? message and not message=any(close_keywords) then
  update public.auctions set host_count=settings->'counting_tags'->>message where id=a.id;
  r:=jsonb_build_object('status','count');
  insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,comment_text,status,result)
   values(a.id,e.id,cid,sender,left(v->>'message',2000),'count',r);return r;
 end if;
 if host then return jsonb_build_object('status','ignored');end if;
 if a.status<>'active' and not (a.status='closed' and a.winner_locked_at is not null and a.order_id is null and confirming) then
  return jsonb_build_object('status','closed','orderId',a.order_id);end if;
 if not confirming then
  numeric_price:=public.auction_numeric_price(v->>'message');
  return public.process_live_auction_highest_bid(p_auction,p_tenant,p_event,
   case when numeric_price is not null and not host then 'NUMERIC_BID' else case when not host and message<>'' and message=any(public.auction_comment_tags(settings,'opening_tags','')) then 'OPENING_BID' else 'IGNORE' end end,
   case when numeric_price is not null then numeric_price else null end,p_control);
 end if;
 if sender is distinct from a.leading_bidder_id or a.current_price<=0 then
  r:=jsonb_build_object('status','not_winner');
 else
  -- The leader and price cannot change until the invoice/outbox transaction commits.
  update public.auctions set winner_confirmation_comment_id=cid,winner_confirmation_event_id=e.id,
   winner_confirmed_at=clock_timestamp() where id=a.id;
  r:=public.finalize_live_auction_highest_bid(a.id,a.tenant_id,e.id);
  update public.auction_deliveries set comment_id=cid
   where auction_id=a.id and status in ('pending','awaiting_confirmation');
  r:=r||jsonb_build_object('status','confirmed','amount',a.current_price,'name',a.leading_bidder_name);
 end if;
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
 values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,r->>'status',r);
 return r;
end $$;
revoke all on function public.first_configured_facebook_comment_tags(jsonb),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text),
 public.process_live_auction_highest_bid(uuid,uuid,uuid,text,numeric,text),public.finalize_live_auction_highest_bid(uuid,uuid,uuid,boolean),
 public.normalize_auction_tag(text),public.auction_comment_tags(jsonb,text,text),public.auction_close_keyword_matches(text,jsonb),
 public.resolve_facebook_comment_settings(jsonb,jsonb),public.facebook_comment_context(uuid,text,text[]),public.save_facebook_comment_config(uuid,uuid,uuid,jsonb),
 public.place_facebook_catalog_order(uuid,uuid,text,text,text,text),public.stamp_facebook_catalog_post() from public,anon,authenticated;
grant execute on function public.first_configured_facebook_comment_tags(jsonb),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text),
 public.process_live_auction_highest_bid(uuid,uuid,uuid,text,numeric,text),public.finalize_live_auction_highest_bid(uuid,uuid,uuid,boolean),
 public.normalize_auction_tag(text),public.auction_comment_tags(jsonb,text,text),public.auction_close_keyword_matches(text,jsonb),
 public.resolve_facebook_comment_settings(jsonb,jsonb),public.facebook_comment_context(uuid,text,text[]),public.save_facebook_comment_config(uuid,uuid,uuid,jsonb),
 public.place_facebook_catalog_order(uuid,uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
