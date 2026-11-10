# Supabase SQL migration registry

พบ SQL ต้นฉบับ 144 ไฟล์: รวมตาม dependencies 126 ไฟล์ และแยกไว้ 18 ไฟล์
หลังสร้างไฟล์รวมจะมี SQL ทั้งหมด 146 ไฟล์ รวมไฟล์ generated ทั้งสองด้วย

ไฟล์แนะนำสำหรับ SQL Editor: [complete_schema.sql](complete_schema.sql) (1260150 bytes)
ติดตั้ง/อัปเกรดใน transaction เดียว และรันซ้ำได้ด้วย snapbot_schema_migrations โดยข้าม migration ที่ใช้ไปแล้ว
ตรวจ checksum ป้องกันการแก้ประวัติที่ apply แล้ว และคง proof-ledger backfills เพื่อรักษาการป้องกันสลิปซ้ำ
หากต้องเพิ่มการเปลี่ยนแปลงหลัง apply ให้เพิ่ม source migration ใหม่ท้าย registry แล้ว regenerate
ดู [วิธีใช้งานและข้อจำกัด](MIGRATIONS.md)

## ไฟล์ bootstrap เดิม (ฐานใหม่เท่านั้น)

ไฟล์เต็ม: [full_database_setup.sql](full_database_setup.sql) (1089242 bytes, 17802 lines)
ไฟล์นี้เป็น schema/bootstrap สำหรับ Supabase **ใหม่เท่านั้น** ไม่ใช่ไฟล์อัปเกรด Production หรือสำรองข้อมูล
มี guard หยุดก่อนแก้ไขหากพบตารางแอปเดิม ไม่ลบตารางเดิมเพื่อให้รันต่อ

คง Functions, Triggers, RLS, Storage และ seed ตารางแพ็กเกจ/ข้อจำกัดที่จำเป็นต่อการทำงาน
จึงไม่ได้เป็น DDL ล้วน: INSERT ค่า config ที่จำเป็นยังอยู่ แต่ไม่มีข้อมูลทดสอบ/ลูกค้าเก่าหรือ backfill บัญชี/เครดิต/ledger
คำสั่ง UPDATE/DELETE ภายใน function เป็นพฤติกรรม runtime จึงคงไว้ ไม่ได้เรียกระหว่าง setup
admin-feature-bypass.sql เป็น migration เดิมของสิทธิ์ platform admin; feature-access/ai-paid-access ใช้ตามหลังเพื่อให้ได้สิทธิ์รุ่นล่าสุด
full-access.sql เป็นตัวเลือกชั่วคราวแยกต่างหาก ไม่เปิด Full Access หรือเปิดระบบส่งข้อความอัตโนมัติจากไฟล์รวมนี้

แก้ premium-overview.sql ให้อ่าน unread_count แบบ optional เช่นเดียวกับ dashboard-performance.sql
เพราะ schema ปัจจุบันไม่มีคอลัมน์ customers.unread_count; ฐานเก่าที่มีคอลัมน์ยังอ่านค่าเดิมได้ ฐานใหม่ใช้ 0

## ลำดับไฟล์ที่รวม (อ่านตามลำดับ ห้ามเรียงตัวอักษร)

### Core schema and initial tenant security

1. [schema.sql](schema.sql) — 18 statements retained
2. [tenants.sql](tenants.sql) — 4 statements retained
3. [comment-rules.sql](comment-rules.sql) — 8 statements retained
4. [platform.sql](platform.sql) — 28 statements retained
5. [schema_patch.sql](schema_patch.sql) — 4 statements retained
6. [orders.sql](orders.sql) — 11 statements retained
7. [automation.sql](automation.sql) — 44 statements retained
8. [billing.sql](billing.sql) — 25 statements retained
9. [security.sql](security.sql) — 77 statements retained

### Facebook, billing, bank accounts and feature security

10. [facebook-connect.sql](facebook-connect.sql) — 3 statements retained
11. [facebook-tenants.sql](facebook-tenants.sql) — 20 statements retained
12. [facebook-multi-admin.sql](facebook-multi-admin.sql) — 5 statements retained
13. [customer-profiles.sql](customer-profiles.sql) — 3 statements retained
14. [customer-gender.sql](customer-gender.sql) — 2 statements retained
15. [payments.sql](payments.sql) — 30 statements retained
16. [ai-agent-gate.sql](ai-agent-gate.sql) — 4 statements retained
17. [admin-feature-bypass.sql](admin-feature-bypass.sql) — 17 statements retained
18. [billing-slip-topups.sql](billing-slip-topups.sql) — 8 statements retained
19. [platform-dashboard.sql](platform-dashboard.sql) — 21 statements retained
20. [platform-admin-db-only.sql](platform-admin-db-only.sql) — 8 statements retained
21. [billing-auto-approval.sql](billing-auto-approval.sql) — 30 statements retained
22. [bank-accounts.sql](bank-accounts.sql) — 22 statements retained
23. [image-response-rules.sql](image-response-rules.sql) — 20 statements retained
24. [followup-plan-gate.sql](followup-plan-gate.sql) — 4 statements retained
25. [package-access.sql](package-access.sql) — 6 statements retained
26. [feature-access.sql](feature-access.sql) — 32 statements retained
27. [free-message-quota.sql](free-message-quota.sql) — 24 statements retained
28. [keyword-reply-limits.sql](keyword-reply-limits.sql) — 4 statements retained
29. [fallback-messages.sql](fallback-messages.sql) — 4 statements retained
30. [handover-messages.sql](handover-messages.sql) — 4 statements retained
31. [followup-message-defaults.sql](followup-message-defaults.sql) — 1 statements retained

### Inbox, automation and commerce functions/triggers

32. [smart-inbox.sql](smart-inbox.sql) — 41 statements retained
33. [smart-inbox-pro.sql](smart-inbox-pro.sql) — 31 statements retained
34. [smart-inbox-v2.sql](smart-inbox-v2.sql) — 13 statements retained
35. [inbox-follow-up-flags.sql](inbox-follow-up-flags.sql) — 9 statements retained
36. [inbox-quick-replies.sql](inbox-quick-replies.sql) — 12 statements retained
37. [inbox-actions.sql](inbox-actions.sql) — 3 statements retained
38. [automation-safety.sql](automation-safety.sql) — 14 statements retained
39. [smart-follow-ups.sql](smart-follow-ups.sql) — 78 statements retained
40. [agent-control.sql](agent-control.sql) — 40 statements retained
41. [agent-overview.sql](agent-overview.sql) — 3 statements retained
42. [ai-paid-access.sql](ai-paid-access.sql) — 15 statements retained
43. [ai-vision.sql](ai-vision.sql) — 35 statements retained
44. [commerce-v2.sql](commerce-v2.sql) — 45 statements retained
45. [product-sku-reuse.sql](product-sku-reuse.sql) — 0 statements retained
46. [payment-pro.sql](payment-pro.sql) — 35 statements retained
47. [payment-pro-dashboard.sql](payment-pro-dashboard.sql) — 4 statements retained
48. [slip-bank-controls.sql](slip-bank-controls.sql) — 19 statements retained
49. [bank-registry.sql](bank-registry.sql) — 7 statements retained
50. [bank-qr-upload.sql](bank-qr-upload.sql) — 11 statements retained
51. [bank-qr-per-account.sql](bank-qr-per-account.sql) — 5 statements retained
52. [bank-account-combined-save.sql](bank-account-combined-save.sql) — 8 statements retained
53. [payment-receiving-codes.sql](payment-receiving-codes.sql) — 13 statements retained
54. [qr-payment-designer.sql](qr-payment-designer.sql) — 11 statements retained
55. [store-rules.sql](store-rules.sql) — 7 statements retained
56. [store-rule-items.sql](store-rule-items.sql) — 4 statements retained
57. [store-rules-validation.sql](store-rules-validation.sql) — 11 statements retained

