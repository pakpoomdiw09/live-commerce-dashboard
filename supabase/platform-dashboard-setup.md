# Platform Owner Dashboard

เปิด `/admin` เพื่อดูภาพรวมระบบ ตรวจสอบและอนุมัติการชำระเงิน เช็กโควตา SlipOK และจัดการร้านค้า โดยแยกเมนูออกจากหน้าร้านค้า

โค้ดปัจจุบันรองรับการอนุมัติสลิปอัตโนมัติด้วย ให้รัน `billing-auto-approval.sql` เป็นไฟล์สุดท้ายตาม [คู่มืออนุมัติอัตโนมัติ](billing-auto-approval-setup.md) รายการที่ตรวจอัตโนมัติไม่ผ่านจะยังอยู่ในคิวให้ผู้ดูแลตรวจสอบ

## ติดตั้งฐานข้อมูล

ในฐานข้อมูลที่ติดตั้งระบบร้านค้าแล้ว ให้รัน `billing-slip-topups.sql` และ `admin-feature-bypass.sql` ก่อน แล้วรัน `platform-dashboard.sql` ทั้งไฟล์ใน Supabase SQL Editor สามารถรันซ้ำได้โดยไม่ล้างยอดเครดิตเดิม

เมื่อรัน `security.sql`, `billing.sql`, `payments.sql` หรือไฟล์สิทธิ์ผู้ดูแลใหม่ ให้รันส่วนเติมสลิปและสิทธิ์ผู้ดูแลตามลำดับเดิม และรัน `platform-dashboard.sql` เป็นไฟล์สุดท้าย

## สิทธิ์ผู้ดูแล

Platform administrators must have an explicit row in `public.platform_admins`. Auth metadata never grants platform access.

เพิ่มเจ้าของระบบผ่าน SQL Editor โดยแทนอีเมลจริง:

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'owner@example.com'
on conflict do nothing;
```

ผู้ใช้ทั่วไปที่เปิด `/admin` จะกลับไป `/dashboard` และ API จัดการแพลตฟอร์มจะตอบ 401/403 แม้เรียก URL โดยตรง หน้านี้ไม่ต้องเลือกร้านค้าก่อนเข้าใช้

## พฤติกรรม

- รายได้เดือนปัจจุบันตาม Asia/Bangkok รวมคำสั่งซื้อที่อนุมัติ (`billing_requests.decided_at`) และแพ็กเกจที่ชำระสำเร็จ (`payment_sessions.paid_at`) ไม่รวมรายการรอชำระเงิน ไม่ใช่ยอดขายสินค้าของร้านค้า
- ร้านค้าแนบสลิปกับคำสั่งซื้อที่รออนุมัติได้จากประวัติใน `/billing` ไฟล์อยู่ใน bucket `billing-proofs` แบบ private เปิดด้วยลิงก์ที่หมดอายุใน 120 วินาที และไม่ให้เปลี่ยนไฟล์หลังแนบแล้ว
- หน้าอนุมัติใช้ RPC เดิมที่ล็อกคำสั่งซื้อและร้านค้าใน transaction การอนุมัติซ้ำไม่เพิ่มเครดิตซ้ำ แพ็กเกจเพิ่มเครดิตแพ็กเกจ บรอดแคสต์เพิ่ม `broadcast_topup_credits` และตรวจสลิปเพิ่ม `slip_quota_credits` รายการเก่าที่ไม่มีสลิปยังอนุมัติจากรายการเดินบัญชีได้
- แพ็กเกจที่ชำระผ่าน QR และตรวจสลิปอัตโนมัติสำเร็จยังเปิดใช้งานทันทีตามระบบเดิม จึงไม่อยู่ในคิวคำสั่งซื้ออนุมัติด้วยผู้ดูแล
- Provider Balance อ่านโควตาจริงจาก [SlipOK Check Slip Quota](https://slipok.com/api-documentation/check-slip-quota/) โดยใช้ `SLIPOK_BRANCH_ID` และ `SLIPOK_API_KEY` ฝั่งเซิร์ฟเวอร์ จะแสดงข้อความเมื่อยังไม่ตั้งค่าหรือเรียก API ไม่สำเร็จ
- เปลี่ยนเป็น Starter/Pro จะให้เครดิตแพ็กเกจตามจำนวนที่กำหนดและอายุ 30 วัน Free ใช้เครดิต 200 ข้อความตามรอบเดือน ทั้งสองโควตาที่เติมสะสมยังคงเดิม การเปลี่ยนแพ็กเกจโดยผู้ดูแลไม่บันทึกเป็นรายได้
- ปิดร้าน: สมาชิกเข้าอ่านข้อมูลผ่าน RLS หรือใช้งาน API ของร้านไม่ได้ หน้าแสดงสินค้าสาธารณะปิด และหยุดงาน webhook/follow-up ที่เริ่มประมวลผลหลังปิดร้าน งานที่ส่งไปแล้วไม่สามารถเรียกคืนได้ ผู้ดูแลระบบยังเข้าจัดการร้านได้
- ประวัติการเปลี่ยนแพ็กเกจและสถานะร้านเก็บใน `platform_tenant_audit` พร้อมผู้ดำเนินการ ไม่มีโทเค็นหรือเลขบัญชีใน audit

## ตรวจสอบ

```powershell
npx.cmd tsc --noEmit
node scripts/test-platform-dashboard-sql.cjs <path-to-@electric-sql/pglite>
node scripts/test-platform-dashboard-api.cjs
```

ชุดทดสอบใช้ฐานข้อมูลจำลองและ mock API ไม่อ่าน `.env.local` และไม่ติดต่อฐานข้อมูลจริง
