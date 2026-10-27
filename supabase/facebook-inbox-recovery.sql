-- Facebook Inbox recovery after moving to a new Supabase project.
-- Run after the base schema, security.sql, smart-inbox.sql and
-- facebook-webhook-queue.sql. Safe to run repeatedly.
--
-- This migration deliberately does not auto-create tenants. A tenant is an
-- authorization boundary and must be linked to the correct Facebook Page.
-- The webhook resolves tenant_id from tenants.page_id before persistence.

begin;

do $$
declare missing text;
begin
  foreach missing in array array[
    'public.tenants',
    'public.customers',
    'public.messages',
    'public.facebook_webhook_events',
    'public.facebook_webhook_steps'
  ] loop
    if to_regclass(missing) is null then
      raise exception 'Missing prerequisite relation: %', missing;
    end if;
  end loop;
  if to_regprocedure('public.persist_facebook_webhook_record(uuid,uuid,uuid)') is null then
    raise exception 'Missing prerequisite function: persist_facebook_webhook_record';
  end if;
end $$;

-- A BEFORE trigger covers every customer creation path, including the webhook
-- RPC's INSERT ... ON CONFLICT DO UPDATE. It only fills a blank Facebook name;
-- a real Graph/admin name is always preserved.
create or replace function public.ensure_facebook_customer_fallback_name()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
begin
  if new.platform='facebook'
     and nullif(btrim(coalesce(new.display_name,'')),'') is null
     and nullif(btrim(coalesce(new.platform_user_id,'')),'') is not null then
    new.display_name := 'ลูกค้า Facebook (' || right(new.platform_user_id,4) || ')';
  end if;
  return new;
end $$;

drop trigger if exists customers_facebook_fallback_name on public.customers;
create trigger customers_facebook_fallback_name
before insert or update on public.customers
for each row execute function public.ensure_facebook_customer_fallback_name();

-- Repair rows imported before the trigger existed.
update public.customers
set display_name='ลูกค้า Facebook (' || right(platform_user_id,4) || ')'
where platform='facebook'
  and nullif(btrim(coalesce(display_name,'')),'') is null
  and nullif(btrim(coalesce(platform_user_id,'')),'') is not null;

-- These indexes match the Inbox list/thread access paths and are additive.
create index if not exists customers_tenant_last_message_idx
  on public.customers(tenant_id,last_message_at desc,id desc);
create index if not exists messages_customer_created_idx
  on public.messages(customer_id,created_at desc,id desc);

-- Webhook RPCs are server-only. Service role bypasses RLS but still needs the
-- explicit function/table grants after a project migration.
grant select,insert,update on public.customers to service_role;
grant select,insert,update on public.messages to service_role;
grant execute on function public.persist_facebook_webhook_record(uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;

-- Verification (read-only; run separately if desired):
-- select id,page_id,is_active from public.tenants order by created_at,id;
-- select tenant_id,count(*) customers,count(*) filter(where display_name is null or btrim(display_name)='') blank_names
-- from public.customers group by tenant_id;
-- select status,last_error,count(*) from public.facebook_webhook_events group by status,last_error;
