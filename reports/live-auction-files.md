# Live streaming and auction file inventory

1129 source paths enumerated; 269 filename/content keyword hits plus 61 explicitly included dependency files; 229 relevant/supporting files; 101 incidental hits.

Source files; excludes dependencies/build/git/provider caches, credentials and reports themselves.

All relevant files are listed below. The CSV/JSON also retain incidental broad matches (for example general comments/security wording). Responsibilities for supporting files are derived from exported symbols, SQL objects and test names; the architecture report contains manually traced behavior.

No keyword hits were found under hooks/. Auction polling effects live in components; components/inbox/useAuctionStatuses.ts is the dedicated auction status hook.

## Application routes

| File | Responsibility |
|---|---|
| [app/(dashboard)/comment-replies/[id]/page.tsx](../app/(dashboard)/comment-replies/%5Bid%5D/page.tsx) | Dashboard editor for an existing Page comment/CF reply rule. |
| [app/(dashboard)/comment-replies/page.tsx](../app/(dashboard)/comment-replies/page.tsx) | Dashboard listing Page comment auto-reply and CF product rules. |
| [app/(dashboard)/live-auction/page.tsx](../app/(dashboard)/live-auction/page.tsx) | Active-tenant auction entry page loading Page profiles/banks and mounting LiveSessionDashboard. |
| [app/(dashboard)/live-cf/page.tsx](../app/(dashboard)/live-cf/page.tsx) | Active-tenant product-CF/live-commerce dashboard entry page. |
| [app/api/auth/facebook/callback/route.ts](../app/api/auth/facebook/callback/route.ts) | Existing-user Page connection callback, Page-token storage and webhook subscription. |
| [app/api/cron/customer-tabs/route.ts](../app/api/cron/customer-tabs/route.ts) | Authenticated recovery runner for queued customer-tab reminders. |
| [app/api/cron/facebook-webhooks/route.ts](../app/api/cron/facebook-webhooks/route.ts) | Secret-authenticated recovery worker; also drains auction, shipping and tab-reminder outboxes. |
| [app/api/customer-tabs/invoice/route.ts](../app/api/customer-tabs/invoice/route.ts) | Sends a server-rendered owned transactional invoice using a durable request/message key. |
| [app/api/customer-tabs/route.ts](../app/api/customer-tabs/route.ts) | Reads customer invoices and queues manual/all-customer reminder operations. |
| [app/api/facebook/live-videos/route.ts](../app/api/facebook/live-videos/route.ts) | Authorizes Page access before server-side live-video discovery. |
| [app/api/inbox/auction-status/route.ts](../app/api/inbox/auction-status/route.ts) | Returns tenant-scoped auction status for Inbox rows. |
| [app/api/live-auction/session/route.ts](../app/api/live-auction/session/route.ts) | Configures session automation, imports customers and loads the Thai auction dashboard RPC. |
| [app/api/live-auction/workspace/route.ts](../app/api/live-auction/workspace/route.ts) | Reads current session/round and performs idempotent unified workspace mutations. |
| [app/api/live-cf/auction/close/route.ts](../app/api/live-cf/auction/close/route.ts) | Owner close/cancel endpoint calling finalize_live_auction, then tries the notification outbox. |
| [app/api/live-cf/auction/host-action/route.ts](../app/api/live-cf/auction/host-action/route.ts) | Posts Page count/close comments and durably enqueues the confirmed provider comment. |
| [app/api/live-cf/auction/poll-comments/route.ts](../app/api/live-cf/auction/poll-comments/route.ts) | Authenticated rate-limited latest-50 comment polling; normalizes Graph results into the webhook queue and drains worker/outbox. |
| [app/api/live-cf/auction/route.ts](../app/api/live-cf/auction/route.ts) | Reads rounds/bids and creates validated tenant/Page/bank-scoped rounds. |
| [app/api/live-cf/payment-variant/route.ts](../app/api/live-cf/payment-variant/route.ts) | Validates signed order access and persists required variant choices. |
| [app/api/live-cf/products/route.ts](../app/api/live-cf/products/route.ts) | Lists/manages products and options available to live commerce. |
| [app/api/live-cf/sessions/route.ts](../app/api/live-cf/sessions/route.ts) | Reads session read models and manages winners, costs, proof corrections and reminder batches. |
| [app/api/live-cf/setup/route.ts](../app/api/live-cf/setup/route.ts) | Persists validated CF products/rules and session setup. |
| [app/api/shipping/route.ts](../app/api/shipping/route.ts) | Tenant-scoped fulfillment actions for paid orders/customer-tab shipments. |
| [app/api/slips/[id]/approve/route.ts](../app/api/slips/%5Bid%5D/approve/route.ts) | Authorized manual slip approval, including linked auction/tab payment evidence. |
| [app/api/webhook/facebook/route.ts](../app/api/webhook/facebook/route.ts) | Facebook webhook URL alias for the shared Meta ingress receiver. |
| [app/api/webhook/route.ts](../app/api/webhook/route.ts) | Webhook URL alias for the shared Meta ingress receiver. |
| [app/api/webhooks/facebook/route.ts](../app/api/webhooks/facebook/route.ts) | Plural Facebook webhook URL alias for the shared Meta ingress receiver. |
| [app/api/webhooks/route.ts](../app/api/webhooks/route.ts) | Plural webhook URL alias for the shared Meta ingress receiver. |
| [app/auth/callback/route.ts](../app/auth/callback/route.ts) | Facebook sign-in callback; verifies/saves tenant Pages and subscribes their webhook fields. |
| [app/pay/live/[token]/page.tsx](../app/pay/live/%5Btoken%5D/page.tsx) | Verifies the signed payment token and renders the appropriate order/tab payment experience. |
| [app/pay/live/[token]/slip/route.ts](../app/pay/live/%5Btoken%5D/slip/route.ts) | Validates payment-token ownership and handles proof/slip upload for the linked order/tab. |
| [app/webhook/route.ts](../app/webhook/route.ts) | Root webhook URL alias for the shared Meta challenge/signature/queue receiver. |

