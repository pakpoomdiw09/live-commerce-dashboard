-- Return every eligible bidder and their personal maximum without PostgREST row caps.
create or replace function public.list_live_auction_winner_candidates(p_auction uuid,p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
 select coalesce(
  jsonb_agg(
   jsonb_build_object('bidder_id',candidate.bidder_id,'bidder_name',candidate.bidder_name,'bid_amount',candidate.bid_amount)
   order by candidate.bid_amount desc,candidate.bidder_id
  ),
  '[]'::jsonb
 )
 from (
  select distinct on (b.bidder_id) b.bidder_id,b.bidder_name,b.bid_amount
  from public.auction_bids b
  join public.auctions a on a.id=b.auction_id and a.tenant_id=p_tenant
  where a.id=p_auction and a.status='closed' and a.winner_confirmation_comment_id is null
   and a.closed_at>clock_timestamp()-interval '5 minutes'
   and b.status='accepted' and not b.is_opening and b.bidder_id is not null and b.bid_amount>0
   and b.bid_amount=public.auction_numeric_price(b.comment_text)
  order by b.bidder_id,b.bid_amount desc,b.created_at desc,b.id desc
 ) candidate
$$;

revoke all on function public.list_live_auction_winner_candidates(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_live_auction_winner_candidates(uuid,uuid) to service_role;

notify pgrst,'reload schema';
