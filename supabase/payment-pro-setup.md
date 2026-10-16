# ติดตั้ง Payment Verification Pro แบบปิดเป็นค่าเริ่มต้น

1. สำรองข้อมูลและใช้ Staging ก่อน Production
2. ตรวจว่าติดตั้ง migration เดิมครบ: `payments.sql`, `billing-auto-approval.sql`,
   `bank-accounts.sql`, `feature-access.sql`, `smart-inbox.sql` และ `smart-follow-ups.sql`
3. รัน `payment-pro.sql` ท้ายสุด สคริปต์เพิ่มตาราง/ฟังก์ชันและ Guard ไม่ล้างข้อมูล
4. ยังไม่ต้องแก้ `.env.local` หากยังไม่เปิดทดสอบ ระบบเดิมจะทำงานเมื่อไม่มี
   `PAYMENT_PRO_ENABLED=true` หรือยังไม่มี tenant opt-in
5. สำหรับ Staging ที่ได้รับอนุญาต ให้ผู้ดูแลฐานข้อมูลเพิ่มแถว `payment_pro_settings`
   ของร้านทดสอบ ตั้ง `enabled=true` และเริ่มด้วย flags:

```json
{
  "riskEngine": true,
  "advancedDashboard": true,
  "analytics": true,
  "orderMatching": true,
  "autoConfirmation": false,
  "messengerAutomation": false
}
```

6. ตั้ง master switch เฉพาะเซิร์ฟเวอร์ทดสอบและรีสตาร์ต ทดสอบด้วย Mock Provider ก่อน
   ใช้ `SLIPOK_API_KEY` / `SLIPOK_BRANCH_ID` เดิม ไม่สร้างหรือเปลี่ยน Key
7. เปิด `/slips` ด้วยผู้ใช้ Starter/Pro ที่แพ็กเกจยังไม่หมดอายุ ตรวจรายการ/สถิติ/CSV
   เจ้าของร้านตรวจหลักฐานและอนุมัติได้เฉพาะผล Provider ที่ครบเงื่อนไข
8. ตรวจผ่าน Inbox ของลูกค้าที่มีออเดอร์ค้างชำระ เพื่อจับคู่ยอดจากฐานข้อมูลจริง
   อัปโหลดแบบไม่ผูกลูกค้า/ออเดอร์จะเข้า Review ไม่ใช้ยอดที่พิมพ์จากหน้าเว็บไปตัดออเดอร์
9. งานกู้คืนเรียก `POST /api/cron/payment-pro` พร้อม `Authorization: Bearer <CRON_SECRET>`
   หรือใช้ INTERNAL_API_SECRET หากไม่ได้ตั้ง CRON_SECRET ห้ามใส่ secret ใน URL
10. การยืนยันอัตโนมัติต้องเปิด `autoConfirmation` และ `orderMatching` ด้วยสิทธิ์ backend
    การส่ง Pro Messenger เพิ่มเติมต้องเป็น Production + `PAYMENT_PRO_SEND_ENABLED=true`
    + tenant `messengerAutomation=true` ห้ามเปิดหรือทดสอบกับลูกค้าจริงโดยยังไม่ได้รับอนุญาต

Emergency: `PAYMENT_PRO_KILL_SWITCH=true` จะพักเฉพาะฟังก์ชัน Pro ระบบตรวจสลิปเดิมยังทำงาน
หากต้องหยุดตรวจอัตโนมัติทั้งหมด ให้ปิดสวิตช์ auto-verify ของร้านเดิมด้วย
Rollback ฐานข้อมูลใช้ `payment-pro-rollback.sql` หลังได้รับอนุญาต สคริปต์เพียงปิด tenant
opt-in และเก็บเครดิต หลักฐาน ออเดอร์ Ledger และประวัติไว้ครบ ห้ามลบ Ledger เพื่อใช้สลิปซ้ำ

คำสั่งในเครื่อง:

```powershell
npm.cmd run dev
node --test scripts/test-payment-pro.cjs scripts/test-slipok-request.cjs scripts/test-slip-order-total.cjs
node scripts/test-payment-pro-sql.cjs "<path-to-@electric-sql/pglite>"
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
```

รายละเอียดไฟล์ ขอบเขต API ผลทดสอบ และข้อจำกัด:
[Payment Pro implementation](../docs/payment-pro-implementation.md)