## Components

| File | Responsibility |
|---|---|
| [components/comment-rules/RulesTable.tsx](../components/comment-rules/RulesTable.tsx) | Lists and edits Page comment/CF automation rules. |
| [components/inbox/ChatList.tsx](../components/inbox/ChatList.tsx) | Inbox conversation list with auction status/payment badges. |
| [components/inbox/CommentsFeed.tsx](../components/inbox/CommentsFeed.tsx) | Displays recent Page comments alongside Inbox activity. |
| [components/inbox/CustomerTabsPanel.tsx](../components/inbox/CustomerTabsPanel.tsx) | Inbox customer bill summaries, transactional invoice sends and queued reminders. |
| [components/inbox/useAuctionStatuses.ts](../components/inbox/useAuctionStatuses.ts) | Fetches auction/order status badges for Inbox customer rows. |
| [components/live-cf/AuctionKeywordEditor.tsx](../components/live-cf/AuctionKeywordEditor.tsx) | Reusable confirmation and closing keyword editor. |
| [components/live-cf/AuctionRoundForm.tsx](../components/live-cf/AuctionRoundForm.tsx) | Creates, replaces or cancels a round with price, step, shipping and payment settings. |
| [components/live-cf/AuctionSessionAutomation.tsx](../components/live-cf/AuctionSessionAutomation.tsx) | Merchant controls for confirmation/closing tags and notification templates. |
| [components/live-cf/AuctionSessionCustomers.tsx](../components/live-cf/AuctionSessionCustomers.tsx) | Displays/imports/edits auction-session customers and their bill rows. |
| [components/live-cf/AuctionSessionSections.tsx](../components/live-cf/AuctionSessionSections.tsx) | Groups session configuration form sections. |
| [components/live-cf/AuctionSessionStart.tsx](../components/live-cf/AuctionSessionStart.tsx) | Starts/selects a live auction session. |
| [components/live-cf/AuctionSlipUpload.tsx](../components/live-cf/AuctionSlipUpload.tsx) | Auction payment-proof upload and submission UI. |
| [components/live-cf/AuctionUnifiedForm.tsx](../components/live-cf/AuctionUnifiedForm.tsx) | Unified seller form for round, automation, finance and source configuration. |
| [components/live-cf/CustomerTabPayment.tsx](../components/live-cf/CustomerTabPayment.tsx) | Customer-facing cumulative bill, balances, QR/payment and slip submission. |
| [components/live-cf/LiveAuctionPanel.tsx](../components/live-cf/LiveAuctionPanel.tsx) | Round/bid status polling, seller host-control buttons and delivery status display. |
| [components/live-cf/LiveAuctionWorkspace.tsx](../components/live-cf/LiveAuctionWorkspace.tsx) | Composes the auction session, setup and active-round workspace. |
| [components/live-cf/LiveCfSetup.tsx](../components/live-cf/LiveCfSetup.tsx) | Merchant editor for live-product rules, codes, options and public/private replies. |
| [components/live-cf/LiveCfVariantPayment.tsx](../components/live-cf/LiveCfVariantPayment.tsx) | Customer-side required product-variant selection before payment. |
| [components/live-cf/LiveCfWorkspace.tsx](../components/live-cf/LiveCfWorkspace.tsx) | Composes live product/CF tools and session selection. |
| [components/live-cf/LiveCommentPoller.tsx](../components/live-cf/LiveCommentPoller.tsx) | Browser comment-fallback loop: 2.5-second cadence, retries, cancellation and a 30-comment feed. |
| [components/live-cf/LiveReplyControls.tsx](../components/live-cf/LiveReplyControls.tsx) | Shared live-reply toggles, template editing and receiving-bank selection controls. |
| [components/live-cf/LiveSessionDashboard.tsx](../components/live-cf/LiveSessionDashboard.tsx) | Polls session metrics, customer ledgers, invoices and finance controls. |
| [components/live-cf/LiveSourcePicker.tsx](../components/live-cf/LiveSourcePicker.tsx) | Selects and verifies the Page/live video source. |
| [components/live-cf/LiveVideoSelect.tsx](../components/live-cf/LiveVideoSelect.tsx) | Searchable list of discovered live videos. |
| [components/live-cf/QuickProductModal.tsx](../components/live-cf/QuickProductModal.tsx) | Creates/edits live products, stock and variant options. |
| [components/live-cf/session-ui.ts](../components/live-cf/session-ui.ts) | Shared styling tokens for session controls. |
| [components/live-cf/SessionDialog.tsx](../components/live-cf/SessionDialog.tsx) | Shared session dialog container and interaction controls. |
| [components/live-cf/SessionFinance.tsx](../components/live-cf/SessionFinance.tsx) | Edits session costs, ads, shipping, fees and finance totals. |
| [components/live-cf/SessionFollowupModal.tsx](../components/live-cf/SessionFollowupModal.tsx) | Selects unpaid customers and queues customized invoice reminders. |
| [components/live-cf/SessionProofModal.tsx](../components/live-cf/SessionProofModal.tsx) | Seller slip review and payment allocation dialog. |
| [components/live-cf/SessionWinnerModal.tsx](../components/live-cf/SessionWinnerModal.tsx) | Seller manual winner/order selection workflow. |
| [components/shell/AppShell.tsx](../components/shell/AppShell.tsx) | Dashboard navigation and feature-access shell with live-commerce entrypoints. |

## Database migrations and operations