### Latest delivery safety, reporting and index patches

58. [facebook-webhook-queue.sql](facebook-webhook-queue.sql) — 30 statements retained
59. [facebook-webhook-nonblocking.sql](facebook-webhook-nonblocking.sql) — 2 statements retained
60. [facebook-message-window.sql](facebook-message-window.sql) — 10 statements retained
61. [broadcast-policy.sql](broadcast-policy.sql) — 21 statements retained
62. [broadcast-recipient-eligibility.sql](broadcast-recipient-eligibility.sql) — 3 statements retained
63. [broadcast-recipient-selection.sql](broadcast-recipient-selection.sql) — 5 statements retained
64. [broadcast-inbound-sync.sql](broadcast-inbound-sync.sql) — 5 statements retained
65. [inbox-messenger-window.sql](inbox-messenger-window.sql) — 17 statements retained
66. [smart-follow-up-presend.sql](smart-follow-up-presend.sql) — 14 statements retained
67. [manual-follow-ups.sql](manual-follow-ups.sql) — 6 statements retained
68. [follow-up-simplified.sql](follow-up-simplified.sql) — 7 statements retained
69. [follow-up-step-settings.sql](follow-up-step-settings.sql) — 3 statements retained
70. [follow-up-manual-dispatch-fix.sql](follow-up-manual-dispatch-fix.sql) — 8 statements retained
71. [follow-up-24h-window.sql](follow-up-24h-window.sql) — 20 statements retained
72. [follow-up-approval-mode.sql](follow-up-approval-mode.sql) — 10 statements retained
73. [dashboard-performance.sql](dashboard-performance.sql) — 21 statements retained
74. [dashboard-read-models.sql](dashboard-read-models.sql) — 10 statements retained
75. [premium-overview.sql](premium-overview.sql) — 6 statements retained
76. [inbox-realtime.sql](inbox-realtime.sql) — 1 statements retained
77. [inbox-load-indexes.sql](inbox-load-indexes.sql) — 9 statements retained
78. [facebook-inbox-recovery.sql](facebook-inbox-recovery.sql) — 10 statements retained
79. [live-cf-variants.sql](live-cf-variants.sql) — 22 statements retained
80. [live-cf-mode.sql](live-cf-mode.sql) — 18 statements retained
81. [live-cf-setup.sql](live-cf-setup.sql) — 21 statements retained
82. [messenger-product-lookup.sql](messenger-product-lookup.sql) — 3 statements retained
83. [slip-confirmation-template.sql](slip-confirmation-template.sql) — 8 statements retained
84. [standalone-slips.sql](standalone-slips.sql) — 21 statements retained
85. [tenant-ai-quota.sql](tenant-ai-quota.sql) — 28 statements retained
86. [vision-master-switch.sql](vision-master-switch.sql) — 6 statements retained
87. [live-cf-customer-variants.sql](live-cf-customer-variants.sql) — 16 statements retained
88. [live-auctions.sql](live-auctions.sql) — 28 statements retained
89. [customer-tabs.sql](customer-tabs.sql) — 40 statements retained
90. [auction-experience.sql](auction-experience.sql) — 5 statements retained
91. [live-session-dashboard.sql](live-session-dashboard.sql) — 31 statements retained
92. [shipping-fulfillment.sql](shipping-fulfillment.sql) — 35 statements retained
93. [shipping-integrations.sql](shipping-integrations.sql) — 18 statements retained
94. [live-order-types.sql](live-order-types.sql) — 7 statements retained
95. [live-auction-dashboard.sql](live-auction-dashboard.sql) — 14 statements retained
96. [live-auction-instant-winners.sql](live-auction-instant-winners.sql) — 1 statements retained
97. [live-auction-customer-workspace.sql](live-auction-customer-workspace.sql) — 12 statements retained
98. [live-auction-thai-workflow.sql](live-auction-thai-workflow.sql) — 9 statements retained
99. [live-auction-customer-columns.sql](live-auction-customer-columns.sql) — 3 statements retained
100. [live-auction-close-presets.sql](live-auction-close-presets.sql) — 6 statements retained
101. [live-auction-unlimited-keywords.sql](live-auction-unlimited-keywords.sql) — 1 statements retained
102. [live-auction-winner-confirmation.sql](live-auction-winner-confirmation.sql) — 11 statements retained
103. [live-auction-payment-auto-verify.sql](live-auction-payment-auto-verify.sql) — 3 statements retained
104. [facebook-webhook-comment-ordering.sql](facebook-webhook-comment-ordering.sql) — 3 statements retained
105. [live-auction-workspace.sql](live-auction-workspace.sql) — 8 statements retained
106. [live-auction-empty-keyword-defaults.sql](live-auction-empty-keyword-defaults.sql) — 6 statements retained
107. [live-auction-production-readiness.sql](live-auction-production-readiness.sql) — 22 statements retained
108. [live-auction-on-demand.sql](live-auction-on-demand.sql) — 29 statements retained
109. [live-auction-split-summary.sql](live-auction-split-summary.sql) — 3 statements retained
110. [shipping-integrations-beemove.sql](shipping-integrations-beemove.sql) — 12 statements retained
111. [vision-product-catalog.sql](vision-product-catalog.sql) — 2 statements retained
112. [live-customer-item-labels.sql](live-customer-item-labels.sql) — 2 statements retained
113. [live-cf-order-post.sql](live-cf-order-post.sql) — 2 statements retained
114. [live-auction-highest-confirmation.sql](live-auction-highest-confirmation.sql) — 5 statements retained
115. [live-auction-dynamic-tags.sql](live-auction-dynamic-tags.sql) — 9 statements retained
116. [facebook-comment-configuration.sql](facebook-comment-configuration.sql) — 25 statements retained
117. [facebook-message-echoes.sql](facebook-message-echoes.sql) — 9 statements retained
118. [inbox-realtime-access.sql](inbox-realtime-access.sql) — 13 statements retained
119. [live-auction-deadlines.sql](live-auction-deadlines.sql) — 24 statements retained
120. [live-auction-audit-hardening.sql](live-auction-audit-hardening.sql) — 14 statements retained
121. [live-auction-audit-hardening-2.sql](live-auction-audit-hardening-2.sql) — 11 statements retained
122. [live-auction-manual-host-close.sql](live-auction-manual-host-close.sql) — 4 statements retained
123. [live-auction-auto-cycle.sql](live-auction-auto-cycle.sql) — 14 statements retained
124. [live-auction-confirmation-preservation.sql](live-auction-confirmation-preservation.sql) — 4 statements retained
125. [rpc-execution-hardening.sql](rpc-execution-hardening.sql) — 290 statements retained
126. [inbox-owner-takeover.sql](inbox-owner-takeover.sql) — 10 statements retained

