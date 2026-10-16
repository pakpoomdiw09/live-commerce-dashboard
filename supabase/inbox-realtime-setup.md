# Inbox / Live Chat Realtime

Inbox ใช้ Supabase Realtime `postgres_changes` อยู่แล้ว โค้ดปัจจุบันเพิ่มการคืนข้อมูลหลัง reconnect และการตรวจซ้ำทุก 30 วินาที รวมถึงเมื่อเบราว์เซอร์กลับมาออนไลน์หรือกลับมาเปิดแท็บ ไม่มีการส่งข้อความทดสอบไปหาลูกค้า

## การโหลดข้อมูลและสิทธิ์

- `app/(dashboard)/inbox/page.tsx` อ่านรายชื่อบทสนทนาจาก `customers` พร้อม preview จาก `messages` และสถานะจาก `slips` โดยกรอง `tenant_id` ของร้านที่เลือก ความคิดเห็นอ่านจาก `comments` ของร้านเดียวกัน
- `components/inbox/InboxClient.tsx` โหลดประวัติผ่าน Supabase browser client โดยตรง ไม่มี GET API แยกสำหรับโหลดบทสนทนา Query ข้อความกรอง `customer_id` และ join `customers!inner(tenant_id)` พร้อมกรองร้านอีกชั้น Query สลิปกรองทั้ง customer และ tenant
- `security.sql` บังคับ RLS ของข้อความผ่าน customer → tenant → membership สมาชิกจึงอ่านแชทร้านอื่นที่ไม่มีสิทธิ์ไม่ได้ แม้เรียก Supabase โดยตรง
- `/api/messages/send` ตรวจสิทธิ์ผู้เรียกกับ tenant ของ customer ก่อนส่งผ่าน Page token ของร้านนั้น

## Realtime

Channel ใช้ชื่อ `inbox:<tenantId>` ฟังข้อความ INSERT/UPDATE/DELETE และการเปลี่ยนแปลง customers/comments/slips ความคิดเห็นและสลิปมี tenant filter ที่ subscription ข้อความไม่มี tenant_id โดยตรง จึงใช้ RLS ฝั่ง Supabase และตรวจ customer ของร้านที่เลือกใน handler; customer ที่ยังไม่รู้จักจะโหลดกลับด้วย query ที่กรอง tenant ก่อนนำมาแสดง การย้าย customer ออกจากร้านยังถูกนำออกจากรายการได้

ข้อความใหม่เพิ่มทันทีและรวมตาม ID ไม่ซ้ำ ข้อความที่เข้าระหว่างโหลด snapshot จะถูก replay เพื่อไม่ให้ response เก่าลบข้อความใหม่ การ reconnect โหลดทั้งรายชื่อและแชทที่เปิดอยู่โดยไม่ต้องรีเฟรชหน้า มีข้อความแจ้งเตือนเมื่อ Realtime ขัดข้อง และ cleanup channel/timer/listener เมื่อออกจากหน้าหรือเปลี่ยนร้าน

ตารางทั้งสี่ต้องอยู่ใน publication `supabase_realtime` ซึ่ง `schema.sql` ตั้งค่าไว้แล้ว ถ้ายังไม่ได้เปิดหรือย้ายฐานข้อมูลใหม่ ให้รัน `inbox-realtime.sql` หลัง schema/security สามารถรันซ้ำได้ และไม่เปลี่ยนสิทธิ์ RLS

## ตรวจสอบ

```powershell
node scripts/test-inbox-realtime.cjs
node scripts/test-dashboard-page-scope.cjs
npx.cmd tsc --noEmit
npm.cmd run build
```

ทดสอบสองเบราว์เซอร์ด้วยบัญชีที่มีสิทธิ์ในร้านเดียวกัน ส่งข้อความจาก Messenger แล้วตรวจว่าห้องที่เปิดและ preview เปลี่ยนทันที จากนั้นปิดเครือข่ายชั่วคราว เปิดกลับ และตรวจว่าข้อความตกหล่นกลับมา เปลี่ยนร้านและตรวจว่าไม่มีข้อมูลของร้านก่อนหน้าค้างอยู่
