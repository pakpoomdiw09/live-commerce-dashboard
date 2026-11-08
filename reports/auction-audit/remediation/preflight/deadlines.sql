CREATE OR REPLACE FUNCTION public.process_live_auction_comment(p_auction uuid, p_tenant uuid, p_event uuid, p_kind text, p_amount numeric DEFAULT NULL::numeric, p_control text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a public.auctions;e public.facebook_webhook_events;
begin
 select * into a from public.auctions where id=p_auction and tenant_id=p_tenant for update;
 if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0002';end if;
 select * into e from public.facebook_webhook_events where id=p_event and page_id=a.page_id;
 if not found then raise exception 'AUCTION_EVENT_INVALID' using errcode='42501';end if;
 if a.ends_at is not null and e.created_at>=a.ends_at then
  perform public.close_due_live_auction(a.id,a.tenant_id);
  return jsonb_build_object('status','closed','reason','AUCTION_DEADLINE_PASSED');
 end if;
 return public.process_live_auction_comment_without_deadline(p_auction,p_tenant,p_event,p_kind,p_amount,p_control);
end $function$
