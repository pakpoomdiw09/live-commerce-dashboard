-- Apply after live-auction-on-demand.sql.
begin;
alter table public.auction_deliveries
 add column if not exists private_plan jsonb,
 add column if not exists latest_sent_at timestamptz,
 add column if not exists latest_recipient_id text,
 add column if not exists next_attempt_at timestamptz not null default '-infinity';

-- Keep the prior normalizer available on reruns without recursively wrapping it.
do $$ begin
 if to_regprocedure('public.normalize_auction_settings_before_split(jsonb)') is null then
  alter function public.normalize_auction_thai_settings(jsonb) rename to normalize_auction_settings_before_split;
 end if;
end $$;
create or replace function public.normalize_auction_thai_settings(settings jsonb) returns jsonb
language sql immutable returns null on null input set search_path=pg_catalog,public as $$
 select case when settings ? 'auto_accumulate_summary' and jsonb_typeof(settings->'auto_accumulate_summary')<>'boolean'
  then null else public.normalize_auction_settings_before_split(settings)||jsonb_build_object(
   'auto_accumulate_summary',coalesce(settings->'auto_accumulate_summary','true'::jsonb)) end
$$;
update public.live_sessions set auction_settings=auction_settings||jsonb_build_object('auto_accumulate_summary',true)
 where auction_settings is not null and not (auction_settings ? 'auto_accumulate_summary');
update public.auctions set session_automation=session_automation||jsonb_build_object('auto_accumulate_summary',true)
 where session_automation is not null and not (session_automation ? 'auto_accumulate_summary');
commit;
