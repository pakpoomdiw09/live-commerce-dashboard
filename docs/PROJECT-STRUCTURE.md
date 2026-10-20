# โครงสร้างโปรเจกต์

## ตำแหน่งไฟล์

`app/` เก็บเส้นทางของ App Router, route handlers และไฟล์เฉพาะเส้นทาง เช่น `loading.tsx` และ `error.tsx` ชื่อเส้นทางและ URL ของ API คงเดิมทั้งหมด

`components/ui/` เก็บองค์ประกอบพื้นฐาน ส่วน `components/shared/` เก็บหน้าสถานะและองค์ประกอบที่ใช้ร่วมกัน เช่น ErrorState, FeatureLocked และ PageSkeletons องค์ประกอบที่มีตรรกะเฉพาะงานอยู่ในโฟลเดอร์ฟีเจอร์เดิม เช่น `chatbot/`, `inbox/`, `overview/` และ `payments/` เพิ่ม `auth/` สำหรับหน้าลงชื่อเข้าใช้ และ `banking/` สำหรับโลโก้กับตัวเลือกธนาคาร

`hooks/inbox/` เก็บ useInboxState และ useChatScroll แยกจากส่วนแสดงผล

`lib/features/` แยกตรรกะตามงาน:

- `agents/`: การประมวลผล AI การตอบอัตโนมัติ การส่งต่อ และศูนย์ควบคุม
- `store-rules/`: การตรวจสอบและแปลงกฎร้านค้า
- `inbox/`: การสนทนา การค้นหา และข้อมูลสด
- `billing/`, `banking/`, `payments/`, `slips/`: แพ็กเกจ บัญชีรับเงิน การชำระเงิน และตรวจสลิป
- `commerce/`, `comments/`, `broadcast/`, `follow-ups/`, `vision/`, `overview/`: ตรรกะเฉพาะของแต่ละฟีเจอร์

`lib/integrations/facebook/` รวมการติดต่อ Facebook การเชื่อมต่อเพจ และระบบรับ/ประมวลผล webhook โดย `client.ts` เป็นตัวเรียก Facebook API ทางเซิร์ฟเวอร์ ชื่อไฟล์นี้ไม่ได้หมายถึง React Client Component

`lib/supabase/` คงแยกตัวเชื่อมต่อ browser, server และ middleware ตามเดิม โมดูลที่ใช้ข้ามฟีเจอร์ เช่น auth, tenant, สิทธิ์ โควตา การตรวจไฟล์ และบันทึกเหตุการณ์ อยู่ใน `lib/` ไม่สร้างโฟลเดอร์ server actions เปล่า เพราะปัจจุบันการเปลี่ยนข้อมูลทำผ่าน route handlers

`supabase/` เก็บ SQL และลำดับติดตั้งเดิม ส่วน `scripts/helpers/` กับ `scripts/fixtures/` เป็นเครื่องมือและข้อมูลสำหรับทดสอบ

## กติกาการอ้างอิง

ใช้ `@/components/...`, `@/hooks/...` และ `@/lib/...` ในโค้ดแอป อ้างอิงโมดูลปลายทางโดยตรง ไม่ใช้ barrel ที่รวมโค้ด browser และ server เข้าด้วยกัน โมดูลที่มี `server-only` ยังคงป้องกันการนำเข้าใน browser และ `lib/` ต้องไม่อ้างอิง UI หรือ route handlers ย้อนกลับ

แก้การอ้างอิงวนกันสามจุดโดยแยก `agents/ai-errors.ts`, `agents/chatbot-actions.ts` และ `slips/receiver-matching.ts` โมดูลต้นทางยังส่งออกชื่อฟังก์ชันเดิมเพื่อรักษาสัญญาการใช้งาน โดยผู้เรียกภายในที่ทำให้เกิดวงจรเปลี่ยนมาใช้โมดูลย่อยโดยตรง

ตรวจสอบโครงสร้างด้วย:

`node scripts/check-architecture.cjs`

คำสั่งนี้ตรวจ import ที่หาไฟล์ไม่เจอ การอ้างอิงวนกันในโค้ดที่ทำงานจริง relative imports และการอ้างอิง UI ย้อนกลับจาก lib โดยไม่นับ import ที่ใช้เฉพาะชนิดข้อมูลเป็นวงจรขณะทำงาน

## ความเข้ากันได้และการตรวจสอบ

ย้ายไฟล์เดิม 90 โมดูล ปรับจุดนำเข้าในโค้ด ไฟล์ทดสอบ และเอกสาร ลบไฟล์ว่างที่หลงอยู่ใน root ชื่อ `Allow new users to sign up` ไฟล์ตั้งค่า package และเส้นทาง App Router ทั้ง 127 ไฟล์คงเดิม ไม่แก้ฐานข้อมูล ข้อมูลร้านค้า หรือ environment secrets

การตรวจหลังย้าย: TypeScript, production build และตัวตรวจโครงสร้างผ่าน ESLint ไม่มีข้อผิดพลาด แต่ยังมีคำเตือนเดิม 12 รายการ การทดสอบเฉพาะส่วน webhook, upload, payments, rules, commerce และ overview ผ่านรวม 216 รายการ (ชุดหลัก 211 รายการ และส่วนแสดงผล Overview อีก 5 รายการ) โดยใช้ Node test runner เดิมของแต่ละชุด

`npm test` ยังเริ่ม tsx ไม่ได้ในเครื่องนี้ เนื่องจาก Node เรียก `os.userInfo()` แล้วได้รับ `uv_os_get_passwd ENOMEM` ก่อนเริ่มทดสอบ ไม่ได้แก้การตั้งค่าโปรเจกต์เพื่อหลบปัญหาของสภาพแวดล้อมนี้ ชุดทดสอบ agent-control ยังมีข้อคาดหวังเดิมไม่ตรงพฤติกรรมปัจจุบัน 3 รายการ ซึ่งแยกจากการเปลี่ยนตำแหน่งไฟล์