## ไฟล์ที่แยกออกทั้งหมด (ไม่ใช่ขั้นตอนติดตั้งใหม่)

| File | Reason |
| --- | --- |
| [live-auction-cron-setup.sql](live-auction-cron-setup.sql) | Optional hosted Supabase Cron extension setup; run after live-auction-deadlines.sql. |
| [backfill_patch.sql](backfill_patch.sql) | Historical customer/comment ownership backfill; not needed on an empty database. |
| [migrate-followup-variables.sql](migrate-followup-variables.sql) | Historical message/template rewrite and explicit exclusive lock; current defaults are included separately. |
| [safe_full_setup.sql](safe_full_setup.sql) | Alternative upgrade/backfill runner output; duplicates platform/schema patches. Not a fresh install. |
| [reset-facebook-tenants.sql](reset-facebook-tenants.sql) | Destructive operational reset: deletes tenants. |
| [test-grant-ai-pro-diw.sql](test-grant-ai-pro-diw.sql) | Shop-specific QA grant and fabricated test entitlement; never bootstrap data. |
| [agent-control-rollback.sql](agent-control-rollback.sql) | Operational rollback; disables features. |
| [payment-pro-rollback.sql](payment-pro-rollback.sql) | Operational rollback; disables payment Pro. |
| [full-access.sql](full-access.sql) | Optional temporary package bypass; apply separately only when deliberately requested. |
| [full-access-rollback.sql](full-access-rollback.sql) | Restores saved production function definitions; not a fresh install. |
| [full-access-check.sql](full-access-check.sql) | Read-only verification for the optional temporary bypass. |
| [dashboard-read-models-check.sql](dashboard-read-models-check.sql) | Read-only verification; run separately after setup. |
| [facebook-tenants-check.sql](facebook-tenants-check.sql) | Read-only verification; run separately after setup. |
| [inbox-actions-check.sql](inbox-actions-check.sql) | Read-only verification; run separately after setup. |
| [inbox-delivery-diagnostics.sql](inbox-delivery-diagnostics.sql) | Read-only operational diagnostics, not schema. |
| [inbox-request-diagnostics.sql](inbox-request-diagnostics.sql) | Read-only operational diagnostics, not schema. |
| [follow-up-worker-diagnostics.sql](follow-up-worker-diagnostics.sql) | Read-only runtime/scheduler diagnostics, not schema. |
| [realtime-cpu-diagnostics.sql](realtime-cpu-diagnostics.sql) | Read-only runtime performance diagnostics, not schema. |

## Dependencies ที่ตรวจอัตโนมัติ

