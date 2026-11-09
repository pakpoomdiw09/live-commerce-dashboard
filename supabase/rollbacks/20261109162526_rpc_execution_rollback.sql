-- EMERGENCY ROLLBACK ONLY. Applying this restores broad PUBLIC execution
-- access on every public-schema function, including functions normally kept
-- isolated. Keep this file outside supabase/migrations so the CLI never applies
-- it automatically.
begin;

grant execute on all functions in schema public to public;

-- Restore PostgreSQL's standard default EXECUTE grant for functions created by
-- the migration owner and in the public schema.
alter default privileges for role postgres
  grant execute on functions to public;
alter default privileges for role postgres in schema public
  grant execute on routines to public;

commit;
