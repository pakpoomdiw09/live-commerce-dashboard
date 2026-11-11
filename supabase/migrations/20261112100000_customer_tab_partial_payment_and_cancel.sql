begin;

-- Customer tab payments are ledger entries and may cover part of the current balance.
-- Recheck the live balance while holding the tab lock so concurrent receipts cannot
-- create an overpayment credit or mark more than the outstanding amount as paid.
create or replace function public.complete_customer_tab_slip(
  p_slip uuid,
  p_tenant uuid,
  p_customer uuid,
  p_verdict text,
  p_amount numeric,
  p_ref text,
  p_paid_at timestamptz,
  p_raw jsonb,
  p_note text
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  slip_row public.slips;
  tab_row public.customer_tabs;
  final_verdict text := p_verdict;
  final_note text := p_note;
begin
  select * into slip_row
  from public.slips
  where id = p_slip and tenant_id = p_tenant and customer_id = p_customer
  for update;
  if not found or slip_row.customer_tab_id is null then
    raise exception 'TAB_SLIP_SCOPE';
  end if;

  select * into tab_row
  from public.customer_tabs
  where id = slip_row.customer_tab_id
    and tenant_id = p_tenant
    and customer_id = p_customer
  for update;
  if not found then raise exception 'TAB_SLIP_SCOPE'; end if;

  if slip_row.status = 'pending' then
    if final_verdict = 'valid' and (
      p_amount is null
      or p_amount <= 0
      or p_amount <> round(p_amount, 2)
      or nullif(trim(p_ref), '') is null
      or p_paid_at is null
      or p_paid_at < tab_row.created_at - interval '60 seconds'
      or p_paid_at > clock_timestamp() + interval '2 minutes'
    ) then
      raise exception 'TAB_PAYMENT_EVIDENCE_INVALID';
    end if;

    if final_verdict = 'valid' and p_amount > tab_row.remaining_amount then
      final_verdict := 'amount_mismatch';
      final_note := format(
        'ยอดโอน %s บาทสูงกว่ายอดคงเหลือ %s บาท ระบบจึงยังไม่ตัดยอด',
        to_char(p_amount, 'FM999999999999990.00'),
        to_char(tab_row.remaining_amount, 'FM999999999999990.00')
      );
    end if;

    perform set_config('app.completing_customer_tab_slip', '1', true);
    update public.slips
    set status = final_verdict,
        amount = p_amount,
        trans_ref = p_ref,
        raw = p_raw,
        note = final_note,
        verified_at = clock_timestamp()
    where id = slip_row.id;
    perform set_config('app.completing_customer_tab_slip', '', true);

    if final_verdict = 'valid' then
      insert into public.customer_tab_payments(tab_id, slip_id, trans_ref, amount, transferred_at)
      values (tab_row.id, slip_row.id, p_ref, p_amount, p_paid_at);
      perform public.refresh_customer_tab(tab_row.id);
    end if;
  end if;

  select * into slip_row from public.slips where id = p_slip;
  select * into tab_row from public.customer_tabs where id = slip_row.customer_tab_id;
  return jsonb_build_object(
    'tabId', tab_row.id,
    'totalAmount', tab_row.total_amount,
    'paidAmount', tab_row.paid_amount,
    'remainingAmount', tab_row.remaining_amount,
    'status', tab_row.status,
    'verdict', slip_row.status,
    'note', slip_row.note
  );
end;
$$;

-- Auction receipts still require the correct winner and an open auction order,
-- but that winner may pay the customer tab in multiple verified transfers.
create or replace function public.complete_auction_customer_tab_slip(
  p_slip uuid,
  p_tenant uuid,
  p_customer uuid,
  p_sender text,
  p_amount numeric,
  p_ref text,
  p_paid_at timestamptz,
  p_raw jsonb,
  p_note text
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  slip_row public.slips;
  tab_row public.customer_tabs;
begin
  select * into slip_row
  from public.slips
  where id = p_slip and tenant_id = p_tenant and customer_id = p_customer
  for update;
  if not found or slip_row.status <> 'pending' or slip_row.customer_tab_id is null then
    raise exception 'AUCTION_TAB_SLIP_SCOPE' using errcode = '42501';
  end if;

  select * into tab_row
  from public.customer_tabs
  where id = slip_row.customer_tab_id
    and tenant_id = p_tenant
    and customer_id = p_customer
  for update;
  if not found or tab_row.remaining_amount <= 0 or p_amount is null or p_amount <= 0 then
    raise exception 'AUCTION_TAB_SLIP_SCOPE' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = p_customer
      and c.tenant_id = p_tenant
      and c.platform = 'facebook'
      and c.platform_user_id = p_sender
  ) then
    raise exception 'AUCTION_WINNER_MISMATCH' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.orders o
    join public.auctions a on a.order_id = o.id
    where o.customer_tab_id = tab_row.id
      and o.tenant_id = p_tenant
      and o.customer_id = p_customer
      and o.source = 'live_auction'
      and o.status = 'pending_payment'
      and a.tenant_id = p_tenant
      and a.status = 'closed'
      and a.leading_bidder_id = p_sender
  ) then
    raise exception 'AUCTION_WINNER_MISMATCH' using errcode = '42501';
  end if;

  return public.complete_customer_tab_slip(
    p_slip, p_tenant, p_customer, 'valid', p_amount, p_ref, p_paid_at, p_raw, p_note
  );
end;
$$;

-- Serialize cancellation with payment-ledger updates by locking the tab before
-- the order. The existing order triggers then update the tab total and restore
-- any stock that this order had reserved, in the same transaction.
create or replace function public.cancel_customer_tab_order(
  p_tenant uuid,
  p_customer uuid,
  p_tab uuid,
  p_order uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  tab_row public.customer_tabs;
  order_row public.orders;
begin
  select * into tab_row
  from public.customer_tabs
  where id = p_tab and tenant_id = p_tenant and customer_id = p_customer
  for update;
  if not found then raise exception 'TAB_ORDER_SCOPE' using errcode = '42501'; end if;

  select * into order_row
  from public.orders
  where id = p_order
    and customer_tab_id = p_tab
    and tenant_id = p_tenant
    and customer_id = p_customer
  for update;
  if not found then raise exception 'TAB_ORDER_SCOPE' using errcode = '42501'; end if;
  if order_row.status = 'cancelled' then
    return jsonb_build_object('cancelled', true, 'duplicate', true);
  end if;
  if order_row.status <> 'pending_payment' or coalesce(order_row.paid_amount, 0) > 0 then
    raise exception 'TAB_ORDER_NOT_CANCELLABLE' using errcode = '23514';
  end if;

  update public.orders set status = 'cancelled' where id = order_row.id;
  return jsonb_build_object(
    'cancelled', true,
    'duplicate', false,
    'stockRestored', order_row.product_id is not null and coalesce(order_row.live_stock_deducted, true)
  );
end;
$$;

revoke all on function public.cancel_customer_tab_order(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_customer_tab_order(uuid, uuid, uuid, uuid)
  to service_role;

commit;
