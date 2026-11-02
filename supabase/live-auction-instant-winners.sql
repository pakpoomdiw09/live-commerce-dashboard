-- Apply after live-auction-dashboard.sql. Winner sends use the immediate per-auction outbox.
begin;
-- Upgrade only the previous built-in Session template; preserve merchant customizations.
update public.live_sessions set auction_settings=jsonb_set(auction_settings,'{privateText}',to_jsonb(E'ยินดีด้วยครับ คุณ {bidder_name} ชนะประมูล {product_name} ราคา {price} บาท\nยอดรวมบิลของคุณตอนนี้: {total} บาท\nเลขบัญชีรับเงิน: {bank_account}'::text)),automation_revision=automation_revision+1
 where auction_settings->>'privateText'=E'ยินดีด้วยครับ! คุณชนะประมูล {product_name} ราคา {price} บาท ยอดค้างชำระสุทธิ {total} บาท\nชำระเงิน / แนบสลิป: {payment_link}';
update public.auctions a set session_automation=s.auction_settings,private_reply_template=s.auction_settings->>'privateText'
 from public.live_sessions s where s.tenant_id=a.tenant_id and s.page_id=a.page_id and s.live_post_id=a.live_post_id
 and a.status='active' and a.session_automation is not null
 and a.private_reply_template=E'ยินดีด้วยครับ! คุณชนะประมูล {product_name} ราคา {price} บาท ยอดค้างชำระสุทธิ {total} บาท\nชำระเงิน / แนบสลิป: {payment_link}';
create or replace function public.live_auction_dashboard(p_tenant uuid,p_session uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare s public.live_sessions; result jsonb; slips jsonb; commenters jsonb; matched_people bigint;
begin
 select * into s from public.live_sessions where id=p_session and tenant_id=p_tenant;
 if not found then raise exception 'SESSION_NOT_FOUND' using errcode='P0002';end if;
 result:=public.live_session_dashboard(p_tenant,p_session);
 select coalesce(jsonb_agg(row order by row->>'at' desc,row->>'id'),'[]') into slips from (
  select jsonb_build_object('id',p.slip_id,'name',coalesce(c.display_name,c.platform_user_id),'amount',p.amount,'at',p.transferred_at,'transRef',proof.trans_ref,
   'senderName',coalesce(nullif(proof.raw->'data'->'sender'->>'displayName',''),nullif(proof.raw->'data'->'sender'->>'name','')),
   'senderBank',nullif(proof.raw->'data'->>'sendingBank','')) row
  from public.customer_tab_payments p join public.customer_tabs t on t.id=p.tab_id and t.tenant_id=p_tenant
  join public.customers c on c.id=t.customer_id and c.tenant_id=p_tenant
  join public.slips proof on proof.id=p.slip_id and proof.tenant_id=p_tenant and proof.status='valid'
  where t.live_session_id=s.id order by p.transferred_at desc,p.slip_id limit 500
 ) records;
 select coalesce(jsonb_agg(row||jsonb_build_object('customerId',(select c.id from public.customers c where c.tenant_id=p_tenant and c.platform='facebook' and c.platform_user_id=row->>'fbId')) order by row->>'at' desc,row->>'fbId'),'[]') into commenters from (
  select jsonb_build_object('fbId',v->'from'->>'id',
   'name',coalesce((array_agg(v->'from'->>'name' order by created_at desc))[1],v->'from'->>'id'),'at',max(created_at),'comments',count(*)) row
  from (select e.payload->'value' v,e.created_at from public.facebook_webhook_events e
   where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add'
   and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))) events
  where v->'from'->>'id' is not null and v->'from'->>'id'<>s.page_id
  group by v->'from'->>'id' order by max(created_at) desc limit 500
 ) records;
 with matched as (
  select b.bidder_id fb_id from public.auction_bids b join public.auctions a on a.id=b.auction_id
   where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and b.status in ('accepted','too_low','already_opened')
  union
  select e.payload->'value'->'from'->>'id' from public.facebook_webhook_events e join public.live_cf_webhook_receipts r
   on r.comment_id=e.payload->'value'->>'comment_id' and r.page_id=e.page_id and r.tenant_id=p_tenant
   where e.page_id=s.page_id and e.kind='change' and e.payload->'value'->>'verb'='add' and e.payload->'value'->>'item' in ('comment','live_comment') and (
    regexp_replace(e.payload->'value'->>'post_id','^.*_','')=s.live_post_id
    or e.payload->'value'->>'video_id'=s.live_post_id or e.payload->'value'->>'live_video_id'=s.live_post_id
    or exists(select 1 from public.auctions a where a.tenant_id=p_tenant and a.page_id=s.page_id and a.live_post_id=s.live_post_id and e.payload->'value'->>'post_id'=any(a.live_post_aliases)))
 ) select count(distinct fb_id) into matched_people from matched where fb_id is not null and fb_id<>s.page_id;
 result:=jsonb_set(result,'{metrics}',(result->'metrics')||jsonb_build_object('matchedPeople',matched_people));
 return result||jsonb_build_object('slips',slips,'commenters',commenters);
end $$;

commit;
