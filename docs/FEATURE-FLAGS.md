> อัปเดต: Inbox ใช้ V2 โดยตรงแล้ว ไม่มี Flag สลับ Legacy อีกต่อไป ข้อความเกี่ยวกับ Inbox Feature Flag ด้านล่างเป็นประวัติการติดตั้งเดิม ส่วน Sales Page ยังใช้ Flag ตามเดิม

# Feature Flags

`lib/feature-flags.ts` exports `isFeatureEnabled('sales_page_v2')` and `isFeatureEnabled('smart_inbox_v2')`. Both default to false. Only the literal `true` enables a feature.

```dotenv
NEXT_PUBLIC_SALES_PAGE_V2_ENABLED=false
NEXT_PUBLIC_SMART_INBOX_V2_ENABLED=false
```

Public values override the former `SALES_PAGE_V2_ENABLED` / `SMART_INBOX_V2_ENABLED` server flags, including when explicitly set to false. Old flags are a compatibility fallback only when the public variable is absent. Set the public variables explicitly for consistent browser/server behavior. Do not put secrets in public variables.

`/shop` uses the existing Legacy/V2 branch through `shopV2()`. `/inbox` passes `inboxV2Flags()` from the server to select the existing Legacy/V2 components. Commerce APIs, Inbox workspace APIs and the V2 send policy share these switches. Existing authentication, tenant isolation, plan entitlements and subordinate flags still apply. Both pages are dynamic.

Next.js embeds NEXT_PUBLIC variables in browser code at build time: after changing flags, restart the dev server, or rebuild and redeploy production. These are deployment flags, not live remote switches. No database data is deleted when switching versions.

Before enabling: install the existing Commerce/Inbox migrations described in `SALES-PAGE-PRO-2026-10-17.md` and `SMART-INBOX-V2-2026-10-17.md`. Smart Inbox Pro bulk actions also require `SMART_INBOX_PRO_ENABLED=true` and its migration. Feature flags do not install schemas or grant access.

Rollback: set the relevant NEXT_PUBLIC flag to false and rebuild/redeploy. Retain the database tables; no SQL rollback is needed to restore the Legacy UI.

Tests: `node --test scripts/test-feature-flags.cjs scripts/test-commerce.cjs scripts/test-smart-inbox-v2.cjs scripts/test-smart-inbox-api.cjs` and `npm run build`.
