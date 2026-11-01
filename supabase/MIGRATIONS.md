# การติดตั้งและจัดลำดับ Supabase migrations

ใช้ [complete_schema.sql](complete_schema.sql) เป็นไฟล์หลักสำหรับติดตั้ง schema ใหม่หรือเติม migrations ให้ฐานเดิม เปิด **ทั้งไฟล์** ใน Supabase SQL Editor เลือก role `postgres` แล้วกด Run ครั้งเดียว ไม่ต้องไล่รัน SQL ตามชื่อไฟล์

ไฟล์นี้รวมต้นฉบับ 86 ไฟล์ตาม dependencies จาก SQL ต้นฉบับทั้งหมด 103 ไฟล์ อีก 17 ไฟล์เป็น diagnostics, reset, rollback, historical backfill หรือเครื่องมือเฉพาะงาน จึงแยกไว้พร้อมเหตุผลใน [Migration Registry](full_database_setup-manifest.md) หลัง generate จะมี SQL รวม 105 ไฟล์ รวมไฟล์ generated สองไฟล์ด้วย

## ลำดับและการรันซ้ำ

Registry อยู่ใน `groups` และ `prerequisites` ของ [build-full-database-setup.cjs](../scripts/build-full-database-setup.cjs) มีทั้งลำดับและ dependencies ของทุก migration ตัว builder จะหยุดหากพบ SQL ใหม่ที่ยังไม่ได้จัดประเภท ไฟล์หาย รายการซ้ำ หรือเรียงผิด dependency จึงไม่เปลี่ยนชื่อไฟล์ต้นฉบับ แต่กำกับเลขลำดับในไฟล์รวมและ manifest

ตัวอย่างลำดับที่สำคัญ:

| Migration                      | ต้องมีมาก่อน                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `security.sql`                 | schema, tenants, comment rules, platform, orders, automation และ billing            |
| `messenger-product-lookup.sql` | `commerce-v2.sql` และ `live-cf-variants.sql`                                        |
| `standalone-slips.sql`         | security, payments, billing-auto-approval, bank-accounts และ facebook-webhook-queue |

ตาราง คอลัมน์ และ index ใช้ `IF NOT EXISTS`; ฟังก์ชันใช้ `CREATE OR REPLACE` ส่วน policy/trigger/constraint ที่ไม่มี syntax ดังกล่าวใช้การตรวจ catalog หรือ `DROP ... IF EXISTS` ก่อนสร้างตามต้นฉบับ การติดตั้งรุ่นล่าสุดทับฐานเดิมยังรองรับ function definition รุ่นเก่าที่ถูกแทนด้วย definition รุ่นใหม่ในไฟล์เดียวกัน โดยไม่ข้ามข้อผิดพลาดของ definition สุดท้าย

`complete_schema.sql` ใช้ transaction เดียวและตาราง `public.snapbot_schema_migrations` บันทึกชื่อและ SHA-256 ของแต่ละ migration เมื่อรันไฟล์เดิมซ้ำจะข้ามรายการที่ติดตั้งแล้ว หากคำสั่งใดล้มเหลว schema และ registry ในการรันครั้งนั้นจะ rollback ทั้งหมด มี advisory lock กันการรันไฟล์นี้พร้อมกัน และจำกัดเวลารอ lock 5 วินาที / เวลาคำสั่ง 120 วินาที

Registry ภายในนี้แยกจาก migration history ของ Supabase CLI ไม่ได้อ้างว่าติดตั้งผ่าน CLI แล้ว การรันซ้ำข้ามรายการเดิมจึงไม่ใช่การซ่อมวัตถุที่ถูกลบด้วยมือหลังติดตั้ง หากแก้ไขไฟล์ที่ apply แล้ว checksum จะไม่ตรงและหยุดพร้อมข้อความ `Applied migration changed` ให้เพิ่ม migration ใหม่แทนการแก้ประวัติ

## ข้อมูลเดิมและขอบเขต

การรวมไฟล์คงข้อมูลแอป เครดิต และการตั้งค่าร้าน โดยตัด historical backfills ที่ตั้งค่าร้านใหม่ แจกเครดิต หรือสร้างงานย้อนหลังออก คงเฉพาะ seed ที่จำเป็นและ integrity backfills ของ `payment_transfer_ledger` / `payment_image_ledger` เพื่อให้หลักฐานชำระเงินเดิมยังป้องกัน replay ได้ รวมถึงเติม quota เฉพาะค่าที่เป็น null

แก้ constraint ประเภทหลักฐานให้รองรับ `package`, `sale`, `billing` และ `standalone` พร้อมกัน ป้องกัน migration สลิปอิสระลดชุดค่าที่ระบบ billing เดิมใช้ หากหลักฐานเดิมขัดแย้งกัน integrity scan จะหยุดให้ตรวจข้อมูล ไม่ยอมข้าม duplicate เพื่อให้ติดตั้งผ่าน

ไฟล์นี้ไม่ใช่เครื่องมือซ่อมข้อมูล legacy ทุกกรณี และไม่รวม reset/rollback/QA หรือ `full-access.sql` ซึ่งเป็นตัวเลือก bypass แพ็กเกจ การใช้ Supabase ต้องมี `auth.users`, storage, roles และ `supabase_realtime` อยู่แล้ว มี preflight ตรวจสิ่งเหล่านี้ก่อนสร้างตารางแอป ไม่สร้างระบบ auth จำลองบนฐานจริง

การรับฐานเดิมเข้า Registry ครั้งแรกจะใช้ function definitions มาตรฐานจากชุดนี้ หากเคยแก้ฟังก์ชันเองหรือใช้ Full Access ให้ตรวจความแตกต่างก่อนเลือกอัปเกรดทั้งชุด เครื่องมือ [safe platform migration](safe-migration.md) ยังคงแยกไว้สำหรับงานเติม platform/backfill แบบแบ่ง batch และไม่ได้ติดตั้งทุกฟีเจอร์เหมือนไฟล์รวมนี้

[full_database_setup.sql](full_database_setup.sql) ยังคงไว้สำหรับขั้นตอน bootstrap เดิมที่ใช้ **ฐานใหม่เท่านั้น** มี guard ปฏิเสธฐานที่มีตารางแอปแล้ว และใช้ transaction แยกแต่ละ source หากต้องการรันซ้ำหรืออัปเกรดให้ใช้ `complete_schema.sql` คู่มือ Messenger และ standalone slip ใช้ไฟล์รวมนี้ได้โดยไม่ต้องรัน migrations ของสองฟีเจอร์ซ้ำอีก

## สร้างไฟล์และตรวจสอบ

```powershell
npm.cmd run db:schema:build
npm.cmd run db:schema:check
npm.cmd run test:schema
```

เมื่อเพิ่ม SQL ใหม่ ให้เพิ่มไฟล์ท้าย `groups` และระบุ dependencies ใน `prerequisites` หรือใส่เหตุผลใน `excluded` ถ้าเป็นเครื่องมือเฉพาะงาน แล้ว regenerate และรันทดสอบ ห้ามแก้ไฟล์ generated โดยตรง

ชุดทดสอบใช้ PostgreSQL จำลอง PGlite แบบแยกจากฐานจริง ครอบคลุมการติดตั้งใหม่ รันซ้ำ อัปเกรดฐานเก่า/ฐานที่ติดตั้งบางส่วน รักษาข้อมูลและ proof ledger ตรวจ tenant/RLS เรียก RPC ของ Messenger/Live CF และ rollback เมื่อ checksum หรือ SQL ผิดพลาด การทดสอบไม่ได้เชื่อมต่อหรือ apply ไปยัง Supabase ของร้าน
