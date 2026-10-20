# Reuse a deleted product's SKU

Shop V2 uses `products.commerce_archived=true` for deletion. `is_active=false`
means the product is merely closed for sale and must still reserve its SKU.
The original `orders.sql` index covered archived rows too. There is no separate
JavaScript duplicate lookup: `commerce_save_product` relies on PostgreSQL to
arbitrate concurrent inserts/updates. A client precheck alone would not fix this.

For existing deployments, run **supabase/product-sku-reuse.sql** in Supabase SQL
Editor after commerce-v2.sql. It transactionally replaces the known index with:

```sql
create unique index products_tenant_code
on public.products (tenant_id, lower(code))
where not commerce_archived;
```

The migration includes dropping the old index; executing only CREATE would leave
the original restriction in place. Run outside peak traffic because index rebuild
blocks product writes. No product, variant or historical order is deleted or
renamed. If a statement fails, the transaction rolls back. It is safe to rerun.
New commerce-v2 installations include the corrected definition too.

Product names are not unique in this schema, and products have no slug column.
The old API message mentioned names/links generically for unrelated store/category/
sales-page constraints; product conflicts now mention SKU specifically. Store and
sales-page slug constraints are unchanged.

If another deployment has extra custom constraints, inspect them first:

```sql
select indexname, indexdef from pg_indexes
where schemaname='public' and tablename='products';

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid='public.products'::regclass and contype='u';
```

The migration replaces only `products_tenant_code`; it does not guess/drop custom
SKU/name/slug constraints. A constraint-backed unique index requires altering its
own constraint, not blindly dropping its index.

Validation: test-commerce-sql.cjs reproduces the old failure, applies the migration
twice, reuses an archived SKU (and product name), verifies historical item links,
rejects case-insensitive duplicates against unpublished products, prevents restoring
an archived conflicting SKU, and permits the same SKU for another tenant. All tests
use isolated PGlite; production migrations are not applied by the test runner.