| File | Responsibility |
|---|---|
| [supabase/auction-experience.sql](../supabase/auction-experience.sql) | Schema/ledger changes: auctions. Defines/replaces RPCs: finalize_live_auction, auction_inbox_status. |
| [supabase/bank-accounts.sql](../supabase/bank-accounts.sql) | Tenant receiving-bank records and order/payment bank associations. |
| [supabase/broadcast-policy.sql](../supabase/broadcast-policy.sql) | Signed inbound message evidence and shared Messenger eligibility policy tables/functions. |
| [supabase/commerce-v2.sql](../supabase/commerce-v2.sql) | Product variants, inventory/order primitives and shared commerce rate-limit support. |
| [supabase/customer-tabs-setup.md](../supabase/customer-tabs-setup.md) | Documentation: Cumulative live bills and Smart Inbox. Treat historical winner-flow descriptions as version-specific. |
| [supabase/customer-tabs.sql](../supabase/customer-tabs.sql) | Schema/ledger changes: live_sessions, customer_tabs, orders, slips, customer_tab_items. Defines/replaces RPCs: refresh_customer_tab, attach_customer_tab_order, sync_customer_tab_order, claim_customer_tab_slip, complete_customer_tab_slip. |
| [supabase/facebook-comment-configuration.sql](../supabase/facebook-comment-configuration.sql) | Schema/ledger changes: auctions, live_sessions, facebook_comment_defaults. Defines/replaces RPCs: normalize_auction_tag, auction_comment_tags, auction_close_keyword_matches, first_configured_facebook_comment_tags, resolve_facebook_comment_settings. |
| [supabase/facebook-message-echoes.sql](../supabase/facebook-message-echoes.sql) | Outgoing echo correlation, monotonic receipt status and Inbox publication repair for transactional messages. |
| [supabase/facebook-message-window.sql](../supabase/facebook-message-window.sql) | Verified inbound-time rules and transactional message persistence; auction comments cannot renew messaging windows. |
| [supabase/facebook-webhook-comment-ordering.sql](../supabase/facebook-webhook-comment-ordering.sql) | Canonical per-Page comment queue ordering and enqueue validation across bidders/host commands. |
| [supabase/facebook-webhook-cron-setup.md](../supabase/facebook-webhook-cron-setup.md) | Documentation: เรียก Facebook Webhook Worker ทุก 1 นาทีด้วย cron-job.org. Treat historical winner-flow descriptions as version-specific. |
| [supabase/facebook-webhook-nonblocking.sql](../supabase/facebook-webhook-nonblocking.sql) | Queue recovery policy that avoids permanently blocking later events behind dead/review work. |
| [supabase/live-auction-close-presets.sql](../supabase/live-auction-close-presets.sql) | Defines/replaces RPCs: default_auction_close_keywords, auction_close_keyword_matches, normalize_auction_thai_settings, process_live_auction_comment. |
| [supabase/live-auction-customer-columns.sql](../supabase/live-auction-customer-columns.sql) | Defines/replaces RPCs: live_auction_thai_dashboard. |
| [supabase/live-auction-customer-workspace.sql](../supabase/live-auction-customer-workspace.sql) | Schema/ledger changes: live_session_customer_notes. Defines/replaces RPCs: live_auction_matched_customers, live_auction_customer_dashboard, save_auction_customer_note, collect_auction_session_customers. |
| [supabase/live-auction-dashboard.sql](../supabase/live-auction-dashboard.sql) | Schema/ledger changes: live_sessions, auctions, auction_session_requests. Defines/replaces RPCs: configure_auction_session, inherit_auction_session_settings, live_auction_dashboard. |
| [supabase/live-auction-diagnostics.md](../supabase/live-auction-diagnostics.md) | Documentation: ผลตรวจ Live Auction จากฐานจริง วันที่ 3 พฤศจิกายน 2026. Treat historical winner-flow descriptions as version-specific. |
| [supabase/live-auction-dynamic-tags.sql](../supabase/live-auction-dynamic-tags.sql) | Schema/ledger changes: auctions. Defines/replaces RPCs: normalize_auction_tag, auction_comment_tags, auction_close_keyword_matches, process_live_auction_comment. |
| [supabase/live-auction-empty-keyword-defaults.sql](../supabase/live-auction-empty-keyword-defaults.sql) | Defines/replaces RPCs: live_auction_thai_dashboard, default_auction_close_keywords, normalize_auction_thai_settings, configure_auction_session. |
| [supabase/live-auction-highest-confirmation.sql](../supabase/live-auction-highest-confirmation.sql) | Defines/replaces RPCs: process_live_auction_comment. |
| [supabase/live-auction-instant-winners.sql](../supabase/live-auction-instant-winners.sql) | Defines/replaces RPCs: live_auction_dashboard. |
| [supabase/live-auction-on-demand.sql](../supabase/live-auction-on-demand.sql) | Schema/ledger changes: orders, auction_winner_claims, auction_deliveries. Defines/replaces RPCs: claim_auction_bill_delivery, auction_numeric_price, process_live_auction_highest_bid, finalize_live_auction_highest_bid, finalize_live_auction. |
| [supabase/live-auction-payment-auto-verify.sql](../supabase/live-auction-payment-auto-verify.sql) | Defines/replaces RPCs: complete_auction_customer_tab_slip. |
| [supabase/live-auction-production-readiness.sql](../supabase/live-auction-production-readiness.sql) | Schema/ledger changes: shipping_integrations, shipping_provider_jobs, shipping_tracking_deliveries. Defines/replaces RPCs: live_session_dashboard, manage_live_session, save_auction_workspace, confirm_live_auction_winner, save_shipping_integration. |
| [supabase/live-auction-split-summary.sql](../supabase/live-auction-split-summary.sql) | Schema/ledger changes: auction_deliveries. Defines/replaces RPCs: normalize_auction_thai_settings. |
| [supabase/live-auction-thai-workflow.sql](../supabase/live-auction-thai-workflow.sql) | Defines/replaces RPCs: normalize_auction_thai_settings, inherit_auction_session_settings, live_auction_thai_dashboard, configure_auction_session, finalize_live_auction. |
| [supabase/live-auction-unlimited-keywords.sql](../supabase/live-auction-unlimited-keywords.sql) | Defines/replaces RPCs: configure_auction_session. |
| [supabase/live-auction-winner-confirmation.sql](../supabase/live-auction-winner-confirmation.sql) | Schema/ledger changes: auctions, auction_deliveries. Defines/replaces RPCs: hold_auction_winner_notifications, confirm_live_auction_winner. |
| [supabase/live-auction-workspace.sql](../supabase/live-auction-workspace.sql) | Schema/ledger changes: live_sessions, auction_workspace_requests. Defines/replaces RPCs: save_auction_workspace. |
| [supabase/live-auctions-setup.md](../supabase/live-auctions-setup.md) | Documentation: Live auctions. Treat historical winner-flow descriptions as version-specific. |
| [supabase/live-auctions.sql](../supabase/live-auctions.sql) | Schema/ledger changes: auctions, auction_bids, auction_deliveries, auction_payment_proofs. Defines/replaces RPCs: submit_auction_payment_proof, approve_auction_payment_proof, auction_comment_ordering, finalize_live_auction, process_live_auction_comment. |
| [supabase/live-cf-customer-variants.sql](../supabase/live-cf-customer-variants.sql) | Schema/ledger changes: comment_rules, orders. Defines/replaces RPCs: validate_live_cf_setup_rule, place_cf_order, confirm_live_cf_variant, guard_live_cf_variant_payment, guard_live_cf_variant_slip. |
| [supabase/live-cf-mode.sql](../supabase/live-cf-mode.sql) | Schema/ledger changes: comment_rules, orders. Defines/replaces RPCs: validate_live_cf_rule, on_order_status, place_live_cf_order. |
| [supabase/live-cf-order-post.sql](../supabase/live-cf-order-post.sql) | SQL policies, permissions, seeds or operational diagnostics supporting the engine. |
| [supabase/live-cf-setup.sql](../supabase/live-cf-setup.sql) | Schema/ledger changes: comment_rules, orders, live_cf_webhook_receipts. Defines/replaces RPCs: validate_live_cf_setup_rule, on_order_status, place_cf_order, place_live_cf_order. |
| [supabase/live-cf-variants.sql](../supabase/live-cf-variants.sql) | Schema/ledger changes: commerce_variants, orders. Defines/replaces RPCs: commerce_save_product, on_order_status, place_cf_order_core, place_cf_order. |
| [supabase/live-customer-item-labels.sql](../supabase/live-customer-item-labels.sql) | SQL policies, permissions, seeds or operational diagnostics supporting the engine. |
| [supabase/live-order-types.sql](../supabase/live-order-types.sql) | Schema/ledger changes: orders, customer_tab_items. Defines/replaces RPCs: stamp_live_item_type, live_session_dashboard. |
| [supabase/live-session-dashboard.sql](../supabase/live-session-dashboard.sql) | Schema/ledger changes: live_sessions, customer_tab_reminders, customer_tabs, live_session_changes, live_reminder_dispatch_slots. Defines/replaces RPCs: ensure_auction_live_session, stamp_customer_tab_proof, attach_customer_tab_order, live_comment_time, live_session_dashboard. |
| [supabase/platform.sql](../supabase/platform.sql) | Platform user/tenant/member tables and shared access primitives. |
| [supabase/schema.sql](../supabase/schema.sql) | Base customer, message, comment and slip tables plus initial Realtime publication entries. |
| [supabase/security.sql](../supabase/security.sql) | Tenant-membership RLS and browser table permissions supporting the live-commerce authorization boundary. |
| [supabase/tenants.sql](../supabase/tenants.sql) | Tenant ownership columns and Page/token configuration underlying live commerce. |

