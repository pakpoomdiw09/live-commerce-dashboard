# ข้อความยืนยันยอดสลิปของแต่ละร้าน

ติดตั้ง `supabase/slip-confirmation-template.sql` ใน Supabase SQL Editor หลัง schema หลักและ `platform-dashboard.sql` ก่อนใช้ปุ่ม “บันทึกข้อความ” ในแท็บ “บอทตอบกลับอัตโนมัติ” ของหน้าจัดการสลิป สามารถรัน SQL ซ้ำได้โดยไม่ลบข้อความที่บันทึกแล้ว

ตาราง `public.slip_settings` เก็บ `slip_confirmation_template` แยกตาม `tenant_id` เจ้าของร้านและผู้ดูแลระบบบันทึกผ่าน API ได้ สมาชิกของร้านอ่านได้ แต่ RLS ไม่อนุญาตให้ browser เขียนตารางโดยตรง

- `GET /api/slips/settings?tenantId=<tenant UUID>` อ่านข้อความและ `canManage`
- `PATCH /api/slips/settings?tenantId=<tenant UUID>` รับ JSON `{ "slip_confirmation_template": "ได้รับยอด {amount} บาท · {pageName}" }`
- `{amount}` แสดงยอดจริงพร้อมทศนิยมสองตำแหน่ง และ `{pageName}` ใช้ชื่อเพจจริง (fallback เป็นชื่อร้านตามระบบส่งเดิม)
- บันทึกข้อความว่างหรือ `null` เพื่อกลับไปใช้ข้อความเริ่มต้นสามบรรทัด
- ค่าที่บันทึกใหม่มีผลกับการยืนยันครั้งถัดไป ทั้งอัตโนมัติและปุ่มยืนยันของแอดมิน ข้อความเดิมในประวัติแชทไม่เปลี่ยนและไม่ส่งซ้ำ
- Messenger และ `messages.body` ใช้ข้อความที่แทนค่าชุดเดียวกัน โดยยังใช้ PSID, token ของเพจ, การป้องกันส่งซ้ำ, โควตา และเงื่อนไขส่งข้อความเดิม

หากยังไม่ได้ติดตั้งตาราง ระบบส่งสลิปเดิมยังใช้ข้อความเริ่มต้น พร้อมบันทึกคำเตือนใน server log ส่วนหน้าตั้งค่าจะแจ้งให้ติดตั้ง SQL และไม่แสดงผลว่าบันทึกสำเร็จ หากฐานข้อมูลมีข้อผิดพลาดอื่นจะไม่ส่ง template ที่อาจผิดร้าน

ทดสอบแบบจำลองโดยไม่ส่งข้อความหาลูกค้าจริง:

```powershell
node --test scripts/test-slip-confirmation-settings.cjs scripts/test-slip-messenger-confirmation.cjs
node node_modules/typescript/bin/tsc --noEmit --allowImportingTsExtensions --incremental false
npm.cmd run build
```
