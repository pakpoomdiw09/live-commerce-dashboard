> อัปเดต: Inbox ใช้ V2 โดยตรงแล้ว ไม่มี Flag สลับ Legacy อีกต่อไป ข้อความเกี่ยวกับ Inbox Feature Flag ด้านล่างเป็นประวัติการติดตั้งเดิม ส่วน Sales Page ยังใช้ Flag ตามเดิม

# Smart Inbox V2 — รายงานการพัฒนา

ปรับใน Next.js App Router เดิม ใช้ Supabase Realtime, Session, Tenant guard และสิทธิ์แพ็กเกจเดิม ไม่มีการส่งข้อความจริง แก้ Production DB หรือเปลี่ยน `.env.local` ระหว่างพัฒนา

## เปิดใช้งาน

1. ตรวจ migration เดิม `smart-inbox.sql`, `smart-inbox-pro.sql` และ `broadcast-policy.sql` ให้ครบก่อน โดยไฟล์ broadcast-policy.sql มี prerequisites ระบุไว้ด้านบน
2. ทดสอบและรัน `supabase/smart-inbox-v2.sql` ในฐานข้อมูลที่ต้องการ ออกแบบให้รันซ้ำได้ เพิ่มเฉพาะตารางใหม่ ไม่แก้ข้อความ/ออเดอร์/สลิปเดิม
3. ตั้งค่าฝั่ง Server แล้ว restart/redeploy:

```dotenv
SMART_INBOX_V2_ENABLED=true
SMART_INBOX_PRO_ENABLED=true
INBOX_CUSTOMER_PANEL_V2_ENABLED=true
```

ค่าปริยาย V2 ปิดอยู่ ไม่ได้เปิดใช้งานให้ในเครื่องหรือ Production อัตโนมัติ เปิด V2 หลังติดตั้ง schema และตรวจ Page Token เท่านั้น เพราะ V2 ตรวจหลักฐานข้อความเข้าจาก Webhook ที่ยืนยันลายเซ็นแล้ว ไม่สร้างหลักฐานให้แชทเก่าย้อนหลัง ถ้าขาดหลักฐาน/ตาราง/ยืนยันสิทธิ์เพจไม่ได้ จะปฏิเสธการส่ง

## สิ่งที่ทำแล้ว

- หัวข้อรวมแชต จำนวนข้อความที่ยังไม่อ่านจริงจาก state รายงานแยกหน้า
- รายการแชต: ค้นหาชื่อ/เบอร์/แท็ก/ข้อความเดิม กรองสถานะ/ดาว/กำลังดูแล/รอชำระ/เสร็จแล้ว รายชื่อผู้ดูแลและ Facebook icon พร้อมโหลดเพิ่ม
- จำนวนในรายการระบุชัดว่าเป็นแชทที่โหลดแล้ว ไม่อ้างเป็นจำนวนทั้งฐานข้อมูล
- ติดดาวส่วนตัวต่อผู้ใช้ แสดงดาวในรายการและกรองได้ API จำกัดไม่เกิน 1,000 ดาวและแจ้งเมื่อถึงเพดาน
- จัดการหลายแชทไม่เกิน 20 รายการ: รับแชท มอบหมาย ปิดพร้อมเหตุผล เปิดใหม่ และอ่านแล้ว ใช้ API/RPC เดิมตรวจสิทธิ์และ version แยกรายการ มีผลสำเร็จ/ข้อผิดพลาด ไม่ส่งข้อความหาลูกค้า
- แถบข้อมูลลูกค้าพับได้บน Desktop และเปิดเป็นแถบซ้อนบนจอเล็ก แท็บข้อมูล/ออเดอร์/โน้ต/ประวัติ ใช้ข้อมูลจริงจาก API เดิม
- โน้ตภายในพร้อมผู้เขียนและเวลา แสดงล่าสุด 50 รายการ แยกจาก messages ไม่เข้าท่อส่ง Messenger แสดงเป็น plain text ผ่าน React
- ช่องพิมพ์ใช้เครื่องมือแนบภาพ/PDF คำตอบด่วน อีโมจิ และ AI ร่างเดิม ไม่มีการส่ง AI อัตโนมัติ เพิ่มพื้นที่ขอบล่างสำหรับ safe area
- ป้ายช่วงเวลาตอบกลับ/ใกล้หมดเวลา ใช้หลักฐาน inbound จาก Webhook ที่ตรวจลายเซ็นแล้ว ฝั่ง Server ตรวจ Page Token, pages_messaging, Page identity และช่วงเวลาอีกครั้งก่อนส่ง V2 ไม่มีทาง fallback ไปใช้ tag
- แก้ตรวจเวลาเดิมให้ปฏิเสธ invalid/future/exact 24 ชั่วโมง แม้ปิด V2
- รักษา Realtime หนึ่ง channel, event deduplication, stale response cancellation, pagination, receipt และ idempotent message ID เดิม
- เพิ่มทะเบียน capabilities ช่องทางใน `lib/inbox-channels.ts` มี Facebook เท่านั้น ยังไม่ใช่ transport สำหรับช่องทางอื่น