| Migration | ต้องอยู่หลัง |
| --- | --- |
| live-auction-split-summary.sql | live-auction-on-demand.sql |
| live-auction-on-demand.sql | live-auction-production-readiness.sql |
| live-order-types.sql | live-session-dashboard.sql |
| live-auction-dashboard.sql | live-order-types.sql, shipping-fulfillment.sql |
| live-auction-instant-winners.sql | live-auction-dashboard.sql |
| live-auction-customer-workspace.sql | live-auction-instant-winners.sql |
| live-auction-thai-workflow.sql | live-auction-customer-workspace.sql |
| live-auction-customer-columns.sql | live-auction-thai-workflow.sql |
| live-auction-close-presets.sql | live-auction-customer-columns.sql |
| live-auction-empty-keyword-defaults.sql | live-auction-workspace.sql |
| live-auction-production-readiness.sql | live-auction-empty-keyword-defaults.sql, shipping-integrations.sql, live-session-dashboard.sql |
| live-auction-unlimited-keywords.sql | live-auction-close-presets.sql |
| live-auction-winner-confirmation.sql | live-auction-unlimited-keywords.sql |
| live-auction-payment-auto-verify.sql | live-auction-winner-confirmation.sql, customer-tabs.sql |
| facebook-webhook-comment-ordering.sql | facebook-webhook-queue.sql |
| live-auction-workspace.sql | live-auction-winner-confirmation.sql, facebook-webhook-comment-ordering.sql |
| shipping-fulfillment.sql | live-session-dashboard.sql |
| shipping-integrations.sql | shipping-fulfillment.sql |
| shipping-integrations-beemove.sql | shipping-integrations.sql |
| live-session-dashboard.sql | auction-experience.sql |
| auction-experience.sql | customer-tabs.sql |
| customer-tabs.sql | live-auctions.sql, live-cf-customer-variants.sql |
| live-auctions.sql | live-cf-customer-variants.sql, facebook-webhook-nonblocking.sql |
| live-cf-customer-variants.sql | live-cf-setup.sql, payments.sql, payment-pro.sql |
| schema.sql |  |
| tenants.sql | schema.sql |
| comment-rules.sql | schema.sql |
| platform.sql | tenants.sql, comment-rules.sql |
| schema_patch.sql | platform.sql |
| orders.sql | platform.sql |
| automation.sql | orders.sql |
| billing.sql | platform.sql |
| security.sql | schema.sql, tenants.sql, comment-rules.sql, platform.sql, orders.sql, automation.sql, billing.sql |
| facebook-connect.sql | security.sql |
| facebook-tenants.sql | facebook-connect.sql |
| facebook-multi-admin.sql | facebook-tenants.sql |
| customer-profiles.sql | security.sql |
| customer-gender.sql | customer-profiles.sql |
| payments.sql | security.sql, billing.sql |
| ai-agent-gate.sql | billing.sql, automation.sql |
| admin-feature-bypass.sql | security.sql, payments.sql, ai-agent-gate.sql |
| billing-slip-topups.sql | billing.sql, payments.sql, admin-feature-bypass.sql |
| platform-dashboard.sql | security.sql, billing-slip-topups.sql, admin-feature-bypass.sql |
| platform-admin-db-only.sql | platform-dashboard.sql |
| billing-auto-approval.sql | payments.sql, billing-slip-topups.sql |
| bank-accounts.sql | platform-dashboard.sql |
| image-response-rules.sql | security.sql, platform-dashboard.sql |
| followup-plan-gate.sql | automation.sql, billing.sql, security.sql, admin-feature-bypass.sql |
| package-access.sql | billing-auto-approval.sql, ai-agent-gate.sql |
| feature-access.sql | package-access.sql, admin-feature-bypass.sql |
| free-message-quota.sql | feature-access.sql |
| keyword-reply-limits.sql | automation.sql, billing.sql, security.sql |
| fallback-messages.sql | automation.sql |
| handover-messages.sql | automation.sql |
| followup-message-defaults.sql | automation.sql |
| smart-inbox.sql | free-message-quota.sql |
| smart-inbox-pro.sql | smart-inbox.sql |
| smart-inbox-v2.sql | smart-inbox-pro.sql |
| inbox-follow-up-flags.sql | smart-inbox-v2.sql |
| inbox-quick-replies.sql | smart-inbox.sql |
| inbox-actions.sql | smart-inbox-v2.sql |
| automation-safety.sql | inbox-actions.sql |
| smart-follow-ups.sql | smart-inbox.sql, free-message-quota.sql, automation.sql |
| agent-control.sql | automation-safety.sql |
| agent-overview.sql | agent-control.sql |
| ai-paid-access.sql | agent-control.sql, feature-access.sql |
| ai-vision.sql | ai-paid-access.sql |
| commerce-v2.sql | orders.sql, automation.sql, security.sql |
| product-sku-reuse.sql | commerce-v2.sql |
| payment-pro.sql | payments.sql, billing-auto-approval.sql, bank-accounts.sql, smart-follow-ups.sql |
| payment-pro-dashboard.sql | payment-pro.sql |
| slip-bank-controls.sql | bank-accounts.sql, security.sql, smart-inbox.sql, payment-pro.sql |
| bank-registry.sql | slip-bank-controls.sql |
| bank-qr-upload.sql | bank-accounts.sql, slip-bank-controls.sql, bank-registry.sql |
| bank-qr-per-account.sql | bank-qr-upload.sql |
| bank-account-combined-save.sql | bank-qr-per-account.sql |
| payment-receiving-codes.sql | bank-registry.sql |
| qr-payment-designer.sql | payment-receiving-codes.sql |
| store-rules.sql | automation.sql, agent-control.sql, ai-paid-access.sql |
| store-rule-items.sql | store-rules.sql |
| store-rules-validation.sql | store-rule-items.sql |
| facebook-webhook-queue.sql | security.sql, smart-inbox.sql |
| facebook-webhook-nonblocking.sql | facebook-webhook-queue.sql |
| facebook-message-window.sql | facebook-webhook-nonblocking.sql |
| broadcast-policy.sql | facebook-message-window.sql |
| broadcast-recipient-eligibility.sql | broadcast-policy.sql |
| broadcast-recipient-selection.sql | broadcast-recipient-eligibility.sql |
| broadcast-inbound-sync.sql | broadcast-policy.sql |
| inbox-messenger-window.sql | broadcast-policy.sql, inbox-actions.sql |
| smart-follow-up-presend.sql | smart-follow-ups.sql, broadcast-policy.sql |
| manual-follow-ups.sql | smart-follow-up-presend.sql |
| follow-up-simplified.sql | manual-follow-ups.sql |
| follow-up-step-settings.sql | follow-up-simplified.sql |
| follow-up-manual-dispatch-fix.sql | follow-up-simplified.sql, smart-follow-up-presend.sql, manual-follow-ups.sql |
| follow-up-24h-window.sql | follow-up-manual-dispatch-fix.sql, facebook-message-window.sql |
| follow-up-approval-mode.sql | follow-up-24h-window.sql, follow-up-step-settings.sql |
| dashboard-performance.sql | commerce-v2.sql |
| dashboard-read-models.sql | dashboard-performance.sql |
| premium-overview.sql | dashboard-read-models.sql |
| inbox-realtime.sql | schema.sql, security.sql |
| facebook-message-echoes.sql | facebook-message-window.sql, smart-inbox.sql |
| inbox-realtime-access.sql | facebook-message-echoes.sql, feature-access.sql |
| live-auction-deadlines.sql | facebook-comment-configuration.sql, live-auction-production-readiness.sql |
| live-auction-audit-hardening.sql | facebook-comment-configuration.sql, live-auction-on-demand.sql, live-auction-deadlines.sql |
| live-auction-audit-hardening-2.sql | live-auction-audit-hardening.sql, live-auction-deadlines.sql |
| live-auction-manual-host-close.sql | live-auction-audit-hardening-2.sql, live-auction-deadlines.sql |
| live-auction-auto-cycle.sql | live-auction-manual-host-close.sql, facebook-comment-configuration.sql |
| live-auction-confirmation-preservation.sql | live-auction-auto-cycle.sql |
| rpc-execution-hardening.sql | live-auction-confirmation-preservation.sql |
| inbox-owner-takeover.sql | rpc-execution-hardening.sql, inbox-actions.sql, automation-safety.sql, inbox-messenger-window.sql |
| inbox-load-indexes.sql | inbox-realtime.sql |
| facebook-inbox-recovery.sql | facebook-webhook-queue.sql, smart-inbox.sql |
| live-cf-variants.sql | commerce-v2.sql, facebook-webhook-queue.sql |
| live-cf-mode.sql | live-cf-variants.sql, comment-rules.sql |
| live-cf-setup.sql | live-cf-mode.sql, bank-accounts.sql, facebook-webhook-queue.sql |
| messenger-product-lookup.sql | commerce-v2.sql, live-cf-variants.sql |
| slip-confirmation-template.sql | platform-dashboard.sql |
| standalone-slips.sql | security.sql, payments.sql, billing-auto-approval.sql, bank-accounts.sql, facebook-webhook-queue.sql |
| tenant-ai-quota.sql | smart-inbox.sql, agent-control.sql |
| vision-master-switch.sql | ai-vision.sql, tenant-ai-quota.sql |
| vision-product-catalog.sql | vision-master-switch.sql, commerce-v2.sql |
| live-customer-item-labels.sql | live-auction-on-demand.sql, live-order-types.sql |
| live-cf-order-post.sql | live-cf-customer-variants.sql, live-session-dashboard.sql |
| live-auction-highest-confirmation.sql | live-auction-on-demand.sql, live-auction-winner-confirmation.sql |
| live-auction-dynamic-tags.sql | live-auction-highest-confirmation.sql |
| facebook-comment-configuration.sql | live-auction-dynamic-tags.sql, live-cf-order-post.sql |

## ท่อนที่ตัดจากไฟล์ bootstrap เดิม

ตารางนี้อธิบาย full_database_setup.sql เท่านั้น; complete_schema.sql คง integrity scans และ backfills ของ proof ledger และ null quota repair เพิ่มเติมตาม scripts/lib/complete-schema.cjs

เลข statement นับจาก SQL parser (ไม่นับ comment; DO/function body นับเป็นหนึ่ง statement)
BEGIN/COMMIT และ lock_timeout ของต้นฉบับถูกแทนด้วย transaction รายไฟล์และ SET LOCAL lock_timeout='2s'

