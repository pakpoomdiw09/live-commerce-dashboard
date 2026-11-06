-- Add Bee Move to the provider set already accepted by the BYOK UI and API.
begin;

alter table public.shipping_integrations
 drop constraint if exists shipping_integrations_provider_check;
alter table public.shipping_integrations
 add constraint shipping_integrations_provider_check
 check(provider in ('beemove','dmove','flash_express','jnt','thailand_post'));

alter table public.shipping_provider_jobs
 drop constraint if exists shipping_provider_jobs_provider_check;
alter table public.shipping_provider_jobs
 add constraint shipping_provider_jobs_provider_check
 check(provider in ('beemove','dmove','flash_express','jnt','thailand_post'));

create or replace function public.save_shipping_integration(
 p_tenant uuid,p_provider text,p_endpoint text,p_credentials text,p_sender jsonb,
 p_tracking_template text,p_weight numeric,p_active boolean,p_default boolean
) returns void language plpgsql set search_path=pg_catalog,public as $$
begin
 if p_provider is null or p_provider not in ('beemove','dmove','flash_express','jnt','thailand_post')
  or p_endpoint !~ '^https://[^[:space:]]+$'
  or length(p_endpoint)>500
  or jsonb_typeof(p_sender) is distinct from 'object'
  or length(trim(coalesce(p_sender->>'name',''))) not between 2 and 200
  or coalesce(p_sender->>'phone','') !~ '^0[1-9][0-9]{7,8}$'
  or length(trim(coalesce(p_sender->>'address',''))) not between 10 and 1200
  or p_tracking_template !~ '^https://[^[:space:]]*\{tracking_number\}[^[:space:]]*$'
  or length(p_tracking_template)>1000
  or p_weight is null or p_weight<=0 or p_weight>100
  or p_default and not p_active then
  raise exception 'SHIPPING_INTEGRATION_INVALID';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'SHIPPING_TENANT_NOT_FOUND' using errcode='P0002';end if;
 if p_default then
  update public.shipping_integrations set is_default=false,updated_at=clock_timestamp()
   where tenant_id=p_tenant and is_default and provider<>p_provider;
 end if;
 insert into public.shipping_integrations(
  tenant_id,provider,api_endpoint,credentials_ciphertext,sender_info,tracking_url_template,weight_kg,is_active,is_default
 ) values(p_tenant,p_provider,p_endpoint,p_credentials,p_sender,p_tracking_template,p_weight,p_active,p_default)
 on conflict(tenant_id,provider) do update set api_endpoint=excluded.api_endpoint,
  credentials_ciphertext=excluded.credentials_ciphertext,sender_info=excluded.sender_info,
  tracking_url_template=excluded.tracking_url_template,weight_kg=excluded.weight_kg,is_active=excluded.is_active,
  is_default=excluded.is_default,updated_at=clock_timestamp();
 if not p_active then
  update public.shipping_integrations set is_default=false,updated_at=clock_timestamp()
   where tenant_id=p_tenant and provider=p_provider;
 end if;
end $$;

create or replace function public.begin_shipping_provider_job(
 p_tenant uuid,p_actor uuid,p_request uuid,p_shipment uuid,p_provider text
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.shipping_shipments;j public.shipping_provider_jobs;
begin
 if p_tenant is null or p_actor is null or p_request is null or p_shipment is null
  or p_provider is null or p_provider not in ('beemove','dmove','flash_express','jnt','thailand_post') then
  raise exception 'SHIPPING_PROVIDER_INPUT_INVALID';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'SHIPPING_TENANT_NOT_FOUND' using errcode='P0002';end if;
 select * into s from public.shipping_shipments where id=p_shipment and tenant_id=p_tenant for update;
 if not found then raise exception 'SHIPPING_SCOPE' using errcode='42501';end if;
 select * into j from public.shipping_provider_jobs
  where tenant_id=p_tenant and request_id=p_request and shipment_id=p_shipment for update;
 if found then
  return jsonb_build_object('jobId',j.id,'status',j.status,'idempotencyKey',j.idempotency_key,
   'trackingNumber',j.tracking_number,'trackingUrl',j.tracking_url,'labelPdfUrl',j.label_pdf_url,
   'courierName',j.courier_name,'notificationStatus',j.notification_status,'claimed',false);
 end if;
 select * into j from public.shipping_provider_jobs
  where tenant_id=p_tenant and shipment_id=p_shipment and status in ('creating','created','uncertain')
  order by created_at desc limit 1 for update;
 if found then
  return jsonb_build_object('jobId',j.id,'status',j.status,'idempotencyKey',j.idempotency_key,
   'trackingNumber',j.tracking_number,'trackingUrl',j.tracking_url,'labelPdfUrl',j.label_pdf_url,
   'courierName',j.courier_name,'notificationStatus',j.notification_status,'claimed',false);
 end if;
 if s.fulfillment_status<>'ready_to_ship' or not public.shipping_payment_ready(s.id)
  or s.address_confirmed_at is null or not public.shipping_address_valid(to_jsonb(s)) then
  raise exception 'SHIPPING_NOT_READY';
 end if;
 if not exists(select 1 from public.shipping_integrations i where i.tenant_id=p_tenant
  and i.provider=p_provider and i.is_active) then
  raise exception 'SHIPPING_PROVIDER_NOT_ACTIVE';
 end if;
 insert into public.shipping_provider_jobs(tenant_id,shipment_id,actor_id,request_id,provider)
  values(p_tenant,p_shipment,p_actor,p_request,p_provider) returning * into j;
 return jsonb_build_object('jobId',j.id,'status',j.status,'idempotencyKey',j.idempotency_key,'claimed',true);
end $$;

alter table public.shipping_integrations enable row level security;
alter table public.shipping_provider_jobs enable row level security;
revoke all on public.shipping_integrations,public.shipping_provider_jobs from public,anon,authenticated;
grant all on public.shipping_integrations,public.shipping_provider_jobs to service_role;
revoke all on function public.save_shipping_integration(uuid,text,text,text,jsonb,text,numeric,boolean,boolean),
 public.begin_shipping_provider_job(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_shipping_integration(uuid,text,text,text,jsonb,text,numeric,boolean,boolean),
 public.begin_shipping_provider_job(uuid,uuid,uuid,uuid,text) to service_role;

commit;
