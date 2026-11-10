-- Keep the auction headline price aligned with the confirmed bidder's own highest bid.
create or replace function public.sync_live_auction_confirmed_price()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
declare confirmed_amount numeric;
begin
 if new.winner_confirmation_comment_id is not null
  and new.winner_confirmation_comment_id is distinct from old.winner_confirmation_comment_id then
  select highest_amount into confirmed_amount
   from public.auction_winner_claims
   where auction_id=new.id and bidder_id=new.leading_bidder_id;
  if confirmed_amount is not null then
   new.current_price:=confirmed_amount;
  end if;
 end if;
 return new;
end $$;

drop trigger if exists auctions_sync_confirmed_winner_price on public.auctions;
create trigger auctions_sync_confirmed_winner_price
before update of winner_confirmation_comment_id on public.auctions
for each row execute function public.sync_live_auction_confirmed_price();

notify pgrst,'reload schema';