## Documentation

| File | Responsibility |
|---|---|
| [docs/AUCTION-EXPERIENCE.md](../docs/AUCTION-EXPERIENCE.md) | Documentation: Live Auction setup and Inbox integration. Treat historical winner-flow descriptions as version-specific. |
| [docs/auction-on-demand-winners.md](../docs/auction-on-demand-winners.md) | Documentation: Flexible On-Demand Winner Flow. Treat historical winner-flow descriptions as version-specific. |
| [docs/FACEBOOK-LIVE-COMMENTS.md](../docs/FACEBOOK-LIVE-COMMENTS.md) | Documentation: ตรวจและแก้ Facebook Live Comment Webhook. Treat historical winner-flow descriptions as version-specific. |
| [docs/LIVE-AUCTION-CONSOLE.md](../docs/LIVE-AUCTION-CONSOLE.md) | Documentation: Live Auction Console. Treat historical winner-flow descriptions as version-specific. |
| [docs/LIVE-AUCTION-DASHBOARD.md](../docs/LIVE-AUCTION-DASHBOARD.md) | Documentation: แดชบอร์ดไลฟ์สดการประมูลครบวงจร. Treat historical winner-flow descriptions as version-specific. |
| [docs/live-auction-highest-confirmation.md](../docs/live-auction-highest-confirmation.md) | Documentation: Highest-bid winner confirmation. Treat historical winner-flow descriptions as version-specific. |
| [docs/live-auction-readiness-fixes-2026-11-06.md](../docs/live-auction-readiness-fixes-2026-11-06.md) | Documentation: Live Auction readiness fixes — 6 November 2026. Treat historical winner-flow descriptions as version-specific. |
| [docs/live-cf-mode.md](../docs/live-cf-mode.md) | Documentation: โหมดไลฟ์สดในชุดตอบกลับคอมเมนต์. Treat historical winner-flow descriptions as version-specific. |
| [docs/live-cf-setup.md](../docs/live-cf-setup.md) | Documentation: ตั้งค่าระบบดูดออเดอร์ไลฟ์สด. Treat historical winner-flow descriptions as version-specific. |
| [docs/LIVE-SESSION-DASHBOARD.md](../docs/LIVE-SESSION-DASHBOARD.md) | Documentation: แดชบอร์ดประมูลราย Session. Treat historical winner-flow descriptions as version-specific. |
| [docs/production-readiness-audit-2026-11-06.md](../docs/production-readiness-audit-2026-11-06.md) | Documentation: Live Auction & Fulfillment Automation — Production Readiness Audit. Treat historical winner-flow descriptions as version-specific. |
| [docs/SNAPBOT-SECURITY-AUDIT-2026-11-01.md](../docs/SNAPBOT-SECURITY-AUDIT-2026-11-01.md) | Documentation: SnapBot / Live Commerce — Architecture & Security Audit. Treat historical winner-flow descriptions as version-specific. |
| [docs/vision-product-catalog.md](../docs/vision-product-catalog.md) | Documentation: Automatic product image replies. Treat historical winner-flow descriptions as version-specific. |
| [README.md](../README.md) | Project setup and feature entrypoint documentation. |

