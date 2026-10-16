-- Idempotent Realtime publication setup. Run after schema.sql/security.sql.
-- Read authorization remains in security.sql: messages -> customers -> tenant membership.
begin;
do $$
declare name text;
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  raise exception 'Enable Supabase Realtime before applying this migration';
 end if;
 foreach name in array array['customers','messages','comments','slips'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=name) then
   execute format('alter publication supabase_realtime add table public.%I',name);
  end if;
 end loop;
end $$;
-- DELETE reconciliation only needs primary-key IDs; no FULL replica of private message bodies.
commit;