ตัวกรองรอชำระใช้ `orders.status=pending_payment` พร้อม scope ทั้ง orders และ customers ของร้าน ไม่ตีความลูกค้าใหม่เป็นลูกค้าค้างชำระ โหลดข้อมูลกลุ่มนี้ไม่เกิน 1,000 รายการและแจ้งเมื่อถึงเพดาน ออเดอร์ใน Inspector ใช้ `orders` เดิม ไม่รวม `commerce_orders` ซึ่งเป็นอีกระบบ

## ไฟล์และ API

- หน้า: `app/(dashboard)/inbox/page.tsx` ส่ง flag จาก Server
- UI: `InboxClient`, `InboxProCenter`, `ChatList`, `Conversation`, `Inspector`, `ConversationHistory`, `ReplyBox`
- ใหม่: `WorkspaceTools.tsx` สำหรับดาว/โน้ต/ช่วงเวลา, `BulkActions.tsx` สำหรับการทำงานหลายแชท
- Legacy: `ChatListLegacy`, `InspectorLegacy`, `ConversationHistoryLegacy`, `InboxProCenterLegacy` เก็บ UI ก่อนงานนี้ไว้เพื่อย้อนกลับ ไม่เปลี่ยน state owner ของ Realtime
- `GET/POST /api/inbox/conversations/[id]/workspace`: notes/star/window/read ใช้ inboxCustomer ตรวจ session, tenant, package ก่อนข้อมูลส่วนตัว และป้องกัน cross-site POST
- `GET /api/inbox/stars?tenantId=...`: ดาวของผู้ใช้ปัจจุบัน scope ร้านค้า
- ใช้ PATCH conversations, read RPC, search, messages send/media/draft และ history เดิม
- `lib/features/inbox/inbox-v2.ts`: flags และการคำนวณเวลา; `lib/features/inbox/inbox-policy-server.ts`: signed evidence + Page token validation
- `app/api/messages/send/route.ts`: ยังคง lease/idempotency/delivery receipt เดิม เพิ่มตรวจเวลาและ policy V2

## ฐานข้อมูลและความปลอดภัย

Migration เพิ่ม `inbox_internal_notes`, `inbox_stars`, `inbox_workspace_requests` และ RPC `manage_inbox_workspace` เท่านั้น RLS เปิด ไม่มีสิทธิ์อ่าน/เขียนโดย anon/authenticated โดยตรง API ใช้ service role หลัง guard; RPC ตรวจสมาชิก/แพ็กเกจซ้ำ จัดเก็บ request ID เพื่อกันคำขอซ้ำ ใช้ advisory lock และจำกัด 30 workspace mutations ต่อผู้ใช้ต่อนาที Notes เป็น append-only ใน UI บันทึก actor/time/request เสมอ Bulk ใช้ rate limit และ audit ของ Pro RPC เดิม

## ข้อจำกัดที่ยังไม่เปิดใช้