## Generated schema

| File | Responsibility |
|---|---|
| [supabase/complete_schema.sql](../supabase/complete_schema.sql) | Generated from the migration registry; includes repeated/overridden historical definitions. Do not infer final runtime behavior from the first definition. |
| [supabase/full_database_setup-manifest.md](../supabase/full_database_setup-manifest.md) | Generated from the migration registry; includes repeated/overridden historical definitions. Do not infer final runtime behavior from the first definition. |
| [supabase/full_database_setup.sql](../supabase/full_database_setup.sql) | Generated from the migration registry; includes repeated/overridden historical definitions. Do not infer final runtime behavior from the first definition. |

## Libraries

| File | Responsibility |
|---|---|
| [lib/auth.ts](../lib/auth.ts) | Verified dashboard actors and tenant membership/role checks used by auction APIs. |
| [lib/feature-flags.ts](../lib/feature-flags.ts) | Controls live_cf availability; the current implementation enables it by default unless explicitly disabled. |
| [lib/features/comments/comment-rules.ts](../lib/features/comments/comment-rules.ts) | Rule types, keyword matching and live-product rule helpers. |
| [lib/features/comments/live-comment-routing.ts](../lib/features/comments/live-comment-routing.ts) | Canonical post/video aliases and precedence for auction versus product-CF rule routing. |
| [lib/features/comments/live-products.ts](../lib/features/comments/live-products.ts) | Associates configured live products with comment rules. |
| [lib/features/commerce/auction-api.ts](../lib/features/commerce/auction-api.ts) | Owner/tenant authorization, feature gating, same-origin writes and API error mapping. |
| [lib/features/commerce/auction-hosts.ts](../lib/features/commerce/auction-hosts.ts) | Resolves trusted personal Facebook host IDs from verified user/Page credentials. |
| [lib/features/commerce/auction-server.ts](../lib/features/commerce/auction-server.ts) | Routes comments to rounds and orchestrates durable public/private winner-notification deliveries. |
| [lib/features/commerce/auction-templates.ts](../lib/features/commerce/auction-templates.ts) | Winner/bid/close message defaults, variable validation and financial-footer composition. |
| [lib/features/commerce/auction-types.ts](../lib/features/commerce/auction-types.ts) | TypeScript round, bid and processing-result contracts. |
| [lib/features/commerce/cf-code.ts](../lib/features/commerce/cf-code.ts) | Normalizes product codes and extracts Thai/English CF purchase-intent prefixes. |
| [lib/features/commerce/comment-config.ts](../lib/features/commerce/comment-config.ts) | Shared normalization, defaults and session-over-round tag/template precedence. |
| [lib/features/commerce/commerce-core.ts](../lib/features/commerce/commerce-core.ts) | Shared product, money, storefront-design and commerce input validation/contracts. |
| [lib/features/commerce/commerce-server.ts](../lib/features/commerce/commerce-server.ts) | Tenant-scoped server reads and mutations shared by commerce setup. |
| [lib/features/commerce/customer-tab-reminders.ts](../lib/features/commerce/customer-tab-reminders.ts) | Claims reminder jobs, rechecks balances/policy and dispatches durable message parts. |
| [lib/features/commerce/customer-tab-types.ts](../lib/features/commerce/customer-tab-types.ts) | Customer-tab item/payment types and deterministic financial text formatting. |
| [lib/features/commerce/customer-tabs-server.ts](../lib/features/commerce/customer-tabs-server.ts) | Loads order/tab ledgers, banking details, cumulative invoice text and signed payment links. |
| [lib/features/commerce/live-cf-codes.ts](../lib/features/commerce/live-cf-codes.ts) | Validates and allocates live-product codes. |
| [lib/features/commerce/live-cf-comment.ts](../lib/features/commerce/live-cf-comment.ts) | Handles product-code purchase comments and composes comment-scoped payment replies. |
| [lib/features/commerce/live-cf-payment-link.ts](../lib/features/commerce/live-cf-payment-link.ts) | Signs and verifies expiring order payment links using an HMAC secret. |
| [lib/features/commerce/live-cf-setup.ts](../lib/features/commerce/live-cf-setup.ts) | Validates setup input, reply templates, variant choices and Facebook live URLs/IDs. |
| [lib/features/commerce/live-session-types.ts](../lib/features/commerce/live-session-types.ts) | Session dashboard, finance, invoice and follow-up view/input contracts. |
| [lib/features/commerce/live-source.ts](../lib/features/commerce/live-source.ts) | Resolves live-source selections and URL/ID metadata. |
| [lib/features/commerce/messenger-product-server.ts](../lib/features/commerce/messenger-product-server.ts) | Routes inbound Messenger product-code requests into product/payment replies. |
| [lib/features/commerce/messenger-product.ts](../lib/features/commerce/messenger-product.ts) | Extracts product codes from Messenger text and builds deterministic catalog responses. |
| [lib/features/commerce/orders.ts](../lib/features/commerce/orders.ts) | Creates catalog/comment orders and reads unpaid orders for billing. |
| [lib/features/commerce/product-options.ts](../lib/features/commerce/product-options.ts) | Builds valid option combinations and variant overrides for live products. |
| [lib/features/commerce/quick-product.ts](../lib/features/commerce/quick-product.ts) | Validates quick-product creation/editing and related option/variant inputs. |
| [lib/features/commerce/session-automation.ts](../lib/features/commerce/session-automation.ts) | Session keyword/reply settings, legacy winner-flow compatibility and cumulative invoice message plans. |
| [lib/features/commerce/session-customer-rows.ts](../lib/features/commerce/session-customer-rows.ts) | Builds customer/session row models for auction workspace tables. |
| [lib/features/commerce/stock-subscription.ts](../lib/features/commerce/stock-subscription.ts) | Supabase Realtime product/variant stock subscription and visibility cleanup. |
| [lib/features/inbox/inbox-automation-window.ts](../lib/features/inbox/inbox-automation-window.ts) | Automation dispatch gate preventing unverified/out-of-window bot sends. |
| [lib/features/inbox/inbox-policy-server.ts](../lib/features/inbox/inbox-policy-server.ts) | Server Messenger-window/token checks reused by live customer-tab reminders. |
| [lib/features/inbox/standard-message-window.ts](../lib/features/inbox/standard-message-window.ts) | Standard-window timestamp eligibility helpers shared by messaging flows. |
| [lib/features/slips/customer-tab-slip.ts](../lib/features/slips/customer-tab-slip.ts) | Claims customer-tab slip processing and applies verified payments through ledger RPCs. |
| [lib/features/slips/image.ts](../lib/features/slips/image.ts) | Downloads and validates candidate receipt images before verification. |
| [lib/features/slips/notify.ts](../lib/features/slips/notify.ts) | Durable bot transcript/message claims, policy checks and external delivery used by billing automation. |
| [lib/features/slips/process.ts](../lib/features/slips/process.ts) | Slip verification orchestration shared with live invoice payments. |
| [lib/integrations/facebook/auction-comment-parser.ts](../lib/integrations/facebook/auction-comment-parser.ts) | Normalizes comment text and classifies host controls, opening bids, confirmation keywords and numeric bids. |
| [lib/integrations/facebook/auction-parser.ts](../lib/integrations/facebook/auction-parser.ts) | Compatibility re-export of the auction comment parser. |
| [lib/integrations/facebook/client.ts](../lib/integrations/facebook/client.ts) | Shared Graph transport, Page token selection and transactional/direct/private Messenger delivery with safe diagnostics. |
| [lib/integrations/facebook/diagnostics.ts](../lib/integrations/facebook/diagnostics.ts) | Redacts credentials and sensitive payload fields in Facebook diagnostic output. |
| [lib/integrations/facebook/live-cf-adapter.ts](../lib/integrations/facebook/live-cf-adapter.ts) | Injectable public/private comment text sender with an isolated mock implementation. |
| [lib/integrations/facebook/live-videos.ts](../lib/integrations/facebook/live-videos.ts) | Server-side Meta live-video discovery, Page filtering and provider error diagnostics. |
| [lib/integrations/facebook/message-window.ts](../lib/integrations/facebook/message-window.ts) | Separately validates genuine inbound messages and outgoing echoes; protects service-window evidence. |
| [lib/integrations/facebook/oauth.ts](../lib/integrations/facebook/oauth.ts) | Page discovery, token verification and Page webhook field subscriptions. |
| [lib/integrations/facebook/sync-pagination.ts](../lib/integrations/facebook/sync-pagination.ts) | Validates Graph continuation URLs/cursors, partial-history sync and scoped bearer-token transport. |
| [lib/integrations/facebook/webhook-envelope.ts](../lib/integrations/facebook/webhook-envelope.ts) | Validates/normalizes payloads and derives canonical event and ordering keys. |
| [lib/integrations/facebook/webhook-handler.ts](../lib/integrations/facebook/webhook-handler.ts) | Resolves Page tenants, routes messages/comments, auction/CF orders, slips and receipts. |
| [lib/integrations/facebook/webhook-http.ts](../lib/integrations/facebook/webhook-http.ts) | Verifies Meta GET challenges/HMAC POST bodies, durably enqueues and schedules a deferred worker. |
| [lib/integrations/facebook/webhook-worker.ts](../lib/integrations/facebook/webhook-worker.ts) | Claims fenced DB leases, heartbeats, checkpoints external steps and handles retry/review outcomes. |
| [lib/message-quota.ts](../lib/message-quota.ts) | Message-credit accounting used by shared bot billing/notification delivery. |
| [lib/supabase/server.ts](../lib/supabase/server.ts) | Server-side service-role database client and authenticated cookie session client. |
| [lib/tenant.ts](../lib/tenant.ts) | Authenticated active-tenant selection and server-only Page-profile/token-backed connection reads. |

