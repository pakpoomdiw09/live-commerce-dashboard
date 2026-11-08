const fs = require('node:fs')
const source = fs.readFileSync('scripts/test-auction-audit-lifecycle.cjs', 'utf8')
fs.writeFileSync('scripts/helpers/auction-hardening-db.cjs', source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = { fixture }\n')
if (process.argv.includes('--helper-only')) process.exit(0)
const audit = fs.readFileSync('supabase/live-auction-audit-hardening.sql', 'utf8')
const start = audit.indexOf('create or replace function public.process_live_auction_comment(')
let definition = audit.slice(start, audit.indexOf('end $$;', start) + 7)
definition = definition.replace('source_at timestamptz;', 'source_at timestamptz;confirmation_floor timestamptz;close_event public.facebook_webhook_events;')
definition = definition.replace(" if confirming then\n  source_at:=", ` if confirming then
  confirmation_floor:=a.winner_locked_at;
  if a.close_event_id is not null then
   select * into close_event from public.facebook_webhook_events where id=a.close_event_id and page_id=a.page_id and kind='change';
   if found and close_event.payload->'value'->>'verb'='add'
    and (close_event.payload->'value'->'from'->>'id'=a.page_id or close_event.payload->'value'->'from'->>'id'=any(a.host_ids)) then
    confirmation_floor:=coalesce(public.auction_comment_timestamp(close_event.payload->'value'->>'created_time'),confirmation_floor);
   end if;
  end if;
  source_at:=`)
definition = definition.replace('(a.winner_locked_at is not null and source_at<a.winner_locked_at)', '(confirmation_floor is not null and source_at<confirmation_floor)')
const telemetry = `-- Forward-only successor to live-auction-audit-hardening.sql. Never replay modified history.
begin;
create table if not exists public.auction_expiry_failures (
 sqlstate text not null check(sqlstate ~ '^[A-Z0-9]{5}$'),
 auction_id uuid not null references public.auctions(id) on delete cascade,
 occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists auction_expiry_failures_recent on public.auction_expiry_failures(occurred_at desc);
alter table public.auction_expiry_failures enable row level security;
revoke all on public.auction_expiry_failures from public,anon,authenticated;
grant select,insert on public.auction_expiry_failures to service_role;

-- Add a reporting RPC without changing the existing integer-returning RPC signature.
create or replace function public.expire_live_auctions_report(p_tenant uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare a record;result jsonb;closed integer:=0;failed integer:=0;
begin
 for a in select id,tenant_id from public.auctions where status='active' and ends_at<=clock_timestamp()
  and (p_tenant is null or tenant_id=p_tenant) order by ends_at limit 100 for update skip locked
 loop
  begin
   result:=public.close_due_live_auction(a.id,a.tenant_id);
   if result->>'status' in ('closed','awaiting_confirmation') then closed:=closed+1;end if;
  exception when others then
   insert into public.auction_expiry_failures(sqlstate,auction_id,occurred_at) values(sqlstate,a.id,clock_timestamp());
   failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('closed',closed,'failed',failed);
end $$;
create or replace function public.expire_live_auctions(p_tenant uuid default null)
returns integer language sql set search_path=pg_catalog,public as $$
 select (public.expire_live_auctions_report(p_tenant)->>'closed')::integer
$$;
revoke all on function public.expire_live_auctions_report(uuid),public.expire_live_auctions(uuid) from public,anon,authenticated;
grant execute on function public.expire_live_auctions_report(uuid),public.expire_live_auctions(uuid) to service_role;

`
fs.writeFileSync('supabase/live-auction-audit-hardening-2.sql', telemetry + definition + "\nnotify pgrst,'reload schema';\ncommit;\n")
