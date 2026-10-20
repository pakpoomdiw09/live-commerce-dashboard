# Product preset categories

The product filter and CategorySelector use the same 11 canonical presets in
commerce-core.ts. Standard options are available before any database rows exist.
Existing shop-specific categories remain selectable under a separate group.
The category-management button is no longer rendered in the product toolbar.

Selection uses a stable `preset:<key>` reference. On product save the authorized
server validates that key, resolves the canonical name and creates the tenant's
commerce_categories row if needed. The existing unique (tenant_id,name) constraint
and ignore-duplicate upsert handle concurrent first use. commerce_save_product
receives the real UUID and still validates tenant ownership. No schema migration
or eager database seeding is required. A failed product save can leave an unused
category row, which is harmless and reusable.

Filtering translates preset keys to tenant category UUIDs. An unused preset uses
an empty-match UUID rather than returning uncategorized products. Browsing does
not create categories. Product/category renaming and other legacy API operations
remain available for compatibility but are not exposed as a manager in this UI.

Validation: test-commerce.cjs covers canonical presets, unknown-key rejection,
tenant-scoped UUID resolution and empty/used preset filters. test-product-editor.cjs
covers category selection plus the existing numeric-editing regression.
