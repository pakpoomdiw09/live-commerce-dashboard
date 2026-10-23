-- Restore exactly the functions saved before full-access.sql. Also set
-- temporaryFullAccess=false in lib/full-access.ts and deploy that change.
begin;
do $$
declare saved record;
begin
  if to_regclass('public.full_access_function_backup') is null then
    raise exception 'Full Access backup not found';
  end if;
  for saved in select definition from public.full_access_function_backup order by signature loop
    execute saved.definition;
  end loop;
end $$;
-- Keep the backup for audit and repeatable rollback. No tenant or billing rows are changed.
commit;
