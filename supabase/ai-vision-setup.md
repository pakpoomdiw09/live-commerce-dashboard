# ติดตั้ง AI Vision Center

1. สำรองฐานข้อมูล และทดสอบใน Staging ก่อน Production
2. ติดตั้ง migration เดิมของระบบให้ครบ โดยเฉพาะ `image-response-rules.sql`,
   `feature-access.sql`, `smart-inbox.sql`, `free-message-quota.sql` และ `bank-accounts.sql`
3. รัน `supabase/ai-vision.sql` **ท้ายสุด** ใน Supabase SQL Editor
   สคริปต์เพิ่มตาราง/คอลัมน์ ไม่ล้างข้อมูล และรันซ้ำได้
4. ใช้ `GEMINI_API_KEY` และ `GEMINI_MODEL` เดิมฝั่ง Server ห้ามใส่ key ใน NEXT_PUBLIC
5. คง `AI_VISION_AUTOMATION_ENABLED=false` ระหว่างทดลอง เปิด `/chatbot/images`
   ด้วยบัญชีร้าน Starter/Pro แล้วเลือกไฟล์ในช่องทดลอง รูปและประวัติจะบันทึกจริงและ
   ใช้โควตา Vision แต่ไม่ส่ง Messenger / ไม่เรียก SlipOK / ไม่แก้ออเดอร์
6. ตรวจผลการจำแนก รูปสินค้าในแคตตาล็อก กฎที่เลือก และโควตาจากฐานข้อมูล
7. เมื่อต้องการทดสอบการตอบอัตโนมัติบน **เพจทดสอบที่ได้รับอนุญาต**:
   ตั้ง `AI_VISION_AUTOMATION_ENABLED=true` บนเซิร์ฟเวอร์แล้วรีสตาร์ต,
   เปิดสวิตช์ Vision ของร้าน, ตรวจ Page Access Token ของร้าน, เปิด auto-reply
   และตั้ง worker เรียก `POST /api/cron/vision` พร้อม
   `Authorization: Bearer <CRON_SECRET>` ทุกนาที (ใช้ INTERNAL_API_SECRET หากไม่ได้ตั้ง CRON_SECRET)
   อย่าฝัง secret ใน URL หรือ frontend
8. สำหรับสลิป ต้องเปิด auto-verify ของร้าน มีสิทธิ์/เครดิตตรวจสลิปและบัญชีรับเงินที่เปิดใช้งาน
   การส่งคำตอบใช้เครดิตข้อความเดิมแยกต่างหาก
9. ห้ามเปิด Production อัตโนมัติโดยยังไม่ได้รับอนุญาตหรือยังไม่ได้ทดสอบเพจจริง

ค่าเริ่มต้น Free ถูกล็อกตามนโยบายเดิม, Starter 100 ภาพ/เดือน, Pro 1,000 ภาพ/เดือน
และค้นหาสินค้าจากภาพ เดือนนับตาม UTC เปลี่ยนโควตาได้ใน `vision_plan_limits`
ด้วยสิทธิ์ผู้ดูแลฐานข้อมูล การรัน migration ซ้ำไม่ทับค่าที่ปรับไว้

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
