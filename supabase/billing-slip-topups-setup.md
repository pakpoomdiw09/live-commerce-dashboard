# แยกเครดิตบรอดแคสต์และโควตาตรวจสลิป

สำหรับฐานข้อมูลที่ติดตั้ง `platform.sql`, `billing.sql` และ `payments.sql` แล้ว ให้รัน `billing-slip-topups.sql` ใน Supabase SQL Editor ก่อนใช้โค้ดรุ่นนี้ สามารถรันซ้ำได้ และรองรับฐานข้อมูลที่ติดตั้ง `admin-feature-bypass.sql` แล้ว

สำหรับการติดตั้งใหม่ ให้รัน `billing-slip-topups.sql` หลัง `billing.sql` และ `payments.sql` หากรัน `platform.sql` หรือ `billing.sql` ใหม่ในภายหลัง ให้รัน `payments.sql`, `billing-slip-topups.sql` และ `admin-feature-bypass.sql` ตามลำดับเพื่อคงพฤติกรรมเครดิตที่ซื้อและสิทธิ์ผู้ดูแล

- บรอดแคสต์: `broadcast_credits` คือเครดิตแพ็กเกจ และ `broadcast_topup_credits` คือเครดิตเติมสะสมที่ไม่หมดอายุ การอนุมัติ `topup_s/m/l` เพิ่มเฉพาะคอลัมน์สะสมเดิม ป้องกันยอดเติมถูกรีเซ็ตเมื่อขึ้นรอบเดือน
- ตรวจสลิป: `slip_quota_credits` คือสิทธิ์ที่ซื้อสะสม การอนุมัติ `slip_topup_s/m/l` เพิ่มเฉพาะคอลัมน์นี้ ยอดคงเหลือคือ `max(slip_quota + slip_quota_credits - slip_used, 0)`
- การตรวจสลิปเพิ่ม `slip_used` แบบ atomic และหยุดเมื่อโควตารวมหมด การคืนสิทธิ์กรณีผู้ให้บริการขัดข้องลด `slip_used` ตามระบบเดิม
- ทั้งสองกลุ่มเติมได้สำหรับ Starter/Pro ตามข้อจำกัดเดิม ผู้ดูแลที่ได้รับยกเว้นยังใช้งานได้ตามระบบเดิม
- คำสั่งซื้อเดิมและยอดเดิมยังคงอยู่ การอนุมัติซ้ำไม่เพิ่มยอดซ้ำ

ตรวจสอบโดยใช้ฐานข้อมูลทดสอบภายในเครื่อง:

```powershell
node scripts/test-billing-slip-topups.cjs <path-to-@electric-sql/pglite>
```
