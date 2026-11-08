-- Run once in the Supabase SQL editor after live-auction-deadlines.sql.
-- Supabase Cron closes auctions even when no dashboard is open.
create extension if not exists pg_cron;
select cron.schedule('snapbot-auction-expiry','5 seconds',
 'select public.expire_live_auctions();');