## Supporting configuration

| File | Responsibility |
|---|---|
| [.github/workflows/customer-tab-cron.yml](../.github/workflows/customer-tab-cron.yml) | Supporting source/tool referenced by live commerce or its database/tests. |
| [middleware.ts](../middleware.ts) | Browser-session middleware and public webhook exclusions. |
| [package.json](../package.json) | Lists auction/live/session test and browser-check entrypoints and application dependencies. |
| [vercel.json](../vercel.json) | Vercel deployment configuration; currently declares no cron schedules. |

## Tests, fixtures and tooling

| File | Responsibility |
|---|---|
| [scripts/build-full-database-setup.cjs](../scripts/build-full-database-setup.cjs) | Defines canonical migration order/dependencies and generates schema bundles; use this order to resolve SQL overrides. |
| [scripts/check-auction-browser.cjs](../scripts/check-auction-browser.cjs) | Coverage: window.auctionQA && document.querySelector(; document.querySelector(. |
| [scripts/check-live-cf-browser.cjs](../scripts/check-live-cf-browser.cjs) | Coverage: !!document.querySelector(; !!document.querySelector(. |
| [scripts/check-live-cf-setup-browser.cjs](../scripts/check-live-cf-setup-browser.cjs) | Coverage: !!document.querySelector(; document.querySelector(${JSON.stringify(liveSelector)})?.dataset.selectedVideoId === . |
| [scripts/check-live-session-browser.cjs](../scripts/check-live-session-browser.cjs) | Coverage: !!document.querySelector(; document.querySelector(. |
| [scripts/check-ui-browser.cjs](../scripts/check-ui-browser.cjs) | Coverage: document.querySelector(; document.querySelector(. |
| [scripts/diagnose-auction-ingest.cjs](../scripts/diagnose-auction-ingest.cjs) | Coverage: _. |
| [scripts/diagnose-facebook-webhook.cjs](../scripts/diagnose-facebook-webhook.cjs) | Coverage: ?; ?. |
| [scripts/fixtures/live-cf/auction-entry.tsx](../scripts/fixtures/live-cf/auction-entry.tsx) | Isolated browser fixture/mocks for live-cf; no production engine ownership. |
| [scripts/fixtures/live-cf/entry.tsx](../scripts/fixtures/live-cf/entry.tsx) | Isolated browser fixture/mocks for live-cf; no production engine ownership. |
| [scripts/fixtures/live-cf/mocks.tsx](../scripts/fixtures/live-cf/mocks.tsx) | Isolated browser fixture/mocks for live-cf; no production engine ownership. |
| [scripts/fixtures/live-cf/session-entry.tsx](../scripts/fixtures/live-cf/session-entry.tsx) | Isolated browser fixture/mocks for live-cf; no production engine ownership. |
| [scripts/fixtures/live-cf/setup-entry.tsx](../scripts/fixtures/live-cf/setup-entry.tsx) | Coverage: /. |
| [scripts/fixtures/live-cf/setup-mocks.tsx](../scripts/fixtures/live-cf/setup-mocks.tsx) | Isolated browser fixture/mocks for live-cf; no production engine ownership. |
| [scripts/fixtures/live-cf/shipping-entry.tsx](../scripts/fixtures/live-cf/shipping-entry.tsx) | Isolated browser fixture/mocks for live-cf; no production engine ownership. |
| [scripts/helpers/check-unified-auction.cjs](../scripts/helpers/check-unified-auction.cjs) | Coverage: !!document.querySelector(; document.querySelector(. |
| [scripts/test-auction-cron.cjs](../scripts/test-auction-cron.cjs) | Coverage: external cron GET requests require authentication and drain webhook and auction outbox work. |
| [scripts/test-auction-customer-tab-slip.cjs](../scripts/test-auction-customer-tab-slip.cjs) | Coverage: auction amount mismatches are recorded as invalid and never use the paid auction settlement RPC; valid exact auction slips settle through the winner-scoped database function. |
| [scripts/test-auction-host-actions.cjs](../scripts/test-auction-host-actions.cjs) | Coverage: host shortcuts post Page-owned comments to the stored live video and enqueue canonical events; invalid, unauthorized, foreign, closed and disconnected host actions never contact Meta. |
| [scripts/test-auction-hosts.cjs](../scripts/test-auction-hosts.cjs) | Coverage: hosts contain the Page and authenticated Facebook identity, never the Supabase UUID; separate Facebook connection uses only the signed-in owner and selected Page. |
| [scripts/test-auction-invoice-messaging.cjs](../scripts/test-auction-invoice-messaging.cjs) | Coverage: invoice uses MESSAGE_TAG and POST_PURCHASE_UPDATE; normal chat remains RESPONSE; definite window or missing-recipient rejection falls back to the winning comment exactly once. |
| [scripts/test-auction-on-demand.cjs](../scripts/test-auction-on-demand.cjs) | Coverage: only the active highest bidder can confirm; invoices, outbox, replay and tenant guards are atomic. |
| [scripts/test-auction-server.cjs](../scripts/test-auction-server.cjs) | Coverage: highest-bid confirmation dispatches the active winner bill immediately and honors public reply off; legacy split-summary deliveries retain their ordered recovery plan. |
| [scripts/test-auction-workspace-api.cjs](../scripts/test-auction-workspace-api.cjs) | Coverage: workspace API restores scoped saved values and commits a single normalized request after owner authorization. |
| [scripts/test-auction-workspace.cjs](../scripts/test-auction-workspace.cjs) | Coverage: unified workspace saves all zones atomically, preserves merchant values and fences retries/bids. |
| [scripts/test-complete-schema.cjs](../scripts/test-complete-schema.cjs) | Coverage: complete schema runs in one SQL Editor request and re-runs without altering application data; complete schema adopts the installed latest schema without a registry and preserves transfers and quotas. |
| [scripts/test-customer-tab-services.cjs](../scripts/test-customer-tab-services.cjs) | Coverage: mixed auction/CF bills label provenance and retain the shared ledger total; tab SlipOK path omits a full-amount constraint, accepts partials, and replays an image without another provider charge. |
| [scripts/test-customer-tabs.cjs](../scripts/test-customer-tabs.cjs) | Coverage: cumulative tabs atomically reopen, accept partials, charge shipping once and fence duplicate/foreign payments. |
| [scripts/test-facebook-page-token.cjs](../scripts/test-facebook-page-token.cjs) | Coverage: auction host lookup accepts only a valid Page token from this app and Page; messaging Page is verified without profile-reading permissions. |
| [scripts/test-facebook-webhook-queue.cjs](../scripts/test-facebook-webhook-queue.cjs) | Coverage: image candidates ignore malformed attachments and sticker images; echoes persist outgoing history, deduplicate metadata races and never renew the inbound window. |
| [scripts/test-live-auction-dashboard-api.cjs](../scripts/test-live-auction-dashboard-api.cjs) | Coverage: all-in-one API authorizes before reads, validates settings and normalizes templates without accepting client balances. |
| [scripts/test-live-auctions.cjs](../scripts/test-live-auctions.cjs) | Coverage: live auctions execute against the complete schema: ordering, steps, close, replay, proof and isolation. |
| [scripts/test-live-cf-mode.cjs](../scripts/test-live-cf-mode.cjs) | Coverage: Live aliases use the current Contains matcher, scope posts, and retain Exact matching; live_comments are normalized before persistence and deduplicate against feed without processing edits. |
| [scripts/test-live-session-dashboard.cjs](../scripts/test-live-session-dashboard.cjs) | Coverage: the customer grid merges identities once, retains billed-only customers, and never merges namesakes; customer status counts unique bills and separates unpaid, partial, exact and overpaid balances. |
| [scripts/test-route-security.cjs](../scripts/test-route-security.cjs) | Coverage: unauthenticated slip GET never creates a service client; forbidden, missing and failed scope lookups never load detail/sign URLs. |
| [scripts/test-shipping.cjs](../scripts/test-shipping.cjs) | Coverage: Thai address parsing copies complete evidence and refuses missing/ambiguous recipients and phones; shipping routes reject anonymous/foreign/cross-origin requests before reading or writing recipient details. |
| [scripts/test-slip-automatic-gate.cjs](../scripts/test-slip-automatic-gate.cjs) | Coverage: Messenger slips route on-demand bills even when the claimant is not the global leader; auction slips settle only the exact pending tab bill belonging to the closed-round winner. |
| [tests/features/commerce/auction-comment.test.ts](../tests/features/commerce/auction-comment.test.ts) | Coverage: opening chatter uses opening intent, including incidental numbers; host identity determines commands; a customer cannot close or count. |
| [tests/features/commerce/auction-confirmation.test.ts](../tests/features/commerce/auction-confirmation.test.ts) | Supporting source/tool referenced by live commerce or its database/tests. |
| [tests/features/commerce/comment-config.test.ts](../tests/features/commerce/comment-config.test.ts) | Coverage: dashboard tags win and empty normalized arrays fall through every source before defaults; canonical session tags override aliases, normalize Unicode and use centralized empty defaults. |
| [tests/features/commerce/live-cf-codes-api.test.ts](../tests/features/commerce/live-cf-codes-api.test.ts) | Coverage: Live CF setup saves every tag to keywords for create/update and accepts legacy single-code requests; switching Exact to Contains persists the selected mode and reloaded rules use the preview matcher. |
| [tests/features/commerce/live-cf-comment.test.ts](../tests/features/commerce/live-cf-comment.test.ts) | Coverage: live comment CF orders match codes, protect stock, and send one secure payment link; private reply template replaces all variables: product_name, variant_name, price, total, payment_link. |
| [tests/features/commerce/live-cf-input.test.ts](../tests/features/commerce/live-cf-input.test.ts) | Coverage: Contains matches partial keywords, punctuation and mixed letter/number spacing identically in preview and webhook; draft codes preview only configured prefixes without adding a saved tag. |
| [tests/features/commerce/live-cf-payment-variant.test.ts](../tests/features/commerce/live-cf-payment-variant.test.ts) | Coverage: /; signed customer variant selection needs no login and sends only verified order and variant IDs to the atomic RPC. |
| [tests/features/commerce/live-cf-product-options.test.ts](../tests/features/commerce/live-cf-product-options.test.ts) | Coverage: product options require owner scope before accessing categories and return private uncached data; category picker pages through tenant-scoped rows and fails rather than returning partial options. |
| [tests/features/commerce/live-cf-setup.test.ts](../tests/features/commerce/live-cf-setup.test.ts) | Coverage: quick-created products are active on the sales page with the submitted code, price and stock; full quick products persist category, image metadata, flags and exact variant IDs atomically. |
| [tests/features/commerce/live-webhook.test.ts](../tests/features/commerce/live-webhook.test.ts) | Coverage: supported comment fields canonicalize IDs, authors and video IDs before deduplication; every entry routes by its normalized Page ID; unsafe numeric IDs cannot silently lose precision. |
| [tests/features/commerce/messenger-product.test.ts](../tests/features/commerce/messenger-product.test.ts) | Coverage: extracts exact Messenger codes with prefixes, punctuation, case, and leading zeroes; builds a product card with price, image, description, and direct sales-page button. |

## Effective SQL entrypoints

These are the last explicit definitions in the registered migration order. The isolated reproduction additionally inspects installed pg_get_functiondef results, because older migrations also contain dynamic definition rewrites.

| Function | Last explicit source |
|---|---|
| finalize_live_auction | [supabase/live-auction-on-demand.sql:167](../supabase/live-auction-on-demand.sql#L167) |
| process_live_auction_comment | [supabase/facebook-comment-configuration.sql:321](../supabase/facebook-comment-configuration.sql#L321) |
| manage_live_session | [supabase/live-auction-production-readiness.sql:55](../supabase/live-auction-production-readiness.sql#L55) |
| queue_live_session_reminders | [supabase/live-session-dashboard.sql:301](../supabase/live-session-dashboard.sql#L301) |
| configure_auction_session | [supabase/live-auction-empty-keyword-defaults.sql:50](../supabase/live-auction-empty-keyword-defaults.sql#L50) |
| save_auction_workspace | [supabase/live-auction-production-readiness.sql:168](../supabase/live-auction-production-readiness.sql#L168) |
| claim_auction_bill_delivery | [supabase/live-auction-on-demand.sql:32](../supabase/live-auction-on-demand.sql#L32) |
| auction_numeric_price | [supabase/live-auction-on-demand.sql:49](../supabase/live-auction-on-demand.sql#L49) |
| process_live_auction_highest_bid | [supabase/facebook-comment-configuration.sql:212](../supabase/facebook-comment-configuration.sql#L212) |
| finalize_live_auction_highest_bid | [supabase/facebook-comment-configuration.sql:274](../supabase/facebook-comment-configuration.sql#L274) |
