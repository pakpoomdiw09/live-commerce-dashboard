-- Run after automation.sql. Keeps legacy text and migrates it into an array once.
begin;
alter table public.bot_settings add column if not exists handover_messages text[] not null default '{}';
create or replace function public.valid_handover_messages(messages text[]) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select coalesce(cardinality(messages) <= 20 and not exists (
    select 1 from unnest(messages) message where message is null or length(message) > 2000
  ), false)
$$;
alter table public.bot_settings drop constraint if exists bot_settings_handover_messages_check;
alter table public.bot_settings add constraint bot_settings_handover_messages_check
  check (public.valid_handover_messages(handover_messages));
-- The AI gate may reject unrelated updates for lapsed plans. Disable only that gate
-- within this transaction while preserving each tenant's existing reply mode.
do $$ declare gate_enabled boolean; begin
  select exists(select 1 from pg_trigger where tgrelid = 'public.bot_settings'::regclass
    and tgname = 'bot_settings_ai_plan_gate' and tgenabled = 'O') into gate_enabled;
  if gate_enabled then alter table public.bot_settings disable trigger bot_settings_ai_plan_gate; end if;
  update public.bot_settings set handover_messages = array[trim(handover_text)]
  where cardinality(handover_messages) = 0 and nullif(trim(handover_text), '') is not null;
  if gate_enabled then alter table public.bot_settings enable trigger bot_settings_ai_plan_gate; end if;
end $$;
commit;
