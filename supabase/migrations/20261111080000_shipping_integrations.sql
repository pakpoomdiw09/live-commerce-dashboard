-- Forward-only shipping BYOK integration schema. Requires shipping-fulfillment.sql.
begin;

create table if not exists public.shipping_integrations (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 provider text not null check(provider in ('beemove','dmove','flash_express','jnt','thailand_post')),
 api_endpoint text not null,
 credentials_ciphertext text not null,
 weight_kg numeric(8,3) not null default 1.000 check(weight_kg>0 and weight_kg<=100),
 sender_info jsonb not null,
 tracking_url_template text not null,
 is_active boolean not null default false,
 is_default boolean not null default false,
 last_tested_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,provider)
);
alter table public.shipping_integrations drop constraint if exists shipping_integrations_provider_check;
alter table public.shipping_integrations add constraint shipping_integrations_provider_check check(provider in ('beemove','dmove','flash_express','jnt','thailand_post'));
create unique index if not exists shipping_one_default_integration
 on public.shipping_integrations(tenant_id) where is_default and is_active;

alter table public.shipping_shipments
 add column if not exists tracking_url text,
 add column if not exists label_pdf_url text;
alter table public.orders
 add column if not exists tracking_url text,
 add column if not exists label_pdf_url text;
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

create table if not exists public.shipping_provider_jobs (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 shipment_id uuid not null references public.shipping_shipments(id),
 actor_id uuid not null references auth.users(id),
 request_id uuid not null,
 provider text not null check(provider in ('beemove','dmove','flash_express','jnt','thailand_post')),
 idempotency_key uuid not null default gen_random_uuid(),
 status text not null default 'creating' check(status in ('creating','created','failed','uncertain')),
 notification_status text not null default 'pending' check(notification_status in ('pending','sent','failed')),
 tracking_number text,
 courier_name text,
 tracking_url text,
 label_pdf_url text,
 error_code text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id,shipment_id)
);
alter table public.shipping_provider_jobs drop constraint if exists shipping_provider_jobs_provider_check;
alter table public.shipping_provider_jobs add constraint shipping_provider_jobs_provider_check check(provider in ('beemove','dmove','flash_express','jnt','thailand_post'));
create index if not exists shipping_provider_jobs_pending
 on public.shipping_provider_jobs(tenant_id,status,created_at desc);
create unique index if not exists shipping_provider_jobs_tracking
 on public.shipping_provider_jobs(tenant_id,provider,tracking_number)
 where tracking_number is not null;

alter table public.shipping_integrations enable row level security;
alter table public.shipping_provider_jobs enable row level security;
revoke all on public.shipping_integrations,public.shipping_provider_jobs from public,anon,authenticated;
grant all on public.shipping_integrations,public.shipping_provider_jobs to service_role;

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

create or replace function public.complete_shipping_provider_job(
 p_job uuid,p_tracking text,p_courier text,p_tracking_url text,p_label_url text
) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare j public.shipping_provider_jobs;s public.shipping_shipments;
begin
 select * into j from public.shipping_provider_jobs where id=p_job for update;
 if not found then raise exception 'SHIPPING_JOB_NOT_FOUND' using errcode='P0002';end if;
 if j.status='created' then
  return jsonb_build_object('jobId',j.id,'status',j.status,'trackingNumber',j.tracking_number,
   'trackingUrl',j.tracking_url,'labelPdfUrl',j.label_pdf_url,'courierName',j.courier_name);
 end if;
 if j.status<>'creating' or p_tracking !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{3,99}$'
  or length(trim(coalesce(p_courier,''))) not between 1 and 80
  or p_tracking_url !~ '^https://[^[:space:]]+$'
  or p_label_url !~ '^https://[^[:space:]]+$' then
  raise exception 'SHIPPING_PROVIDER_RESULT_INVALID';
 end if;
 select * into s from public.shipping_shipments where id=j.shipment_id and tenant_id=j.tenant_id for update;
 if not found or s.fulfillment_status<>'ready_to_ship' or not public.shipping_payment_ready(s.id) then
  raise exception 'SHIPPING_NOT_READY' using errcode='40001';
 end if;
 update public.shipping_shipments set tracking_number=p_tracking,courier_name=p_courier,
  tracking_url=p_tracking_url,label_pdf_url=p_label_url,fulfillment_status='shipped',
  shipped_at=clock_timestamp(),revision=revision+1 where id=s.id;
 update public.orders set status='shipped',tracking_number=p_tracking,courier_name=p_courier,
  tracking_url=p_tracking_url,label_pdf_url=p_label_url
  where shipping_shipment_id=s.id and status='paid';
 update public.shipping_provider_jobs set status='created',tracking_number=p_tracking,
  courier_name=p_courier,tracking_url=p_tracking_url,label_pdf_url=p_label_url,
  updated_at=clock_timestamp() where id=j.id;
 return jsonb_build_object('jobId',j.id,'status','created','trackingNumber',p_tracking,
  'trackingUrl',p_tracking_url,'labelPdfUrl',p_label_url,'courierName',p_courier);
end $$;

create or replace function public.finish_shipping_provider_job(
 p_job uuid,p_status text,p_error text default null
) returns void language plpgsql set search_path=pg_catalog,public as $$
begin
 if p_status not in ('failed','uncertain') then raise exception 'SHIPPING_PROVIDER_STATUS_INVALID';end if;
 update public.shipping_provider_jobs set status=p_status,error_code=left(p_error,80),
  updated_at=clock_timestamp() where id=p_job and status='creating';
end $$;

create or replace function public.mark_shipping_tracking_notification(p_job uuid,p_status text)
returns void language plpgsql set search_path=pg_catalog,public as $$
begin
 if p_status not in ('sent','failed') then raise exception 'SHIPPING_NOTIFICATION_STATUS_INVALID';end if;
 update public.shipping_provider_jobs set notification_status=p_status,updated_at=clock_timestamp()
  where id=p_job and status='created';
 if not found then raise exception 'SHIPPING_JOB_NOT_FOUND' using errcode='P0002';end if;
end $$;

revoke all on function public.save_shipping_integration(uuid,text,text,text,jsonb,text,numeric,boolean,boolean),
 public.begin_shipping_provider_job(uuid,uuid,uuid,uuid,text),
 public.complete_shipping_provider_job(uuid,text,text,text,text),
 public.finish_shipping_provider_job(uuid,text,text),
 public.mark_shipping_tracking_notification(uuid,text) from public,anon,authenticated;
grant execute on function public.save_shipping_integration(uuid,text,text,text,jsonb,text,numeric,boolean,boolean),
 public.begin_shipping_provider_job(uuid,uuid,uuid,uuid,text),
 public.complete_shipping_provider_job(uuid,text,text,text,text),
 public.finish_shipping_provider_job(uuid,text,text),
 public.mark_shipping_tracking_notification(uuid,text) to service_role;
commit;
