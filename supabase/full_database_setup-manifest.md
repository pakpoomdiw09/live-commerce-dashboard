# Fresh Supabase database setup inventory

พบ SQL ต้นฉบับ 88 ไฟล์: รวมตาม dependencies 71 ไฟล์ และแยกไว้ 17 ไฟล์
หลังสร้างไฟล์รวมจะมี SQL ทั้งหมด 89 ไฟล์ รวม full_database_setup.sql ด้วย

ไฟล์เต็ม: [full_database_setup.sql](full_database_setup.sql) (495482 bytes, 8264 lines)
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
50. [payment-receiving-codes.sql](payment-receiving-codes.sql) — 13 statements retained
51. [qr-payment-designer.sql](qr-payment-designer.sql) — 11 statements retained
52. [store-rules.sql](store-rules.sql) — 7 statements retained
53. [store-rule-items.sql](store-rule-items.sql) — 4 statements retained
54. [store-rules-validation.sql](store-rules-validation.sql) — 11 statements retained

### Latest delivery safety, reporting and index patches

55. [facebook-webhook-queue.sql](facebook-webhook-queue.sql) — 29 statements retained
56. [facebook-webhook-nonblocking.sql](facebook-webhook-nonblocking.sql) — 2 statements retained
57. [facebook-message-window.sql](facebook-message-window.sql) — 9 statements retained
58. [broadcast-policy.sql](broadcast-policy.sql) — 21 statements retained
59. [broadcast-recipient-eligibility.sql](broadcast-recipient-eligibility.sql) — 3 statements retained
60. [broadcast-recipient-selection.sql](broadcast-recipient-selection.sql) — 5 statements retained
61. [broadcast-inbound-sync.sql](broadcast-inbound-sync.sql) — 5 statements retained
62. [inbox-messenger-window.sql](inbox-messenger-window.sql) — 17 statements retained
63. [smart-follow-up-presend.sql](smart-follow-up-presend.sql) — 14 statements retained
64. [manual-follow-ups.sql](manual-follow-ups.sql) — 6 statements retained
65. [follow-up-simplified.sql](follow-up-simplified.sql) — 7 statements retained
66. [follow-up-step-settings.sql](follow-up-step-settings.sql) — 3 statements retained
67. [dashboard-performance.sql](dashboard-performance.sql) — 21 statements retained
68. [dashboard-read-models.sql](dashboard-read-models.sql) — 10 statements retained
69. [premium-overview.sql](premium-overview.sql) — 6 statements retained
70. [inbox-realtime.sql](inbox-realtime.sql) — 1 statements retained
71. [inbox-load-indexes.sql](inbox-load-indexes.sql) — 9 statements retained

## ไฟล์ที่แยกออกทั้งหมด (ไม่ใช่ขั้นตอนติดตั้งใหม่)

| File | Reason |
| --- | --- |
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

## ท่อนที่ตัดจากไฟล์ต้นฉบับ

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

## วิธีใช้งานและขอบเขต

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
ทดสอบ isolated database: node --test scripts/test-full-database-setup.cjs

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
- commerce-v2.sql: `40a75be6ce40169b82de51925d8b2fa5232cba8bc4fe1a985a5f2e9ec32b409a`
- product-sku-reuse.sql: `158567cbd1962b8e6c75c72a9f5aaa52aceb26c84b9fc2c7bb4a7f24c41c41f4`
- payment-pro.sql: `aa6343641fb6d1c026a0913c81d79d990c295c23e9de63e41bfd42d3cdb7e148`
- payment-pro-dashboard.sql: `8d4e52e0d834ca8ce7cab97c2b78209535263726b7c5d1796ba4398b7ae54b7b`
- slip-bank-controls.sql: `08d19ff46fa0d05b9a42f710ea11f212756e4a95fea9440d221bce1b808f98e3`
- bank-registry.sql: `9552aa3856ddf0c584f98f7ac722bc877e9a1a89617d0dd0c2dd5a1d7914b4d0`
- payment-receiving-codes.sql: `69d202f61858dbf27aaffa6a93e201b0fe43cb15e22fc579fbe82d1bca342826`
- qr-payment-designer.sql: `791010165b6065afb641c311106260bb7f574a3624530ee8d9df966d2bee8cd3`
- store-rules.sql: `ea6f24e091470f5d88369563d5f012c9500370aaa7536d84d3bf33c986daaee9`
- store-rule-items.sql: `7f10a22e7c4ad118a193af3e28a5105070e4eeff33b9fee5d95d836fc9664a41`
- store-rules-validation.sql: `f8cbdf12cd3851025951edbf50d831548032211d73e43f12b011c1aa51df4883`
- facebook-webhook-queue.sql: `f860709ad67ac9cebdaaf4ac9e6307b31f70cbf20b2289ec99ba36ec9755a374`
- facebook-webhook-nonblocking.sql: `0cfe5319ef9b061c353b80a57463e06e1a97ff1424be84ecefb4a7ecb10baf4d`
- facebook-message-window.sql: `78ed4b175f56e2a324553f4cdc8c23e6b1aa526fd7112fbda778cb2fc32c11de`
- broadcast-policy.sql: `a45cf7c24ef5f6d31ef31868029bd3e9216370bc5c582b911b80a4ed74071233`
- broadcast-recipient-eligibility.sql: `6ea5e1f9044db876fc8d0f07d8da52668f9897fa684851092eab347710e4a74c`
- broadcast-recipient-selection.sql: `bdd1581c239a6ebc20048d32d342e6697d98ada245dd01260feacde8fe44278f`
- broadcast-inbound-sync.sql: `074351e109ac3b2191bc1eece9356c5ea28a58cb5b165a078e63413ad876beba`
- inbox-messenger-window.sql: `4ebe59d252e016e5d62eb28617e9a08d27847550f925f0273d18cc456c43e77e`
- smart-follow-up-presend.sql: `978fd4adf4cb9e1f16c8a1f21783ab4c7c43dedb66d7c11c7df20fe6ad36f9e4`
- manual-follow-ups.sql: `34d34f06c0a32579c6dc4a80583c4c15040b1919b8f2bd7e6638848adb06e165`
- follow-up-simplified.sql: `d425f213aab29a30c164cf201815925add5d76840f82fecb89cfae2aefb679fa`
- follow-up-step-settings.sql: `96bedcb1959a8d864b018de761fb35e8d989b42450060ca784c2f7143af13a0e`
- dashboard-performance.sql: `87871cb3623b3153a08fd585394dda0fbd296c4fb670e50791ee09527b2c29c5`
- dashboard-read-models.sql: `daca680061c44493d8ec6c139716a5a7e58aca1c20cddab9231ce59f94cf72cf`
- premium-overview.sql: `19d97393eda4ebd1de925886ce3add41af56164a2541e8e4e0b6f377f861f273`
- inbox-realtime.sql: `a7dc1d4c93f7995e27731bd59a078c4430650c0b627c9f4c14a80c5357d607f7`
- inbox-load-indexes.sql: `cee506871122e657bfbf6b2a12533272fee5b44607176d4c29298b0aaf404e42`
