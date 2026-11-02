# Live Auction Console

`/live-cf?mode=cf` แสดงฟอร์ม CF และ `/live-cf?mode=auction` แสดงห้องควบคุมประมูล
โดยแยก Component ของทั้งสองโหมดออกจากกัน

โหมดประมูลมีแท็บย่อย:

- **ควบคุมประมูลสด**: เลือกเพจ/ไลฟ์ ตั้งค่ารอบใหม่ กระดานผู้นำ ปุ่มส่งคอมเมนต์ 3/2/1/❌ และประวัติเฉพาะรอบ
- **สรุปผล & รายรับรายจ่าย Session**: ตัวเลขบัญชี ผลแต่ละรอบ ปรับผู้ชนะ และพรีวิวแจ้งยอด

แท็บสรุปเริ่มโหลดเมื่อผู้ใช้เปิดดูเท่านั้น ใช้ URL `auctionView=summary` เปิดโดยตรงได้
หน้าที่ซ่อนจะหยุด polling เมื่อมีรอบที่กำลังประมูล หน้า Console จะยุบฟอร์มเปิดรอบโดยอัตโนมัติ
การปิดรายการจะคงอยู่ที่ Console ส่วนการกดจบไลฟ์สำเร็จจะเปิดแท็บสรุป
การสลับแท็บไม่หยุดการประมวลผลคอมเมนต์ใน backend

## Database deployment

สำหรับฐานข้อมูลที่ติดตั้ง `live-session-dashboard.sql` แล้ว ให้รัน
`supabase/live-order-types.sql` ก่อน deploy โค้ดชุดนี้
ฐานข้อมูลใหม่ใช้ `supabase/complete_schema.sql` ที่ regenerate แล้ว
ยังไม่มีการรัน migration บน production จากงานนี้

- `orders.order_type` เป็น generated column จาก `source`: `auction` / `cf` หรือ null สำหรับรายการนอกไลฟ์ที่ไม่ทราบประเภท
- `customer_tab_items.order_type` และ `source_code` ถูก stamp จาก order ผ่าน trigger ที่ตรวจ tenant/customer/tab
- Backfill และการรันซ้ำไม่เปลี่ยนยอดเงิน สลิป ค่าส่ง หรือ revision ของบิล
- คง `source` / `source_id` เดิม เพื่อรักษา idempotency ของ webhook และการปิดรอบ
- ใช้ Customer Tab เดิมต่อ customer/session ทั้ง CF และประมูล คิดค่าส่งครั้งเดียว
- ใบแจ้งยอด หน้าแนบสลิป Inbox และพรีวิวทวงยอดแสดง `[ประมูล]` / `[CF-A1]` ตามที่มารายการ
- ข้อความ Messenger แบบปุ่มแสดงรายการและยอดจาก ledger หากยาวเกินขีดจำกัดจะชี้ไปดูรายการทั้งหมดในลิงก์บิล

## Verification

ใช้ `test:auctions`, `test:customer-tabs`, `test:live-sessions`, `test:schema`
และ `test:auctions:ui` ตรวจการแยกแท็บ การหยุด polling ประวัติเฉพาะรอบ และยอดบิลผสม
ชุดทดสอบใช้ฐานข้อมูล PGlite และ Facebook API จำลอง ไม่ส่งข้อความจริง
