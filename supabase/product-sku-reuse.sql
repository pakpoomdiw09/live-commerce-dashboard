-- Apply after commerce-v2.sql. Reuses archived SKUs without deleting history.
-- Run outside peak traffic: rebuilding this index briefly blocks product writes.
-- The transaction restores the old index if any statement fails.
begin;
lock table public.products in share row exclusive mode;
drop index if exists public.products_tenant_code;
create unique index products_tenant_code on public.products (tenant_id,lower(code))
 where not commerce_archived;
commit;

-- Verify the predicate. Names may repeat; this schema has no product slug.
select indexname,indexdef from pg_indexes
where schemaname='public' and tablename='products' and indexname='products_tenant_code';
