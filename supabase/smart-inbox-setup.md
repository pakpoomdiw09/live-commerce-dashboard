# Smart Inbox

หน้าเดิมอยู่ที่ `/inbox` ใช้ Facebook Messenger, ตาราง `customers` / `messages` เดิม และ Supabase Realtime เดิม ไม่มีช่องทางหรือข้อมูลลูกค้าจำลอง

## ก่อน deploy

1. ใช้ migration เดิมให้ครบ รวม `feature-access.sql`, `free-message-quota.sql`, `customer-profiles.sql` และ `handover-messages.sql`
2. รัน `supabase/inbox-realtime.sql` แล้วรัน **`supabase/smart-inbox.sql` เป็นไฟล์สุดท้าย** ใน Supabase SQL Editor ก่อน deploy โค้ดนี้ รันซ้ำได้ ไม่ลบข้อความหรือลูกค้าเดิม
3. ตรวจว่า Realtime เปิดสำหรับ `customers`, `messages`, `comments`, `slips`, `conversation_reads` และเปิดให้ client เชื่อมต่อด้วย session ของผู้ใช้ตามปกติ
4. ตั้งค่า Page Access Token ของแต่ละ tenant, Facebook App Secret และ webhook ที่ `/api/webhook/facebook` ใช้ token ฝั่ง server เท่านั้น ตั้ง subscription `messages`, `message_deliveries`, `message_reads` และ `feed` หากใช้คอมเมนต์
5. สมาชิกที่ใช้รับ/โอนแชทต้องอยู่ใน `tenant_members` ของร้านเดียวกัน AI ช่วยร่างและคืนให้ AI ต้องมี AI provider ที่ตั้งค่าใช้งานได้

## สิทธิ์และพฤติกรรม

- ใช้สิทธิ์แพ็กเกจจากฐานข้อมูลเดิม: Starter/Pro ใช้ Inbox; AI Agent/AI ช่วยร่างใช้ Pro ตาม `plan_features` ไม่มีการเพิ่มข้อจำกัดจำนวนช่องทางหรือจำนวนแอดมินตามตัวอย่างใน prompt
- ผู้ดูแลต้องรับแชท/ได้รับโอนแชทก่อนตอบ การรับแชทพักบอท ปิดแชทพักบอทด้วย ข้อความใหม่ของลูกค้าเปิดแชทกลับมาโดยคงผู้รับผิดชอบและสถานะพักบอท
- การเปลี่ยนสถานะใช้ row lock + version check และเก็บ actor/ผู้รับโอนใน `conversation_events` หากมีข้อความกำลังส่งให้ลองรับ/โอนใหม่หลังส่งเสร็จ
- บอทที่กำลังร่างจะตรวจสถานะอีกครั้งก่อนส่งจริง การส่งของบอทกับการรับแชทใช้ delivery lease เดียวกัน (หมดอายุ 2 นาทีเมื่อ process ถูกหยุด)
- ตัวนับยังไม่อ่านแยกตามผู้ใช้และ sequence ของข้อความขาเข้า เปิดอ่านแล้วจะ mark เฉพาะข้อความที่โหลดมา ไม่ล้างข้อความที่ยังไม่เคยโหลด
- ไฟล์แนบ outgoing รองรับ JPEG/PNG/GIF/WebP/PDF ไม่เกิน 8 MB เก็บใน bucket private `inbox-media` อ่านผ่าน authenticated API เท่านั้น ลิงก์ให้ Meta โหลดมีอายุ 1 ชั่วโมง ลิงก์เปิดดูจาก dashboard มีอายุ 60 วินาที
- ส่งไฟล์และข้อความแยกกันเพื่อแสดงผลสำเร็จ/ล้มเหลวของแต่ละข้อความได้ตรงจริง ข้อความที่พิมพ์ไว้ยังอยู่หลังส่งไฟล์
- Messenger ส่งผ่าน `RESPONSE` ภายใน 24 ชั่วโมงจากข้อความล่าสุดของลูกค้า ต้องมีสิทธิ์ `pages_messaging` และสิทธิ์แอปตามการตั้งค่า Meta ดู [Meta Messenger Send API](https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api)
- `sent` หมายถึง Meta ตอบ message ID; `delivered`/`read` เปลี่ยนเมื่อได้รับ signed webhook ที่อ้างอิงข้อความ/ลูกค้า/เพจถูกต้องเท่านั้น ข้อความเดิมที่ไม่มี provider ID จะไม่สร้างสถานะอ่านปลอม
- รหัส client UUID ถูกบันทึกก่อนส่ง ป้องกัน double click / concurrent requests / retry การ timeout ใช้ `unknown` หรือ pending ที่ยังยืนยันไม่ได้ ไม่ลบหลักฐานและไม่ส่งซ้ำอัตโนมัติ ผู้ดูแลควรตรวจ Messenger ก่อนสร้างข้อความใหม่
- คำตอบด่วนใช้กฎข้อความที่ร้านเปิดใช้งานจริงจาก `chat_rules` AI ช่วยร่างอาศัยประวัติและข้อมูลสินค้าเดิม ต้องตรวจทานและกดส่งเอง
- รายชื่อโหลดเพิ่มเป็นหน้า ข้อความเก่าโหลดด้วย cursor คู่เวลา+ID การค้นหาข้ามข้อความ/ชื่อ/เบอร์ในร้านคืนได้สูงสุด 100 แชทต่อคำค้น (พิจารณา 200 ข้อความตรงเงื่อนไขล่าสุด) ใช้คำค้นให้เจาะจงเมื่อข้อมูลมาก
- ไม่เพิ่มอีเมลปลอม: schema ลูกค้าเดิมไม่มีช่องอีเมล จึงแสดงข้อมูลติดต่อที่มีจริง (Messenger/เบอร์/ที่อยู่)

## การทดสอบ

```powershell
npx.cmd tsc --noEmit
node --test scripts/test-smart-inbox-api.cjs scripts/test-inbox-realtime.cjs scripts/test-message-quota.cjs
node scripts/test-smart-inbox-sql.cjs <path-to-@electric-sql/pglite>
npm.cmd run build
```

SQL tests ใช้ฐานข้อมูลทดสอบแยก ไม่เขียนลง Supabase จริง API tests mock เฉพาะขอบเขตเครือข่าย ไม่ส่งข้อความหาลูกค้าจริง ก่อนเปิดใช้งานจริงให้ทดสอบด้วยเพจทดสอบ: ลูกค้าส่งข้อความ → ยังไม่อ่าน → แอดมินรับแชท → ส่งข้อความ/รูป/PDF → โอนให้สมาชิกอีกคน → ปิด/เปิด → คืนบอท และตัด/ต่ออินเทอร์เน็ต รวมถึงตรวจ delivery/read webhook ใน Meta Dashboard
