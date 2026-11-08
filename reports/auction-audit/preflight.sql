-- READ ONLY. Run as an authorized operator; never apply migrations from this script.
-- Rows are capability gates, not migration instructions or proof of business behavior.
-- 00: before deadlines; 10: before audit 1; 20: before audit 2; 30: application readiness.
-- A missing relation/function/role produces BLOCKED rather than a regclass exception.
begin transaction read only;

with
tables(stage,name) as (values
 ('00_base','tenants'),('00_base','auctions'),('00_base','auction_bids'),
 ('00_base','auction_deliveries'),('00_base','facebook_webhook_events'),
 ('00_base','live_sessions'),('00_base','auction_workspace_requests'),
 ('00_base','customers'),('00_base','orders'),('00_base','bank_accounts'),
 ('00_base','snapbot_schema_migrations'),
 ('20_before_audit_2','auction_poll_cursors'),('30_application','auction_expiry_failures')
),
column_groups(stage,table_name,names) as (values
 ('00_base','auctions',array['id','tenant_id','page_id','live_post_id','live_post_aliases',
  'item_name','start_price','min_step','shipping_fee','bank_account_id',
  'status','created_at','closed_at','close_event_id','order_id','leading_bidder_id',
  'leading_bidder_name','leading_comment_id','current_price','host_ids','host_count',
  'winner_locked_at','winner_confirmed_at','winner_confirmation_comment_id',
  'winner_confirmation_event_id','session_automation','private_reply_template',
  'bid_reply_template','private_reply_enabled','public_reply_enabled']),
 ('00_base','tenants',array['id','page_id','is_active']),
 ('00_base','live_sessions',array['id','tenant_id','page_id','live_post_id','auction_settings']),
 ('00_base','customers',array['id','tenant_id','platform','platform_user_id','display_name']),
 ('00_base','orders',array['id','tenant_id','customer_id','product_name','amount','status',
  'source','source_id','live_bank_account_id']),
 ('00_base','bank_accounts',array['id','tenant_id']),
 ('00_base','auction_bids',array['auction_id','event_id','comment_id','bidder_id',
  'bidder_name','comment_text','bid_amount','is_opening','status','result']),
 ('00_base','auction_deliveries',array['auction_id','channel','comment_id','claim_id','status']),
 ('00_base','facebook_webhook_events',array['id','page_id','kind','payload','created_at',
  'ordering_key','sequence','status']),
 ('00_base','auction_workspace_requests',array['tenant_id','request_id']),
 ('00_base','snapbot_schema_migrations',array['name','checksum','source_sha256']),
 ('10_before_audit_1','auctions',array['ends_at','timer_started_at','duration_seconds']),
 ('20_before_audit_2','auction_poll_cursors',array['cursor_id','auction_id','tenant_id',
  'session_id','live_video_id','high_water_at','continuation_url',
  'continuation_anchor_url','continuation_boundary_at','updated_at']),
 ('30_application','auction_expiry_failures',array['sqlstate','auction_id','occurred_at'])
),
-- Reviewed source-body digests from local PGlite, not from the active database.
-- CRLF is normalized. A formatting-only body change also BLOCKS: investigate, do not bypass.
function_bodies(signature,body_md5) as (values
 ('public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)','091b062e3b8d978ae94311e5b6a1ac67'),
 ('public.finalize_live_auction(uuid,uuid,uuid,boolean)','6560e4c09610a3ed2c9d52623b9f48e5'),
 ('public.finalize_live_auction_highest_bid(uuid,uuid,uuid,boolean)','928d06341b80641be8511f9e67d583c1'),
 ('public.close_due_live_auction(uuid,uuid,boolean,boolean)','155def5bb234558e7eeea0df0602fe26')
),
functions(stage,signature,return_type) as (values
 ('00_base','public.process_live_auction_comment(uuid,uuid,uuid,text,numeric,text)','jsonb'),
 ('00_base','public.finalize_live_auction(uuid,uuid,uuid,boolean)','jsonb'),
 ('00_base','public.finalize_live_auction_highest_bid(uuid,uuid,uuid,boolean)','jsonb'),
 ('00_base','public.process_live_auction_highest_bid(uuid,uuid,uuid,text,numeric,text)','jsonb'),
 ('00_base','public.save_auction_workspace(uuid,uuid,uuid,jsonb)','jsonb'),
 ('00_base','public.normalize_auction_tag(text)','text'),
 ('00_base','public.auction_numeric_price(text)','numeric'),
 ('00_base','public.auction_comment_tags(jsonb,text,text)','text[]'),
 ('00_base','public.facebook_comment_context(uuid,text,text[])','jsonb'),
 ('00_base','public.resolve_facebook_comment_settings(jsonb,jsonb)','jsonb'),
 ('10_before_audit_1','public.close_due_live_auction(uuid,uuid,boolean,boolean)','jsonb'),
 ('10_before_audit_1','public.expire_live_auctions(uuid)','integer'),
 ('10_before_audit_1','public.start_legacy_auction_timer(uuid,uuid)','void'),
 ('20_before_audit_2','public.auction_comment_timestamp(text)','timestamp with time zone'),
 ('30_application','public.expire_live_auctions_report(uuid)','jsonb')
),
checks(stage,kind,requirement,passed,detail) as (
 select stage,'table','public.'||name,to_regclass('public.'||name) is not null,
  'Required relation' from tables
 union all
 select g.stage,'column','public.'||g.table_name||'.'||n.name,
  exists(select 1 from pg_catalog.pg_attribute a
   where a.attrelid=to_regclass('public.'||g.table_name) and a.attname=n.name
    and a.attnum>0 and not a.attisdropped), 'Required column'
 from column_groups g cross join lateral unnest(g.names) n(name)
 union all
 select f.stage,'function',f.signature,
  p.oid is not null and pg_catalog.format_type(p.prorettype,null)=f.return_type,
  'Expected return type: '||f.return_type
 from functions f left join pg_catalog.pg_proc p on p.oid=to_regprocedure(f.signature)
 union all
 select '30_application','function_body',f.signature,
  coalesce(md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))=f.body_md5,false),
  'Must equal reviewed source body; investigate any drift in staging'
 from function_bodies f left join pg_catalog.pg_proc p on p.oid=to_regprocedure(f.signature)
 union all
 select '20_before_audit_2','volatility','public.auction_comment_timestamp(text)',
  coalesce(p.provolatile='s',false),'Expected STABLE, not IMMUTABLE'
 from (values(1)) anchor(n) left join pg_catalog.pg_proc p
  on p.oid=to_regprocedure('public.auction_comment_timestamp(text)')
 union all
 select '30_application','column_type','public.auctions.'||v.name,
  exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=to_regclass('public.auctions')
   and a.attname=v.name and not a.attisdropped and pg_catalog.format_type(a.atttypid,a.atttypmod)=v.type),
  'Expected type: '||v.type
 from (values('ends_at','timestamp with time zone'),('timer_started_at','timestamp with time zone'),
  ('duration_seconds','integer')) v(name,type)
 union all
 select '30_application','rls','public.'||v.name,coalesce(c.relrowsecurity,false),
  'RLS must be enabled; browser roles must have no direct table access'
 from (values('auction_poll_cursors'),('auction_expiry_failures')) v(name)
 left join pg_catalog.pg_class c on c.oid=to_regclass('public.'||v.name)
 union all
 select '30_application','browser_access','public.'||t.name||' / '||r.name,
  c.oid is not null and role.oid is not null
   and not coalesce(has_table_privilege(role.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE'),true)
   and not coalesce(has_any_column_privilege(role.oid,c.oid,'SELECT,INSERT,UPDATE'),true),
  'Expected no browser table/column privileges'
 from (values('auction_poll_cursors'),('auction_expiry_failures')) t(name)
 cross join (values('anon'),('authenticated')) r(name)
 left join pg_catalog.pg_class c on c.oid=to_regclass('public.'||t.name)
 left join pg_catalog.pg_roles role on role.rolname=r.name
 union all
 select '30_application','rpc_access','expire_live_auctions_report / service_role',
  p.oid is not null and r.oid is not null and coalesce(has_function_privilege(r.oid,p.oid,'EXECUTE'),false),
  'Server role must execute the reporting RPC'
 from (values(1)) anchor(n)
 left join pg_catalog.pg_proc p on p.oid=to_regprocedure('public.expire_live_auctions_report(uuid)')
 left join pg_catalog.pg_roles r on r.rolname='service_role'
 union all
 select '00_base','read_only','transaction_read_only',
  current_setting('transaction_read_only')='on','This script must not mutate database state'
)
select stage,kind,requirement,case when passed then 'PASS' else 'BLOCKED' end status,detail
from checks order by stage,kind,requirement;

-- Optional operational diagnostics such as job history require a separate authorized read.
-- No tenant, bidder, comment, order, token, message body, or function body is returned here.
commit;
