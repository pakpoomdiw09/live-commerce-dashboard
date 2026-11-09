// Reproduce the forward RPC definition from audit 2 without editing migration history.
const fs = require('node:fs')
const source = fs.readFileSync('supabase/live-auction-audit-hardening-2.sql', 'utf8')
let sql = source.slice(source.indexOf('create or replace function public.process_live_auction_comment('), source.indexOf("notify pgrst,'reload schema';"))
sql = sql.replace('close_event public.facebook_webhook_events;', 'close_event public.facebook_webhook_events;command jsonb;')
sql = sql.replace('select result into prior from public.auction_bids where auction_id=a.id and comment_id=cid;', `select b.result into prior from public.auction_bids b join public.auctions old on old.id=b.auction_id
  where old.tenant_id=a.tenant_id and old.page_id=a.page_id and old.live_post_id=a.live_post_id
   and (b.event_id=e.id or b.comment_id=cid) limit 1;`)
const start = sql.indexOf(' if host then\n'), end = sql.indexOf(' if confirming then', start)
if (start < 0 || end < 0) throw Error('Host parsing block missing')
sql = sql.slice(0, start) + ` if host then
  p_kind:='IGNORE';p_control:=null;
  command:=public.auction_host_command(v->>'message',settings);
  if command->>'action'='close' then p_kind:='HOST_CONTROL';p_control:='close';
  elsif command->>'action'='count' then p_kind:='HOST_CONTROL';p_control:=command->>'count';counting:=true;
  end if;
 end if;
` + sql.slice(end)
sql = sql.replace(' if confirming then', ` if confirming and a.status='active' and coalesce((settings->>'autoCycleRounds')::boolean,false) then
  r:=jsonb_build_object('status','awaiting_host_close','auctionId',a.id);
  insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
   values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,'awaiting_host_close',r);
  return r;
 end if;
 if confirming then`)
sql = sql.replace('  r:=public.finalize_live_auction(a.id,a.tenant_id,e.id);', `  r:=public.finalize_live_auction(a.id,a.tenant_id,e.id);
  r:=r||jsonb_build_object('nextAuctionId',public.advance_live_auction(a.id,a.tenant_id,e.id));`)
sql = sql.replace(" insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result) values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,r->>'status',r);", ` r:=r||jsonb_build_object('auctionId',a.id);
 insert into public.auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result) values(a.id,e.id,cid,sender,left(v->'from'->>'name',200),left(coalesce(v->>'message',''),2000),null,false,r->>'status',r);`)
const file = 'supabase/live-auction-auto-cycle.sql'
const existing = fs.readFileSync(file, 'utf8')
const marker = '-- Public comment RPC with dynamic host commands and atomic cycling.'
const base = existing.includes(marker) ? existing.slice(0, existing.indexOf(marker)) : existing
fs.writeFileSync(file, base + '\n' + marker + '\n' + sql + `
revoke all on function public.auction_host_command(text,jsonb),public.advance_live_auction(uuid,uuid,uuid),
 public.save_auction_workspace(uuid,uuid,uuid,jsonb),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.auction_host_command(text,jsonb),public.advance_live_auction(uuid,uuid,uuid),
 public.save_auction_workspace(uuid,uuid,uuid,jsonb),public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text) to service_role;
notify pgrst,'reload schema';
commit;
`)
