-- Read-only A3 diagnostic. Kept outside the migration catalog intentionally.
-- No identities, messages, tokens or automatic repairs.
-- created_at is the canonical round start used by the TS poller and SQL guards.
select a.id as auction_id,a.tenant_id,a.page_id,a.live_post_id,
 a.created_at as started_at,a.closed_at,
 count(b.id) as bid_records,
 count(b.id) filter(where b.status='accepted') as accepted_bids,
 max(b.bid_amount) filter(where b.status='accepted') as highest_recorded_bid
from public.auctions a
join public.auction_bids b on b.auction_id=a.id
where a.status='closed' and a.winner_locked_at is null and a.order_id is null
group by a.id,a.tenant_id,a.page_id,a.live_post_id,a.created_at,a.closed_at
order by a.closed_at desc nulls last,a.id;