| Source | Statement | Omission |
| --- | --- | --- |
| payments.sql | 7: `lock table public.slips, public.payment_receipts in share row exclusive mode…` | Explicit table lock for historical migration removed (fresh database only). |
| payments.sql | 8: `insert into public.payment_transfer_ledger (trans_ref, source, source_id) select…` | Historical business-data/settings/ledger backfill removed. |
| payments.sql | 9: `insert into public.payment_transfer_ledger (trans_ref, source, source_id) select…` | Historical business-data/settings/ledger backfill removed. |
| payments.sql | 10: `do $$ begin if exists ( select 1 from public.slips s left join public.paym…` | Historical ledger conflict scan removed; permanent runtime proof guards retained. |
| billing-auto-approval.sql | 14: `lock table public.payment_receipts in share row exclusive mode…` | Explicit table lock for historical migration removed (fresh database only). |
| billing-auto-approval.sql | 15: `insert into public.payment_image_ledger(image_sha256,source,source_id) select …` | Historical business-data/settings/ledger backfill removed. |
| billing-auto-approval.sql | 16: `do $$ begin if exists(select 1 from public.payment_receipts r join public.paym…` | Historical image-ledger conflict scan removed; permanent runtime proof guards retained. |
| bank-accounts.sql | 17: `insert into public.bank_accounts(tenant_id,bank_code,account_name,account_number…` | Historical business-data/settings/ledger backfill removed. |
| bank-accounts.sql | 18: `update public.tenants set bank_accounts_migrated=true where not bank_accounts_mi…` | Historical business-data backfill/repair removed. |
| free-message-quota.sql | 4: `update public.tenants set broadcast_credits=case when broadcast_period<>to_char(…` | Historical business-data backfill/repair removed. |
| fallback-messages.sql | 6: `do $$ declare gate_enabled boolean; begin select exists(select 1 from pg_trigg…` | Legacy text backfill and temporary trigger disable removed. |
| handover-messages.sql | 6: `do $$ declare gate_enabled boolean; begin select exists(select 1 from pg_trigg…` | Legacy text backfill and temporary trigger disable removed. |
| smart-inbox.sql | 13: `with numbered as(select id,row_number() over(partition by customer_id order by c…` | Historical business-data backfill/repair removed. |
| smart-inbox.sql | 14: `update public.customers c set inbound_seq=greatest(c.inbound_seq,coalesce((selec…` | Historical business-data backfill/repair removed. |
| smart-inbox-pro.sql | 6: `update public.customers set inbox_stage=case when conversation_status='closed' t…` | Historical business-data backfill/repair removed. |
| smart-follow-ups.sql | 6: `update public.orders o set confirmed_at=o.created_at where o.confirmed_at is nul…` | Historical business-data backfill/repair removed. |
| smart-follow-ups.sql | 40: `insert into public.follow_up_policies(tenant_id,enabled) select t.id,coalesce(s.…` | Historical business-data/settings/ledger backfill removed. |
| smart-follow-ups.sql | 41: `insert into public.follow_up_workflows(tenant_id,kind,enabled,steps) select t.i…` | Historical business-data/settings/ledger backfill removed. |
| smart-follow-ups.sql | 42: `insert into public.follow_up_workflows(tenant_id,kind,steps) select id,'interes…` | Historical business-data/settings/ledger backfill removed. |
| smart-follow-ups.sql | 43: `insert into public.follow_up_workflows(tenant_id,kind,steps) select id,'after_s…` | Historical business-data/settings/ledger backfill removed. |
| smart-follow-ups.sql | 44: `update public.follow_up_jobs j set workflow_id=w.id,workflow_version=w.version,s…` | Historical business-data backfill/repair removed. |
| smart-follow-ups.sql | 45: `update public.follow_up_jobs set status='pending' where status='scheduled'…` | Historical business-data backfill/repair removed. |
| agent-control.sql | 20: `insert into public.agent_prompt_versions(tenant_id,version,instructions) select …` | Historical business-data/settings/ledger backfill removed. |
| ai-paid-access.sql | 13: `insert into public.agent_control_settings(tenant_id) select id from public.tenan…` | Historical business-data/settings/ledger backfill removed. |
| product-sku-reuse.sql | 2: `lock table public.products in share row exclusive mode…` | Explicit table lock for historical migration removed (fresh database only). |
| product-sku-reuse.sql | 3: `drop index if exists public.products_tenant_code…` | Final partial SKU index is already defined by commerce-v2.sql; avoid drop/rebuild/lock. |
| product-sku-reuse.sql | 4: `create unique index products_tenant_code on public.products (tenant_id,lower(cod…` | Final partial SKU index is already defined by commerce-v2.sql; avoid drop/rebuild/lock. |
| product-sku-reuse.sql | 6: `select indexname,indexdef from pg_indexes where schemaname='public' and tablenam…` | Final partial SKU index is already defined by commerce-v2.sql; avoid drop/rebuild/lock. |
| slip-bank-controls.sql | 3: `update public.bank_accounts b set is_primary=true where b.id in(select distinct …` | Historical business-data backfill/repair removed. |
| broadcast-inbound-sync.sql | 7: `insert into public.broadcast_messaging_events(tenant_id,customer_id,event_id,pag…` | Historical business-data/settings/ledger backfill removed. |
| smart-follow-up-presend.sql | 7: `update public.follow_up_workflows w set enabled=p.enabled,version=w.version+1 fr…` | Historical business-data backfill/repair removed. |
| follow-up-24h-window.sql | 10: `update public.customers c set last_interaction_at=(select max(e.interacted_at) …` | Historical business-data backfill/repair removed. |
| facebook-inbox-recovery.sql | 6: `update public.customers set display_name='ลูกค้า Facebook (' // right(platform_u…` | Historical business-data backfill/repair removed. |
| standalone-slips.sql | 17: `lock table public.standalone_slips in share row exclusive mode…` | Explicit table lock for historical migration removed (fresh database only). |
| standalone-slips.sql | 18: `insert into public.payment_transfer_ledger(trans_ref,source,source_id) select …` | Historical business-data/settings/ledger backfill removed. |
| tenant-ai-quota.sql | 6: `update public.tenants set ai_quota_limit=coalesce(ai_quota_limit,1000),ai_quota_…` | Historical business-data backfill/repair removed. |
| live-auctions.sql | 22: `update public.facebook_webhook_events set ordering_key='comments:'//page_id whe…` | Historical business-data backfill/repair removed. |
| live-session-dashboard.sql | 14: `insert into public.live_sessions(tenant_id,page_id,live_post_id,created_at) sel…` | Historical business-data/settings/ledger backfill removed. |
| live-session-dashboard.sql | 19: `update public.customer_tab_items i set auction_id=a.id,winning_bid_id=b.id from …` | Historical business-data backfill/repair removed. |
| live-order-types.sql | 7: `update public.customer_tab_items i set order_type=o.order_type,source_code=o.sou…` | Historical business-data backfill/repair removed. |
| live-auction-instant-winners.sql | 2: `update public.live_sessions set auction_settings=jsonb_set(auction_settings,'{pr…` | Historical business-data backfill/repair removed. |
| live-auction-instant-winners.sql | 3: `update public.auctions a set session_automation=s.auction_settings,private_reply…` | Historical business-data backfill/repair removed. |
| live-auction-thai-workflow.sql | 3: `update public.live_sessions set auction_settings=public.normalize_auction_thai_s…` | Historical business-data backfill/repair removed. |
| live-auction-thai-workflow.sql | 4: `update public.auctions set session_automation=public.normalize_auction_thai_sett…` | Historical business-data backfill/repair removed. |
| live-auction-close-presets.sql | 5: `update public.live_sessions set auction_settings=public.normalize_auction_thai_s…` | Historical business-data backfill/repair removed. |
| live-auction-close-presets.sql | 6: `update public.auctions set session_automation=public.normalize_auction_thai_sett…` | Historical business-data backfill/repair removed. |
| live-auction-winner-confirmation.sql | 10: `update public.auction_deliveries d set status='awaiting_confirmation' from publ…` | Historical business-data backfill/repair removed. |
| live-auction-empty-keyword-defaults.sql | 6: `update public.live_sessions set auction_settings=jsonb_set( jsonb_set(auction…` | Historical business-data backfill/repair removed. |
| live-auction-empty-keyword-defaults.sql | 7: `update public.auctions set session_automation=jsonb_set( jsonb_set(session_au…` | Historical business-data backfill/repair removed. |
| live-auction-production-readiness.sql | 8: `update public.auction_deliveries d set status='pending',comment_id=a.leading_com…` | Historical business-data backfill/repair removed. |
| live-auction-on-demand.sql | 29: `update public.live_sessions set auction_settings=auction_settings//jsonb_build_o…` | Historical business-data backfill/repair removed. |
| live-auction-on-demand.sql | 30: `update public.auctions set session_automation=session_automation//jsonb_build_ob…` | Historical business-data backfill/repair removed. |
| live-auction-on-demand.sql | 31: `insert into public.auction_winner_claims(tenant_id,auction_id,customer_id,bidder…` | Historical business-data/settings/ledger backfill removed. |
| live-auction-on-demand.sql | 32: `update public.orders o set live_auction_id=c.auction_id from public.auction_winn…` | Historical business-data backfill/repair removed. |
| live-auction-on-demand.sql | 33: `update public.auction_deliveries d set status='superseded' from public.auctions …` | Historical business-data backfill/repair removed. |
| live-auction-split-summary.sql | 5: `update public.live_sessions set auction_settings=auction_settings//jsonb_build_o…` | Historical business-data backfill/repair removed. |
| live-auction-split-summary.sql | 6: `update public.auctions set session_automation=session_automation//jsonb_build_ob…` | Historical business-data backfill/repair removed. |

