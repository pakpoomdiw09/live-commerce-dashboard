# Smart Follow-up implementation report

## COMPLETED

- หน้า `/chatbot/follow-ups`: overview 30 วัน, templates 3 แบบ, workflow editor 1–3 ขั้น/ข้อความ/เวลา/stop on reply/AI review, queue + filters + cursor pagination, execution history และ communication policy
- Worker เดิม `/api/cron/follow-ups` และ `/api/follow-ups/run` ใช้ atomic claim/preflight/complete RPC แทนอ่าน scheduled แล้วส่งตรง รองรับ retry ที่ยังไม่ dispatch และ review ของผลไม่แน่นอน
- เชื่อมออเดอร์ CF, สถานะชำระจริงจาก slip pipeline, Inbox handoff/leases, Gemini, quota และ Page tokens เดิม ไม่สร้างระบบชำระเงินหรือ AI provider ใหม่
- เพิ่มหลักฐานส่งถึงจริงที่เจ้าของร้านยืนยัน และการยืนยันออเดอร์ที่ไม่ได้มาจาก CF
- Privacy controls ใน Inbox: opt-out / พักติดตาม และการกลับมารับติดตามผ่านข้อความลูกค้าจริง
- Dashboard แสดงแพ็กเกจ วันหมดอายุ เครดิตข้อความแยกแพ็กเกจ/เติม และโควตาสลิปจาก `getBilling` ฝั่ง server
- ปุ่มหยุดติดตามรายลูกค้าและรับช่วงใน Inbox จากตารางคิว ใช้ API opt-out และ RPC versioned handoff เดิม ไม่เชื่อ actor/version/ยอดเครดิตจาก frontend
- เพิ่ม ESLint config และ `npm run lint` โดยใช้ Next core web vitals rules

## ไฟล์ที่สร้าง

- `supabase/smart-follow-ups.sql`, `supabase/smart-follow-ups-setup.md`
- `lib/smart-followup-types.ts`, `lib/smart-followup-validation.ts`, `lib/smart-followup-server.ts`, `lib/followup-ai.ts`
- `components/chatbot/SmartFollowUpsClient.tsx`, `components/inbox/FollowUpContactControl.tsx`
- `app/api/follow-ups/route.ts`
- `app/api/follow-ups/jobs/[id]/route.ts`, `app/api/follow-ups/jobs/[id]/draft/route.ts`
- `app/api/follow-ups/orders/[id]/confirm/route.ts`, `app/api/follow-ups/orders/[id]/delivery/route.ts`
- `app/api/follow-ups/customers/[id]/route.ts`
- `app/api/follow-ups/customers/[id]/handoff/route.ts`
- `scripts/test-smart-followups.cjs`, `scripts/test-smart-followups-sql.cjs`, `eslint.config.mjs`

## ไฟล์ที่แก้

- `lib/follow-ups.ts`: worker transaction protocol / send flag / unknown-result handling
- `app/(dashboard)/chatbot/follow-ups/page.tsx`: authenticated server data และ Smart Dashboard
- `components/chatbot/FollowUpsClient.tsx`: ใช้ entry point เดิมส่งต่อไป Smart Dashboard เอา UI และ browser mutations รุ่นเก่าที่ไม่ได้ใช้ออก
- `app/api/webhook/facebook/route.ts`: observe stored incoming messages / real AI classification / complaint handoff; signature และ slip pipeline เดิมคงทำงาน
- `app/(dashboard)/shop/page.tsx`, `components/shop/ShopClient.tsx`: confirmed order และบันทึกหลักฐานส่งถึง
- `components/inbox/Inspector.tsx`, `components/inbox/useInboxState.ts`: contact controls และ cleanup ของ request generation
- `.env.example`, `package.json`, `package-lock.json`: flag ตัวอย่างและ dev tooling lint

## TESTED

ผลทดสอบจริงของรอบนี้:

- Unit/API/regression: 73 tests ผ่าน รวม Smart Follow-up, Inbox, AI, quota, guards, page scope, ตัวแปรข้อความ, canonical billing และ Dashboard handoff/opt-out
- SQL integration: 31 สถานการณ์ผ่าน รวม migration rerun, claims, stop conditions, expiry, quiet hours, quota/refunds, crash/review, verified delivery, Pro dispatch ทั้งสามประเภท, opt-out/opt-in บน Free, optimistic config save, literal template rendering, audited assignment ที่ยกเลิกงานติดตาม และ tenant/service-role isolation
- `npx.cmd tsc --noEmit`: ผ่าน
- `npm.cmd run lint`: 0 errors; 10 warnings ในโค้ดเดิม (inline directives, image/alt และ effect dependencies) ไม่ปิดกฎเพื่อลด errors
- `npm.cmd run build`: ผ่าน รวม lint/type validation
- Production HTTP smoke ในเครื่อง: login 200, dashboard redirect 307, follow-up/customer API และ cron ที่ไม่มี session/secret ตอบ 401 ทั้งหมด หยุด test server หลังตรวจแล้ว

ใช้ SQL integration บน PGlite แยกจาก Supabase จริง และ mock เครือข่ายของ Meta/Gemini ไม่มีการส่งข้อความหาลูกค้าจริง การ build/type/lint ไม่ยืนยันว่า credentials หรือ migrations บน production ถูกตั้งแล้ว

## REQUIRES CONFIGURATION / NOT IMPLEMENTED

ต้อง backup/restore-test, apply migration, ตั้ง scheduler/Page token/Gemini และอนุมัติเปิด flag ก่อนใช้งานจริง ยังไม่ได้ deploy หรือ live end-to-end test และไม่ได้เชื่อม API บริษัทขนส่ง (ใช้หลักฐานที่ owner ตรวจยืนยัน) ดูขั้นตอนและรายการ smoke tests ใน `supabase/smart-follow-ups-setup.md`

สิทธิ์ต่างจากข้อเสนอใน prompt: คง Free locked / Starter payment 3 steps เดิม ไม่เพิ่ม trial หรือเปลี่ยนลูกค้าเป็นแพ็กเกจอื่น Workflow ขั้นสูงใหม่ใช้ entitlement Pro จากฐานข้อมูล

## รอบติดตั้งตามโค้ดตัวอย่าง (16 ตุลาคม 2026)

ไม่คัดลอก `PLAN_ENTITLEMENTS` ตัวอย่างมาทับสิทธิ์ลูกค้า และไม่เพิ่ม `evaluateFollowUp` ฝั่ง client ที่ทำให้เงื่อนไขซ้ำซ้อน ระบบใช้ `has_tenant_feature` ตรวจ subscription/expiry จากฐานข้อมูล และ `prepare_follow_up` ตรวจเงื่อนไข/จองเครดิตภายใน transaction ก่อนส่งจริงอยู่แล้ว

รอบนี้เพิ่ม `app/api/follow-ups/customers/[id]/handoff/route.ts` และแก้ `lib/smart-followup-server.ts`, `lib/smart-followup-types.ts`, `components/chatbot/SmartFollowUpsClient.tsx`, tests ทั้งสองไฟล์ และเอกสาร เพื่อเติมการแสดงยอดจริง/ปุ่มจัดการจาก Dashboard ไม่มี schema หรือ migration ใหม่ ใช้ `smart-follow-ups.sql` และ `smart-inbox.sql` ที่เตรียมไว้ ไม่แก้ `.env.local` และไม่เปิด live send
