-- Prerequisite: commerce-v2.sql. Read-only product inquiries; no order/stock mutations.
begin;
create or replace function public.messenger_product_lookup(p_tenant uuid, p_code text)
returns table (
  id uuid, name text, price numeric, description text, images jsonb,
  store_slug text, sales_page_url text, variant_id uuid, variant_label text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  with candidates as (
    select p.id, p.name, p.price, p.description,
      coalesce(nullif(p.commerce_images, '[]'::jsonb),
        case when p.image_url is not null then jsonb_build_array(p.image_url) else '[]'::jsonb end) images,
      s.slug store_slug, to_jsonb(p)->>'sales_page_url' sales_page_url,
      null::uuid variant_id, null::text variant_label
    from public.products p
    join public.commerce_stores s on s.tenant_id = p.tenant_id and s.is_open
    join public.tenants t on t.id = p.tenant_id and t.is_active
    where p.tenant_id = p_tenant and p.is_active and not p.commerce_archived
      and length(p_code) between 1 and 60
      and (
        lower(p.code) = lower(p_code)
        or lower(p.id::text) = lower(p_code)
        -- Some installations call the product SKU cf_code/sku; the current editor stores it in code.
        or lower(to_jsonb(p)->>'cf_code') = lower(p_code)
        or lower(to_jsonb(p)->>'sku') = lower(p_code)
      )
    union all
    select p.id, p.name, v.price, p.description,
      coalesce(nullif(p.commerce_images, '[]'::jsonb),
        case when p.image_url is not null then jsonb_build_array(p.image_url) else '[]'::jsonb end),
      s.slug, to_jsonb(p)->>'sales_page_url', v.id, v.label
    from public.commerce_variants v
    join public.products p on p.id = v.product_id and p.tenant_id = v.tenant_id
    join public.commerce_stores s on s.tenant_id = p.tenant_id and s.is_open
    join public.tenants t on t.id = p.tenant_id and t.is_active
    where v.tenant_id = p_tenant and v.is_active and p.is_active and not p.commerce_archived
      and length(p_code) between 1 and 60
      and lower(to_jsonb(v)->>'variant_code') = lower(p_code)
  )
  -- Overlapping aliases are ambiguous: leave the question with normal chat/staff.
  select * from candidates where (select count(*) from candidates) = 1;
$$;
revoke all on function public.messenger_product_lookup(uuid, text) from public, anon, authenticated;
grant execute on function public.messenger_product_lookup(uuid, text) to service_role;
commit;