## วิธีใช้ไฟล์ bootstrap เดิม

สำหรับ complete_schema.sql ให้ใช้ [คู่มือหลัก](MIGRATIONS.md) ด้านล่างนี้เฉพาะ full_database_setup.sql เท่านั้น

1. สร้าง Supabase project ใหม่; ตรวจว่า auth/storage และ publication supabase_realtime มีอยู่แล้ว
2. เปิด full_database_setup.sql **ทั้งไฟล์** ใน SQL Editor และรันด้วย postgres ก่อนเชื่อม Dashboard/Webhook
3. หรือใช้ psql -X -v ON_ERROR_STOP=1 -f supabase/full_database_setup.sql โดยรับ connection string ผ่าน environment ตามเครื่องมือของคุณ ห้ามใช้ --single-transaction/-1
4. แต่ละ source มี transaction แยกและ lock_timeout 2s ไม่มี BEGIN/COMMIT ครอบทั้งไฟล์
5. หาก fail ระหว่าง setup ให้ตรวจ section/statement ที่ล้มเหลวก่อน อย่าลบ guard หรือรันซ้ำทับฐานข้อมูลที่เริ่มมีข้อมูล
6. รันไฟล์ *-check.sql ที่เกี่ยวข้องแยกได้หลัง setup; diagnostics/rollback/reset ไม่ใช่ migration ต่อท้าย
7. ตั้งค่า user, tenant, membership, bank/Page credentials และเปิด automation ตามต้องการแยกภายหลัง

DDL และ CREATE INDEX ยังต้องล็อกตาม PostgreSQL จึงไม่รับประกันว่า deadlock จะเป็นไปไม่ได้
สำหรับฐานข้อมูลที่ใช้งานแล้วให้ใช้ migration เฉพาะเรื่องหรือ scripts/run-safe-db-migration.cjs แทน
อ้างอิง: [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/16/sql-createindex.html)

สร้างใหม่: node scripts/build-full-database-setup.cjs
ตรวจสอบโดยไม่เขียน: node scripts/build-full-database-setup.cjs --check
ทดสอบ isolated database ทั้งสองรูปแบบ: npm run test:schema

## Source hashes

