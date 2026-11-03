-- Apply after live-auction-winner-confirmation.sql and customer-tabs.sql.
-- Winner Messenger slips settle the full current customer-tab bill atomically.
begin;

create or replace function public.complete_auction_customer_tab_slip(
 p_slip uuid,p_tenant uuid,p_customer uuid,p_sender text,p_amount numeric,
 p_ref text,p_paid_at timestamptz,p_raw jsonb,p_note text
)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.slips; t public.customer_tabs;
begin
 select * into s from public.slips
  where id=p_slip and tenant_id=p_tenant and customer_id=p_customer for update;
 if not found or s.status<>'pending' or s.customer_tab_id is null then
  raise exception 'AUCTION_TAB_SLIP_SCOPE' using errcode='42501';
 end if;
 select * into t from public.customer_tabs
  where id=s.customer_tab_id and tenant_id=p_tenant and customer_id=p_customer for update;
 if not found or t.remaining_amount<=0 or s.expected_amount is distinct from t.remaining_amount
  or p_amount is distinct from t.remaining_amount then
  raise exception 'AUCTION_TAB_AMOUNT_MISMATCH' using errcode='23514';
 end if;
 if not exists(select 1 from public.customers c where c.id=p_customer and c.tenant_id=p_tenant
  and c.platform='facebook' and c.platform_user_id=p_sender) then
  raise exception 'AUCTION_WINNER_MISMATCH' using errcode='42501';
 end if;
 if not exists(
  select 1 from public.orders o join public.auctions a on a.order_id=o.id
  where o.customer_tab_id=t.id and o.tenant_id=p_tenant and o.customer_id=p_customer
   and o.source='live_auction' and o.status='pending_payment'
   and a.tenant_id=p_tenant and a.status='closed' and a.leading_bidder_id=p_sender
 ) then
  raise exception 'AUCTION_WINNER_MISMATCH' using errcode='42501';
 end if;
 return public.complete_customer_tab_slip(
  p_slip,p_tenant,p_customer,'valid',p_amount,p_ref,p_paid_at,p_raw,p_note
 );
end $$;

revoke all on function public.complete_auction_customer_tab_slip(
 uuid,uuid,uuid,text,numeric,text,timestamptz,jsonb,text
) from public,anon,authenticated;
grant execute on function public.complete_auction_customer_tab_slip(
 uuid,uuid,uuid,text,numeric,text,timestamptz,jsonb,text
) to service_role;
commit;
