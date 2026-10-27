# ติดตั้ง AI Vision Center

1. สำรองฐานข้อมูล และทดสอบใน Staging ก่อน Production
2. ติดตั้ง migration เดิมของระบบให้ครบ โดยเฉพาะ `image-response-rules.sql`,
   `feature-access.sql`, `smart-inbox.sql`, `free-message-quota.sql` และ `bank-accounts.sql`
3. รัน `supabase/ai-vision.sql` แล้วรัน `supabase/vision-master-switch.sql` **ท้ายสุด** ใน Supabase SQL Editor
   หากใช้ Full Access ให้รัน `vision-master-switch.sql` หลัง `full-access.sql` ด้วย
   สคริปต์เพิ่มตาราง/คอลัมน์ ไม่ล้างข้อมูล และรันซ้ำได้
4. ใช้ `GEMINI_API_KEY` และ `GEMINI_MODEL` เดิมฝั่ง Server ห้ามใส่ key ใน NEXT_PUBLIC
5. คง Master Switch ของร้านเป็นปิดระหว่างทดลอง เปิด `/chatbot/images`
   ด้วยบัญชีร้าน Starter/Pro แล้วเลือกไฟล์ในช่องทดลอง รูปและประวัติจะบันทึกจริงและ
   ใช้โควตา Vision แต่ไม่ส่ง Messenger / ไม่เรียก SlipOK / ไม่แก้ออเดอร์
6. ตรวจผลการจำแนกและกฎที่เลือก ค่า confidence ล็อกที่ 0.8
7. เมื่อต้องการทดสอบการตอบอัตโนมัติบน **เพจทดสอบที่ได้รับอนุญาต**:
   เปิด Master Switch บนแบนเนอร์สีส้ม ระบบบันทึกทันที,
   ตรวจ Page Access Token ของร้าน
   และตั้ง worker เรียก `POST /api/cron/vision` พร้อม
   `Authorization: Bearer <CRON_SECRET>` ทุกนาที (ใช้ INTERNAL_API_SECRET หากไม่ได้ตั้ง CRON_SECRET)
   อย่าฝัง secret ใน URL หรือ frontend
8. ภาพสลิป/ทั่วไป/สินค้าที่ตรงกับกฎจะตอบจากกฎของร้าน หากไม่พบกฎ ความมั่นใจต่ำ
   หรือวิเคราะห์ล้มเหลว ระบบพักบอทและนำแชทเข้า Inbox อัตโนมัติ การตอบรูปสลิปไม่ใช่การยืนยันชำระเงิน
   การส่งคำตอบใช้เครดิตข้อความเดิม และยังตรวจกรอบเวลา Messenger ก่อนส่ง
9. ห้ามเปิด Production อัตโนมัติโดยยังไม่ได้รับอนุญาตหรือยังไม่ได้ทดสอบเพจจริง

ค่าเริ่มต้น Free ถูกล็อกตามนโยบายเดิม, Starter 100 ภาพ/เดือน, Pro 1,000 ภาพ/เดือน
เดือนนับตาม UTC เปลี่ยนโควตาได้ใน `vision_plan_limits`
ด้วยสิทธิ์ผู้ดูแลฐานข้อมูล การรัน migration ซ้ำไม่ทับค่าที่ปรับไว้

Master Switch ใช้ `vision_settings.enabled` และทำงานแยกจากสวิตช์บอทข้อความของร้าน
ตัวแปรเดิม `AI_VISION_AUTOMATION_ENABLED` ไม่มีผลกับ Vision แล้ว
ร้านที่บันทึกปิด Vision จะไม่ส่งรูปไปยังระบบตอบภาพหรือระบบตรวจสลิปแบบเดิม
ส่วนร้านที่ยังไม่มีการตั้งค่า Vision ยังคงเส้นทางเดิมไว้
การส่งต่อไม่เปลี่ยนแอดมินที่รับงานอยู่และไม่ปลดล็อกข้อความที่กำลังส่ง
Sandbox ทดลองได้ทั้งขณะเปิด/ปิดสวิตช์ และไม่ส่งข้อความหรือพักบอทของลูกค้าจริง

หาก Worker ล่มก่อนเริ่ม AI ระบบคืนโควตาและลองใหม่อย่างปลอดภัยสูงสุด 3 ครั้ง
หากเริ่มเรียก AI หรือเริ่มส่งข้อความแล้ว งานที่ไม่แน่ใจจะรอแอดมินตรวจสอบและไม่ส่งซ้ำ
ประวัติดูได้ที่หน้า Vision; ภาพมีลิงก์ส่วนตัวที่ตรวจสิทธิ์ก่อนสร้าง signed URL อายุ 60 วินาที

คำสั่งตรวจสอบในเครื่อง:

```powershell
npm.cmd run dev
node --test scripts/test-ai-vision.cjs
# ระบุ path ของ PGlite ที่ติดตั้งไว้สำหรับทดสอบฐานข้อมูลแบบแยกส่วน
node scripts/test-ai-vision-sql.cjs "<path-to-@electric-sql/pglite>"
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
```

รายละเอียดสถาปัตยกรรม ขอบเขตที่ยังไม่ทำ และรายการไฟล์:
[AI Vision implementation](../docs/ai-vision-implementation.md)