- schema.sql: `6e212f1732cf6b5fe4e1b7d5f4e1d56c6cdcc7f6ccc950e71bc0446fd12454bc`
- tenants.sql: `a21e1e3b29b2c68df7fcd1d388ec93aeab63f22140a3cb4546dc50195e23b0e7`
- comment-rules.sql: `f694088e9cbb3a8249df863d4d73715d56a9b427c61f832ad69b859f82740aa8`
- platform.sql: `4c2c2632ae8de14a33ff67902756d6abac54df6718bb892b2affddbb2d70f8d3`
- schema_patch.sql: `85060b3c689c124f0b44a262f39519e4c70b9f9b82500cd3450a2e70ffb46c29`
- orders.sql: `b8d76d6e4dbb3539beb41a4eb89dab77e49b3bf3c111b3c3e30832151a0c6964`
- automation.sql: `665ac41c61ec4bf4320da06f06112304abec0cb72d5174d732bdc99863fdca8e`
- billing.sql: `29ce43034a42142b202f01c31dab5e0ccb598aa8aac0ebcd115e32238df75fb6`
- security.sql: `ec1491b21dc305b4531e12ddb0a92ecdd38ead50b22408e211a7d9aa5326fe8c`
- facebook-connect.sql: `bb849ab652fa428cdd6afd02599e666856bf8ede3ee122269988c9cf10433feb`
- facebook-tenants.sql: `6d97183c5a95c2341b0795c7c185615a25d68f4127c02db9836e62b9a599c9f0`
- facebook-multi-admin.sql: `9dffbc3d72cea2d237cbfc85dba2869abab1ab147f1766a8ce33b6fff5e8b644`
- customer-profiles.sql: `5f997557ed4cca29fece1b20d74c0abd48e3a13df57f3489fe17204165c0b4fa`
- customer-gender.sql: `4c43982b49d3f2b104be17c39077de05a56ffd69724e17ded105a755d2cea757`
- payments.sql: `beed8aa96a89ed77807a78f3c4ccc78a47f8bfaa5c19c585cf6d8552fa7a8fb8`
- ai-agent-gate.sql: `98a7375726bbe02bb525cf6db18f3acf81860ae1e6da1304345c1395265a5387`
- admin-feature-bypass.sql: `505b9b486b51a29042e87df33caec70510921bad9f9b9a58fa3f4cc7eaee9c94`
- billing-slip-topups.sql: `eec994d75fd515114f9425e463de7983a59a66c13b04ec742f958fb821f2da27`
- platform-dashboard.sql: `115e3a8815ed8c6dfb15d25ccce5f4568e89fdcdc28dccedc3fde06364dd01ce`
- platform-admin-db-only.sql: `560dbeeb0cab3c2302461257f01e139c0826b1d4f693d8a9def7801d9b529236`
- billing-auto-approval.sql: `a4ca6ff4e6b74ae24d0a8dd45b66bcd3805e880cff8c9c389de9929dc6d78181`
- bank-accounts.sql: `9c383587c7273304231ed76384c0222584dd69c03088a3ce5ac29f8bfcdbf540`
- image-response-rules.sql: `6ac37623854295af127243c2f8d21167f01de236a6c9eeeb6d8cf751347a93fe`
- followup-plan-gate.sql: `8722938e430e15924bae4bb6bb40330ff247996564aa94ba803b01b59296f96f`
- package-access.sql: `31174caa94e6407b3cf95e13f96ca1264d826309acc529310a5df06f75bcf16b`
- feature-access.sql: `dc491c46c80669e9f8f62230d1d822fb0c67d9605e2dc2fc22154f4616444ff7`
- free-message-quota.sql: `6c43832ecc28fe37a753487ea001174d0c724f028f45249f3275893f0b6e99a5`
- keyword-reply-limits.sql: `331db8ee61d4e12356f6f883c08403717d136abaa29190bfa71940aa693d9c34`
- fallback-messages.sql: `b3a22811de461dac12dca9e85b8f5fd9ed5f5e0130547607eaced5c2ed1ba28b`
- handover-messages.sql: `47c4af183d56f18eb06929dab7daacf713eb30f77d4b080deb0fe9c9fd99742e`
- followup-message-defaults.sql: `1615ee171cacdcd867738276d1f676168275c34067e7067495851c9a34964562`
- smart-inbox.sql: `2ccfb610d36a3a3acce7138038b3197b8e1203128daa627780d82bc5722ad505`
- smart-inbox-pro.sql: `e5aeb9d94cce891b6ddcfbac736c4db5985f98146a5f582bc4551b5dbaccba6f`
- smart-inbox-v2.sql: `c554817c3a8c16bd2dc68d725938bc9aef2bba2b63bc8762618157a19584521e`
- inbox-follow-up-flags.sql: `bdf113d9341ecb5c831a278c0624b0c04ce95ac2aee3a8b0509078099358365d`
- inbox-quick-replies.sql: `832f7002fc6a45f2a5054583c19e03942ecb451423afa4b3d168510206f0e6eb`
- inbox-actions.sql: `e5f91c58531dd16ff25556e42e3223c0781abe615846f407773143e4d5dd5590`
- automation-safety.sql: `86b4d84d2db794a379520b40c3ff268143107c2a12501c72c90b32445a668096`
- smart-follow-ups.sql: `1a1337af816ff8cb005eb12a2753e1595f0857de717cfe955736cf0769898db1`
- agent-control.sql: `462a262220a863bbc2ceae0a130173530d9de25285a66423eff8aeb67a436cf2`
- agent-overview.sql: `bbd87d3b0f164c778eb52983b7862d8d8cd61dfd1bf029bc68be6af164bac819`
- ai-paid-access.sql: `42f6eb4cf373dca787fecb745fb5089f19c610c519768fc6c63e2994dc88ade2`
- ai-vision.sql: `ea63d4c520548a1f13923b62491f7eff31ac55ebef4e1f51e63ae64ee7309301`
- commerce-v2.sql: `43b4aa77038376bec249d3dfd1c9c53c08fa2094ba24fe40b35afcbcfc94f9f7`
- product-sku-reuse.sql: `158567cbd1962b8e6c75c72a9f5aaa52aceb26c84b9fc2c7bb4a7f24c41c41f4`
- payment-pro.sql: `aa6343641fb6d1c026a0913c81d79d990c295c23e9de63e41bfd42d3cdb7e148`
- payment-pro-dashboard.sql: `8d4e52e0d834ca8ce7cab97c2b78209535263726b7c5d1796ba4398b7ae54b7b`
- slip-bank-controls.sql: `08d19ff46fa0d05b9a42f710ea11f212756e4a95fea9440d221bce1b808f98e3`
- bank-registry.sql: `9552aa3856ddf0c584f98f7ac722bc877e9a1a89617d0dd0c2dd5a1d7914b4d0`
- bank-qr-upload.sql: `6f115a66a303c4cdffce869df158f47c6090542411f674fdede0c28f9c6f539c`
- bank-qr-per-account.sql: `32f1910876783a4661555a71c8144e1923d9548611ef0cbd5c6927681aecee27`
- bank-account-combined-save.sql: `ba5776e10e9d121d7d374238c8031330a1ac43c18ccfe055a2dafc1551bc1128`
- payment-receiving-codes.sql: `69d202f61858dbf27aaffa6a93e201b0fe43cb15e22fc579fbe82d1bca342826`
- qr-payment-designer.sql: `791010165b6065afb641c311106260bb7f574a3624530ee8d9df966d2bee8cd3`
- store-rules.sql: `ea6f24e091470f5d88369563d5f012c9500370aaa7536d84d3bf33c986daaee9`
- store-rule-items.sql: `7f10a22e7c4ad118a193af3e28a5105070e4eeff33b9fee5d95d836fc9664a41`
- store-rules-validation.sql: `f8cbdf12cd3851025951edbf50d831548032211d73e43f12b011c1aa51df4883`
- facebook-webhook-queue.sql: `7e67011b3489c011639ea3f4f800fa6ac4825670f76f04fca4e0f7fddb3c641e`
- facebook-webhook-nonblocking.sql: `0cfe5319ef9b061c353b80a57463e06e1a97ff1424be84ecefb4a7ecb10baf4d`
- facebook-message-window.sql: `d2581ef71797895f11e05f0dfc74302cd202b9c278c9ecbb4c2968418baa9d5e`
- broadcast-policy.sql: `a45cf7c24ef5f6d31ef31868029bd3e9216370bc5c582b911b80a4ed74071233`
- broadcast-recipient-eligibility.sql: `6ea5e1f9044db876fc8d0f07d8da52668f9897fa684851092eab347710e4a74c`
- broadcast-recipient-selection.sql: `bdd1581c239a6ebc20048d32d342e6697d98ada245dd01260feacde8fe44278f`
- broadcast-inbound-sync.sql: `074351e109ac3b2191bc1eece9356c5ea28a58cb5b165a078e63413ad876beba`
- inbox-messenger-window.sql: `4ebe59d252e016e5d62eb28617e9a08d27847550f925f0273d18cc456c43e77e`
- smart-follow-up-presend.sql: `978fd4adf4cb9e1f16c8a1f21783ab4c7c43dedb66d7c11c7df20fe6ad36f9e4`
- manual-follow-ups.sql: `34d34f06c0a32579c6dc4a80583c4c15040b1919b8f2bd7e6638848adb06e165`
- follow-up-simplified.sql: `c1463162272b2eb3b5248a42dd663baf9bc2371c23f300c70916df0921f4b86b`
- follow-up-step-settings.sql: `96bedcb1959a8d864b018de761fb35e8d989b42450060ca784c2f7143af13a0e`
- follow-up-manual-dispatch-fix.sql: `c05b6fe3c8261f43a521871557de3f2436712570afbbfd6d536340e403de1bc5`
- follow-up-24h-window.sql: `18871aeb28c2b8fd9fac9a16588904281380c733721168135fa49d3733eaaacd`
- follow-up-approval-mode.sql: `53f81f07be504e99d4afbe8fab1f25c6f859f218470b280ceea2dc44760f74a4`
- dashboard-performance.sql: `87871cb3623b3153a08fd585394dda0fbd296c4fb670e50791ee09527b2c29c5`
- dashboard-read-models.sql: `daca680061c44493d8ec6c139716a5a7e58aca1c20cddab9231ce59f94cf72cf`
- premium-overview.sql: `19d97393eda4ebd1de925886ce3add41af56164a2541e8e4e0b6f377f861f273`
- inbox-realtime.sql: `a7dc1d4c93f7995e27731bd59a078c4430650c0b627c9f4c14a80c5357d607f7`
- inbox-load-indexes.sql: `cee506871122e657bfbf6b2a12533272fee5b44607176d4c29298b0aaf404e42`
- facebook-inbox-recovery.sql: `1eb9f1832583ddae48cd6adda766c7c3828e48d5c9401f2b0b96442977e6a1ad`
- live-cf-variants.sql: `76d033c8d7df54314df3ec983143fa1194d4fbf29c3f261507c29fedbdec00f1`
- live-cf-mode.sql: `91f67f49d0e22fcdba1f1a77d9fb169c5a66b14ac83d53eb8e001f6580cd966c`
- live-cf-setup.sql: `05dfcefd0d101569a99dd462230fc8fd87ce2a43476027432e201410644b4ad0`
- messenger-product-lookup.sql: `d7dc47ee4ae0c13a90593a213044a0f6dd4f99075e09726bfab58b1ccb9140c0`
- slip-confirmation-template.sql: `591e7c6185b3c102ecc0e7045ffaeb6f0b3b7bf4b7fd1f0e19247995b1b8778f`
- standalone-slips.sql: `96608fd194cf79cae1e2972b7bb8e8e93dc199b75029eb8305dc2576f9a2227b`
- tenant-ai-quota.sql: `a26fd232c74124152b04a4d9b73ee77ceac9f1f36fd62a6eea75becf363638f3`
- vision-master-switch.sql: `137f222b26061e467b6444853806fb3c4d2ea5c74674ac6a986b7fc7a65883b6`
- live-cf-customer-variants.sql: `c620b8852bf6067a70bc0cb265a285e3d9fddd0d05d55e9ed5a8a6c72fa6df29`
- live-auctions.sql: `910202f12dfb75ce136dc66fe2d95ea645f9de96b03a69ef8e1b92b0fa89eeec`
- customer-tabs.sql: `16b91f3b78245a76dacaa59840e6b4fa966193e938a71d36d56489c3a2e2e48a`
- auction-experience.sql: `d63ebe3b3f87fa9678fdc0f92762b65f9a652a0fb15c4e36f06cd0cbe1b318f8`
- live-session-dashboard.sql: `6df53de0151779b4c1d95751c69cf5beb517456d59721411bd8e24e6d9455b2c`
- shipping-fulfillment.sql: `abc1f380707a3baf1bb18df305b7e06f1be6dbaf3e7eb148a8e20ecfcac486fe`
- shipping-integrations.sql: `fc4b9961c01fe943eb8eb78e6978b4cf9c9f3d0d7ccbe33cb1257b0801c268ec`
- live-order-types.sql: `eb6171db344172c6b92c8fe04ee96f2a71afb4d15c1af599f59dab0c57a54d01`
- live-auction-dashboard.sql: `7b17bf54411dc1c84510ecf2a204c12dafe82c56d28b960be0061e4898bb679e`
- live-auction-instant-winners.sql: `d0788ad3f0cd0a402db298a6fedcdc6c1620e2f2e35a15f580f8153e081e7f65`
- live-auction-customer-workspace.sql: `dff1722d7bd0ef6404ac4d3c9e32a516d137f13a8dac3ce8cd3c9d5ea5fd5d34`
- live-auction-thai-workflow.sql: `23e73cd12f7536b5bb63f80528c2f451d9d9f27b5a839be358aaac8588f6ad59`
- live-auction-customer-columns.sql: `a0e96f4c674e920d1974403d19e64ed225e8b2cf2c9a3a625473e8b2767a8bc9`
- live-auction-close-presets.sql: `e40d3d01a50c6c99c399043f94540a4368ccfdbe43a206d814338ae7666c5db3`
- live-auction-unlimited-keywords.sql: `ba2dee345322ca688b2976bec107f1d64b5c94ed725e9c450d7599666b6488c3`
- live-auction-winner-confirmation.sql: `47e7d6763ce50cd5feb959f2282c7b8341dac01a33df6d6b7c007cca4186b259`
- live-auction-payment-auto-verify.sql: `34850c09fb21356f5d4e18b797f569f90a0d7ce05f08755d4c3b90a48689096a`
- facebook-webhook-comment-ordering.sql: `fc95a23e41f2d2fb46548cdc4ac306538dca0ae681433328fe555f184e6d4787`
- live-auction-workspace.sql: `9b31439a5bce859ea20bb1bbc7790571d7b4c24f604af5940b8486351e425cc9`
- live-auction-empty-keyword-defaults.sql: `576e5cfcc37ca82ba6c914e2d813424e6e6e55c7d0f9a9bbde3653cba7d12845`
- live-auction-production-readiness.sql: `0f984ce2bc41b09e47c5c98359f745afefdb911b76e5a979d86731a84815844b`
- live-auction-on-demand.sql: `a091f91d7daa0e19c1db6caeff82ae104ae90a6cd27b0a655b54e8b07a76fa49`
- live-auction-split-summary.sql: `ecebe98f42520036601611179211f30028fd29fd11616b6de93711a51e119ebf`
- shipping-integrations-beemove.sql: `d9d57a631be5139cd85320e430030d3791dba88caac9d83602c939bd810a409a`
- vision-product-catalog.sql: `9038c3bcb370a127f8730eddaeb01c80d555cb10a365a5f109c937bb778fc56a`
- live-customer-item-labels.sql: `6bf306b3aa7d95fada014ba58ebb017ed8fa05de68f409c396692bfa92b1d9de`
- live-cf-order-post.sql: `0cc8add5f89d61723bafe7fbd8cf4d53486e74459bfdd331131d9c4929c82605`
- live-auction-highest-confirmation.sql: `84447330d4b8d575a6437144bea213d14437c28219d5b2923aca8a5e1ca818f1`
- live-auction-dynamic-tags.sql: `519739b3173ff89175f57388066e5b73bf2317b8486cfa1e45ff7d3524a935bd`
- facebook-comment-configuration.sql: `5bdf7e2cc6cc0f43375e2a9753fd7b02f1a122bf35aaea95871324b9e45ace80`
- facebook-message-echoes.sql: `b5d834556f05a2e0a49ae363a7625dd26e46dd5967dbd6429c4184fd7c8ffed2`
- inbox-realtime-access.sql: `f2c1e283a073b6967c64b37378a09ec179baedca837587b19efc0163a780ab65`
- live-auction-deadlines.sql: `ff20250c88520e5d08cf02ae057320554e181632961dc97dcb954829cd2894db`
- live-auction-audit-hardening.sql: `2c79207b85e47143cfe1a8937e1d331ad24d4143c055614833004a2eb8f1ad83`
- live-auction-audit-hardening-2.sql: `046dce6e9d74974576eed08ac0f8dfc17d38ad7a6843cef2c52f04d7523c68e6`
- live-auction-manual-host-close.sql: `2879f51b07f66874093cee682e45957d4901b6a90e5ef895c29c41f4e56eea02`
- live-auction-auto-cycle.sql: `036cad8f7d4f5cc0cbdc26e975afcdff91342cd1e136a3d3fcd99e33133d6d9e`
- live-auction-confirmation-preservation.sql: `f3dcfa9d671d189053c4ee2bab89bdc9c6234ac06da067d22fa05a41a5100084`
- rpc-execution-hardening.sql: `68366ac0d0d7e6ec51dc11df0520987834b243868b4d0839625a0fe538b0c983`
- inbox-owner-takeover.sql: `464942265ac9f1c304c4ab35922d800f3665dfd6d3ef75ee7c72eabb4b37c66f`