- ไม่มีรูปต้นแบบแนบมาในรอบนี้ มีเพียงไฟล์ข้อความ จึงใช้ธีมและรูปแบบ SnapBot เดิม
- ยังไม่มี LINE/Instagram/WhatsApp transport จึงไม่แสดงช่องทางที่เชื่อมต่อไม่ได้
- AI สรุปแชท วิเคราะห์เจตนา แนะนำสินค้า ยังไม่มี endpoint ที่เชื่อมต่อ จึงยังไม่เพิ่มปุ่มเหล่านี้ ใช้ AI draft เดิมตาม entitlement เท่านั้น
- ไม่มีการทดสอบบัญชี Facebook จริงหรือ Production; ต้องทดสอบ integration กับ test Page ก่อนเปิดจริง
- รายการดาว/โน้ตยังไม่ subscribe Realtime ข้าม browser จะอัปเดตเมื่อเปิดแชทหรือโหลดหน้าใหม่ ส่วนข้อความใช้ Realtime เดิม
- ไม่มีการแก้ไข/ลบโน้ตหรือประวัติออเดอร์ในงานนี้

## Rollback

ตั้ง `SMART_INBOX_V2_ENABLED=false` แล้ว restart/redeploy กลับ UI เดิมทันทีและปิด API ใหม่; หรือปิดเฉพาะ panel ด้วย `INBOX_CUSTOMER_PANEL_V2_ENABLED=false` ไม่ต้องลบตารางใหม่ ข้อมูลโน้ตและดาวยังคงอยู่เพื่อเปิดกลับได้ การแก้ช่องโหว่เวลา invalid/future/exact boundary ยังคงอยู่

หากจำเป็นต้องถอน schema ให้ปิด flag และสำรองสามตารางใหม่ก่อน แล้วถอน function/table ใน migration นี้ตาม dependency ห้ามลบ `messages`, `customers`, `orders` หรือ broadcast evidence เพื่อ rollback UI

## วิธีใช้

เปิด `/inbox` เลือกแชทจากรายการ บนมือถือเริ่มที่รายการก่อน กดรับแชทก่อนตอบ ใช้ดาวเพื่อเก็บรายการติดตาม เปิดรายละเอียดลูกค้าเพื่อดูออเดอร์/โน้ต/ประวัติ เมื่อเลือกจัดการหลายแชทให้ตรวจรายการและผู้รับมอบหมายก่อนยืนยัน หากผลล้มเหลวบางรายการให้โหลดสถานะล่าสุดก่อนทำซ้ำ

## การตรวจสอบ

ผลตรวจ: Unit/API/SQL regression ผ่าน 26 รายการ; Typecheck ผ่าน; Lint ไม่มี error (มี warning เดิมของโปรเจกต์ 19 รายการ); Browser ทั้ง V2 เปิดและปิดผ่าน รวมการติดดาว โน้ตและ bulk claim การเปิด/ปิด inspector ไม่มี horizontal overflow ทั้งสามขนาด

ทดสอบด้วย mock provider/browser fixtures และ PostgreSQL แบบ isolated ใน PGlite เท่านั้น คำสั่งหลัก:

```powershell
node --test scripts/test-smart-inbox-v2.cjs scripts/test-smart-inbox-api.cjs scripts/test-smart-inbox-pro-api.cjs scripts/test-inbox-request.cjs scripts/test-inbox-realtime.cjs
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
node scripts/check-smart-inbox-browser.cjs
$env:INBOX_V2_TEST='1'; node scripts/check-smart-inbox-browser.cjs
```

Browser fixtures ใช้ React StrictMode จริง ตรวจ rapid A-B-C, stale responses, event replay/reconnect, triple-click actions, guide/tools, stars, notes, bulk claim, inspector collapse และ overflow ที่ 375/768/1440 px ภาพอยู่ `docs/screenshots/inbox-v2-*.png` เป็นข้อมูลจำลองที่แยกจากโปรเจกต์จริง

หลักอ้างอิง Send API: [เอกสาร Meta บน Postman](https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api) ระบุ Page token, pages_messaging และช่วงส่งมาตรฐาน 24 ชั่วโมง งานนี้ใช้เฉพาะ standard response ไม่เปิดข้อยกเว้นนอกช่วงเวลา
