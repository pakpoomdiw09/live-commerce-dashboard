begin;

create or replace function public.enforce_order_owner_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from 'cancelled' and new.status = 'cancelled'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and current_user <> 'service_role'
     and not exists (
       select 1 from public.tenant_members tm
       where tm.tenant_id = old.tenant_id
         and tm.user_id = auth.uid()
         and tm.role = 'owner'
     ) then
    raise exception 'ORDER_CANCELLATION_OWNER_ONLY' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_order_owner_cancellation() from public, anon, authenticated;
drop trigger if exists orders_owner_only_cancel on public.orders;
create trigger orders_owner_only_cancel
before update of status on public.orders
for each row execute function public.enforce_order_owner_cancellation();

commit;
