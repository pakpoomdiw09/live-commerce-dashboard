-- Apply after broadcast-policy.sql, before deploying recipient selection.
begin;
alter table public.broadcasts add column if not exists selected_customer_ids uuid[];
create or replace function public.guard_broadcast_selection() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.status<>'draft' and new.selected_customer_ids is distinct from old.selected_customer_ids then
  raise exception 'Started campaign recipients are immutable' using errcode='40001';
 end if;
 return new;
end $$;
drop trigger if exists broadcast_selection_immutable on public.broadcasts;
create trigger broadcast_selection_immutable before update on public.broadcasts
for each row execute function public.guard_broadcast_selection();
notify pgrst,'reload schema';
commit;
