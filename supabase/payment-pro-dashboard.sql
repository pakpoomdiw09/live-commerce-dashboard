-- Run after payment-pro.sql. Optional date-range reporting, service-only, no mutations.
begin;
create or replace function public.payment_pro_dashboard_report(p_tenant uuid,p_from timestamptz,p_to timestamptz,p_query text default '') returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 with scoped as(select * from public.payment_pro_attempts where tenant_id=p_tenant and created_at>=p_from and created_at<p_to),
 matched as(select * from scoped where coalesce(p_query,'')='' or strpos(lower(coalesce(reason,'')),lower(p_query))>0),
 daily as(select (created_at at time zone 'Asia/Bangkok')::date bucket,count(*) total,count(*) filter(where status='VERIFIED') verified,coalesce(sum(expected_satang) filter(where status='VERIFIED'),0) satang from scoped group by 1),
 days as(select generate_series((p_from at time zone 'Asia/Bangkok')::date,(p_to at time zone 'Asia/Bangkok')::date,interval '1 day')::date bucket)
 select jsonb_build_object('attempts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select id,slip_id,customer_id,status,reason,expected_satang,eligible,credit_charged,credit_refunded,provider_started_at,created_at,updated_at from matched order by created_at desc,id limit 500)r),
 'stats',(select jsonb_build_object('total',count(*),'verified',count(*) filter(where status='VERIFIED'),'review',count(*) filter(where status in ('PENDING','VERIFYING','REVIEW_REQUIRED')),'rejected',count(*) filter(where status='REJECTED'),'cancelled',count(*) filter(where status='CANCELLED'),'duplicates',count(*) filter(where reason='DUPLICATE_TRANSACTION'),'amountMismatch',count(*) filter(where reason='AMOUNT_MISMATCH'),'receiverMismatch',count(*) filter(where reason in ('RECEIVER_NOT_CONFIRMED','RECEIVER_CHANGED')),'charged',count(*) filter(where credit_charged),'refunded',count(*) filter(where credit_refunded),'verifiedSatang',coalesce(sum(expected_satang) filter(where status='VERIFIED'),0)) from scoped),
 'series',(select jsonb_agg(jsonb_build_object('day',d.bucket,'amount',coalesce(r.satang,0)/100.0,'count',coalesce(r.total,0)) order by d.bucket) from days d left join daily r using(bucket)))
$$;
revoke all on function public.payment_pro_dashboard_report(uuid,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.payment_pro_dashboard_report(uuid,timestamptz,timestamptz,text) to service_role;
notify pgrst,'reload schema';
commit;
