begin;

set local lock_timeout = '2s';
set local statement_timeout = '60s';

alter table public.slips
  drop constraint if exists slips_status_check;
alter table public.slips
  add constraint slips_status_check
  check (status in ('pending', 'valid', 'amount_mismatch', 'duplicate', 'fake', 'wrong_receiver', 'error', 'rejected'));

alter table public.auction_payment_proofs
  add column if not exists submission_attempts smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.auction_payment_proofs'::regclass
      and conname = 'auction_payment_proofs_submission_attempts_check'
  ) then
    alter table public.auction_payment_proofs
      add constraint auction_payment_proofs_submission_attempts_check
      check (submission_attempts between 1 and 5);
  end if;
end
$$;

create or replace function public.submit_auction_payment_proof(p_order uuid, p_image text)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  o public.orders;
  sid uuid;
  prior_status text;
  prior_approved_at timestamptz;
  attempts smallint;
  had_existing boolean;
begin
  select * into o
  from public.orders
  where id = p_order and source = 'live_auction'
  for update;

  if not found or o.status <> 'pending_payment' then
    raise exception 'AUCTION_PAYMENT_LOCKED' using errcode = 'P0002';
  end if;

  if p_image is null or p_image !~ (
    '^auction/' || o.tenant_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'AUCTION_IMAGE_PATH_INVALID' using errcode = '22023';
  end if;

  select slip.status, slip.approved_at, proof.submission_attempts
    into prior_status, prior_approved_at, attempts
  from public.auction_payment_proofs as proof
  join public.slips as slip on slip.id = proof.slip_id and slip.tenant_id = o.tenant_id
  where proof.order_id = o.id and proof.tenant_id = o.tenant_id
  for update of proof, slip;
  had_existing := found;

  if had_existing then
    if prior_status <> 'rejected' or prior_approved_at is not null then
      raise exception 'AUCTION_PROOF_EXISTS' using errcode = '23505';
    end if;
    if attempts >= 5 then
      raise exception 'AUCTION_PROOF_ATTEMPTS_EXHAUSTED' using errcode = '54000';
    end if;
  end if;

  insert into public.slips(tenant_id, customer_id, image_path, expected_amount, status, note)
  values (
    o.tenant_id,
    o.customer_id,
    p_image,
    o.amount,
    'error',
    'หลักฐานชำระประมูล: รอเจ้าของร้านตรวจสอบและอนุมัติด้วยตนเอง'
  )
  returning id into sid;

  if had_existing then
    update public.auction_payment_proofs
      set slip_id = sid, submission_attempts = attempts + 1
      where order_id = o.id and tenant_id = o.tenant_id;
  else
    insert into public.auction_payment_proofs(order_id, tenant_id, slip_id, submission_attempts)
      values (o.id, o.tenant_id, sid, 1);
  end if;

  return sid;
end
$$;

commit;
