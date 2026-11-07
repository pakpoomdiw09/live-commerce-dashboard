# Automatic product image replies

Messenger image inquiries use the active product gallery of the receiving Page's tenant. No manual training uploads or reply rules are needed. `/chatbot/images` redirects to `/shop`; manage product photos, prices and stock there.

For an existing installation, apply `supabase/vision-product-catalog.sql` after `vision-master-switch.sql`, before deploying the application change. Fresh installations include it in the generated database bundles. This additive migration removes the legacy training/settings gate and retains image-assistant entitlement, quotas, shop automation, human ownership, customer/message tenant scope and Messenger window checks. It does not enable shop automation, send messages, or replay old jobs.

Enable normal shop auto replies and configure `GEMINI_API_KEY` plus `NEXT_PUBLIC_APP_URL` (or `VERCEL_PROJECT_PRODUCTION_URL`) for product links. An open storefront is required for a checkout link. Existing image-assistant plan access and quotas still apply.

The worker reads every active, non-archived product with pagination. Actual gallery photos are downloaded as small thumbnails using the existing tenant-specific Supabase Storage allowlist. Missing or inaccessible reference photos are skipped; their products cannot be selected without visual evidence. External image URLs outside that allowlist are not fetched. Each inquiry compares the available gallery in one multimodal request; catalogs beyond provider/request limits safely receive the inquiry fallback.

A product needs at least 80% model confidence and a known catalog ID. Before replying, the server re-reads the active product and open storefront using the same tenant ID. Product name, price, stock status and checkout link come from database facts. Unknown images and catalog/provider errors receive an inquiry message without pausing the bot. Failed/uncertain sends retain durable review behavior.

Existing order/auction payment-image handling retains priority. Otherwise image inquiries enter the catalog worker before standalone slip verification; confidently detected payment slips can use the existing standalone verifier when enabled. A vision result alone never marks an order paid.

New jobs run immediately. Keep the existing authenticated `/api/cron/vision` schedule for recovery after interrupted requests.

Validation: `npm.cmd run test:vision`, `npm.cmd run test:schema`, and `npm.cmd run build`.
