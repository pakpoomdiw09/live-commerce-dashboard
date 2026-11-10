begin;

set local lock_timeout = '2s';
set local statement_timeout = '60s';

create or replace function public.review_auction_payment_proof(
  p_order uuid,
  p_tenant uuid,
  p_slip uuid,
  p_decision text,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  o public.orders;
  proof public.auction_payment_proofs;
  s public.slips;
  reviewed_at timestamptz;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'AUCTION_REVIEW_DECISION_INVALID' using errcode = '22023';
  end if;

  -- Match submit_auction_payment_proof: serialize all changes for an order first.
  select * into o
  from public.orders
  where id = p_order and source = 'live_auction'
  for update;

  if not found or o.tenant_id is distinct from p_tenant then
    raise exception 'AUCTION_PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into proof
  from public.auction_payment_proofs
  where order_id = o.id and tenant_id = o.tenant_id
  for update;

  if not found then
    raise exception 'AUCTION_PROOF_NOT_FOUND' using errcode = 'P0002';
  end if;
  if proof.slip_id is distinct from p_slip then
    raise exception 'AUCTION_PROOF_STALE' using errcode = '40001';
  end if;

  select * into s
  from public.slips
  where id = proof.slip_id
    and tenant_id = o.tenant_id
    and customer_id = o.customer_id
  for update;

  if not found then
    raise exception 'AUCTION_SLIP_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A repeat of the same completed decision is safe; an opposite decision is not.
  if s.approved_at is not null then
    if p_decision = 'approve' and o.status = 'paid' and o.slip_id = s.id then
      return jsonb_build_object(
        'decision', 'approve',
        'slipId', s.id,
        'status', o.status,
        'approvedAt', s.approved_at,
        'alreadyApplied', true
      );
    end if;
    raise exception 'AUCTION_REVIEW_CONFLICT' using errcode = '55000';
  end if;

  if s.status = 'rejected' then
    if p_decision = 'reject' and o.status = 'pending_payment' then
      return jsonb_build_object(
        'decision', 'reject',
        'slipId', s.id,
        'status', s.status,
        'submissionAttempts', proof.submission_attempts,
        'alreadyApplied', true
      );
    end if;
    raise exception 'AUCTION_REVIEW_CONFLICT' using errcode = '55000';
  end if;

  if o.status <> 'pending_payment'
    or (o.slip_id is not null and o.slip_id <> s.id)
    or s.status not in ('error', 'valid', 'fake', 'amount_mismatch', 'wrong_receiver') then
    raise exception 'AUCTION_REVIEW_CONFLICT' using errcode = '55000';
  end if;

  if p_decision = 'reject' then
    update public.slips
    set status = 'rejected'
    where id = s.id;

    return jsonb_build_object(
      'decision', 'reject',
      'slipId', s.id,
      'status', 'rejected',
      'submissionAttempts', proof.submission_attempts,
      'alreadyApplied', false
    );
  end if;

  reviewed_at := clock_timestamp();
  update public.slips
  set approved_at = reviewed_at,
      approved_by = coalesce(approved_by, p_actor)
  where id = s.id;

  update public.orders
  set status = 'paid',
      paid_at = reviewed_at,
      slip_id = s.id
  where id = o.id and status = 'pending_payment';

  return jsonb_build_object(
    'decision', 'approve',
    'slipId', s.id,
    'status', 'paid',
    'approvedAt', reviewed_at,
    'alreadyApplied', false
  );
end
$$;

revoke all on function public.review_auction_payment_proof(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.review_auction_payment_proof(uuid, uuid, uuid, text, uuid)
  to service_role;

-- Keep the legacy RPC signature and timestamp return for existing server callers.
-- Its lookup does not lock a row; all row locks are acquired by the atomic RPC above.
create or replace function public.approve_auction_payment_proof(
  p_slip uuid,
  p_tenant uuid,
  p_actor uuid
)
returns timestamptz
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_order uuid;
  review_result jsonb;
  approved timestamptz;
begin
  select order_id into target_order
  from public.auction_payment_proofs
  where slip_id = p_slip and tenant_id = p_tenant;

  if not found then
    raise exception 'AUCTION_PROOF_NOT_FOUND' using errcode = 'P0002';
  end if;

  review_result := public.review_auction_payment_proof(
    target_order,
    p_tenant,
    p_slip,
    'approve',
    p_actor
  );
  approved := nullif(review_result ->> 'approvedAt', '')::timestamptz;
  if approved is null then
    raise exception 'AUCTION_REVIEW_CONFLICT' using errcode = '55000';
  end if;
  return approved;
end
$$;

revoke all on function public.approve_auction_payment_proof(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.approve_auction_payment_proof(uuid, uuid, uuid)
  to service_role;

commit;
