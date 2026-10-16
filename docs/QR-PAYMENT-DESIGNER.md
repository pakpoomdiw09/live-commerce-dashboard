# SnapBot QR Payment Pro

## สิ่งที่เพิ่ม

Next.js App Router / React / Tailwind และ Supabase เดิม ไม่มีการแก้ SlipOK, Auth, Webhook, API Keys หรือสถานะการชำระเงิน

- หน้าบัญชีและเครื่องมือตกแต่งใน grid 7:3 บนจอใหญ่ จอเล็กเรียงหนึ่งคอลัมน์
- บัญชีเดิมเพิ่มคัดลอกเลขบัญชีและปุ่มเลือกตกแต่ง พร้อมเพย์ที่เปิดใช้งานเท่านั้น
- แม่แบบส้ม น้ำเงิน ชมพู ทอง มินิมอล สีพื้นหลัง/กรอบ ชื่อร้าน ข้อความ โลโก้นอก QR และตัวอย่างสด
- PNG/JPEG/WebP สูงสุด 5 MB ต่อรูป ตรวจ magic bytes, MIME และจำกัดการแตกภาพ 16 ล้านพิกเซล
- เก็บ **ไบต์รูปต้นฉบับจริง** และโลโก้ใน Supabase Storage ส่วนตัว แยกจาก JSON การตกแต่ง ไม่เก็บภาพ base64 ใน DB
- บันทึกแบบต่อบัญชีพร้อม version ตรวจการแก้ไขพร้อมกัน ตรวจบัญชีซ้ำใน transaction และบันทึก audit
- ส่งออก PNG ตรวจอ่านด้วย jsQR ว่าตรง payload เดิมก่อนดาวน์โหลด แสดง QR ที่บันทึกแล้วระหว่างแก้ยอด ต้องบันทึกก่อนส่งออก
- แจ้งเตือนก่อนออกจากหน้าที่มีข้อมูลยังไม่บันทึก มีสถานะกำลังโหลด/อัปโหลด/บันทึกและข้อความผลลัพธ์ ไม่แสดงเปอร์เซ็นต์อัปโหลดจำลอง
- เมนูเหลือบัญชี ประวัติ ระบบอัตโนมัติ ความปลอดภัย; `tab=qr` ไปบัญชี และ `tab=advanced`/`tab=settings` ไปความปลอดภัย ข้อมูลโควตาและตั้งค่าเดิมยังอยู่
- QR ตามออเดอร์และรายการ QR เดิมยังอยู่ในหัวข้อขยายด้านล่าง ไม่ลบ API/ข้อมูลเดิม

## ไฟล์

ใหม่: `components/slips/BankQrWorkspace.tsx`, `lib/qr-design.ts`, `app/api/payment-designs/route.ts`, `supabase/qr-payment-designer.sql`, ชุดทดสอบ `scripts/test-qr-designer*.cjs` และ `scripts/check-qr-designer-browser.cjs`

ปรับ: BankAccountsManager, SlipTabs, SlipsDashboard, PaymentChannelsGuide, `/slips/page.tsx`, `.env.example` และ fixture/mock เดิมสำหรับทดสอบ rollback

## การติดตั้งและย้อนกลับ

1. สำรองฐานข้อมูล ตรวจ migration เดิมตาม `docs/PAYMENT-CHANNELS.md` โดยเฉพาะ bank accounts, owner controls และ feature access
2. รัน `supabase/qr-payment-designer.sql` บน staging ก่อน สร้างตาราง `bank_qr_designs`, RPC, private bucket `payment-qr-assets` แบบ additive และรันซ้ำได้
3. ตรวจว่า bucket เป็น private migration กำหนด private และเพิ่ม restrictive policy ปิดการเข้าถึงตรงจาก anon/authenticated แม้มี policy อื่นที่เปิดกว้าง
4. เปิด `PAYMENT_CHANNELS_ENABLED=true` และ `QR_PAYMENT_DESIGNER_ENABLED=true` เมื่อ staging ผ่านและ Storage พร้อม
5. ทดสอบด้วยบัญชี Owner และผู้ใช้ร้านอื่น การเปิดหน้าต้องไม่ส่งข้อความ ไม่ตรวจสลิปจริง และไม่ตัดเครดิต

Rollback: ปิด `QR_PAYMENT_DESIGNER_ENABLED` จะกลับเป็นหกแท็บเดิม ปิด `PAYMENT_CHANNELS_ENABLED` จะกลับหน้าตรวจสลิปเดิม ไม่ต้องลบตาราง bucket หรือข้อมูลเพื่อ rollback

**ยังไม่ได้รัน migration เปิด flag หรือ deploy ในระบบจริง**

## สิทธิ์และการเก็บรูป

API ตรวจผู้ใช้จริง Owner/Platform Admin ร้านและสิทธิ์แพ็กเกจด้วย guard เดิมก่อนอ่าน Storage หรือข้อมูล ผู้ใช้อื่นในร้านดูเลขปกปิดตาม API บัญชีเดิม ไม่มี client Storage policy ตารางปิดสิทธิ์ public/anon/authenticated และใช้ service role ผ่าน API เท่านั้น การอ่านรูปผ่าน GET เดิมที่ตรวจสิทธิ์และความสอดคล้องของบัญชีทุกครั้ง พร้อม no-store/nosniff

การเปลี่ยนแบบมี optimistic version และ audit ใน transaction เดียวกัน จำกัด 20 ครั้งต่อนาทีต่อ actor/ร้าน รูปใหม่ใช้ path สุ่มไม่ทับรูปเก่า หากบันทึก DB ไม่สำเร็จลบเฉพาะรูปที่อัปโหลดในคำขอนั้น รูปเก่าที่ถูกแทนเก็บไว้สำหรับกู้คืน; ควรกำหนด retention/งานล้าง orphan ภายหลังตรวจว่าไม่มีแถวอ้างอิง กรณี process หยุดระหว่าง upload กับ commit อาจเหลือ orphan ได้ ไม่มีการลบรูปเดิมอัตโนมัติ

บัญชีที่มีประวัติ QR จะลบไม่ได้ตาม FK เพื่อรักษาประวัติ ให้ปิดใช้งานแทน การปิดบัญชีป้องกัน API แสดง/ส่งออกใหม่ แต่ไม่ยกเลิกภาพที่เคยดาวน์โหลดไปแล้ว

## วิธีใช้สำหรับเจ้าของร้าน

เพิ่ม/แก้บัญชีด้วยเครื่องมือเดิม → เลือกบัญชีพร้อมเพย์ → กดตกแต่ง QR / อัปเดตรูป → เลือก PNG/JPEG/WebP และดูรูปตัวอย่างก่อนบันทึก → เลือกแม่แบบ/สี/ชื่อร้าน/โลโก้/ข้อความ → ตรวจเลขผู้รับ → บันทึก → ดาวน์โหลด PNG → ตรวจชื่อผู้รับด้วยแอปธนาคารก่อนแจกจ่าย

เว้นช่องยอดให้ว่างเพื่อสร้าง QR ไม่ระบุยอด ใส่ยอดเพื่อสร้างใหม่หลังบันทึก การนำเข้ารูปจะใช้ยอดที่อ่านจาก QR แทนช่องยอด เพื่อรักษาความหมายเดิมของรูป การตกแต่งไม่วางโลโก้บน QR และเว้น quiet zone สีขาว 4 modules

## ข้อจำกัดและการทดสอบ

รองรับ PromptPay แบบโอนที่ตรวจโครงสร้างและเทียบกับหมายเลขร้านได้ ไม่รับรองว่าเจ้าของร้านได้ลงทะเบียนหมายเลขกับธนาคารจริง ต้องตรวจในแอปธนาคาร QR ธนาคารแบบอื่นและ Barcode ไม่มี provider เชื่อมต่อ จึงแสดงยังไม่เชื่อมต่อ ไม่สร้างรหัสรับเงินปลอม เลขอ้างอิงออเดอร์เป็น metadata เดิม ไม่เพิ่มเลขอ้างอิงธนาคารที่มาตรฐานนี้ไม่รองรับ

การทดสอบ SQL ใช้ PGlite โดยจำลอง storage.buckets; ทดสอบ API ใช้ Storage double ตรวจไบต์/path/rollback; Chrome ใช้ fixture แบบออฟไลน์ ทดสอบแม่แบบ 5 แบบอ่านกลับตรงเดิม อัปโหลด preview บันทึกครั้งเดียวเมื่อคลิกซ้ำ ดาวน์โหลด PNG โหลดกลับจาก fixture และขนาด 375/768/1440 ไม่ล้นจอ ภาพใน `docs/screenshots/qr-designer-*.png` เป็นข้อมูลทดสอบเท่านั้น

ยังไม่ได้ทดสอบ Supabase Storage จริง สิทธิ์ bucket จริง แอปธนาคารจริง หรือการชำระเงินจริง ชุดทดสอบไม่โหลดคีย์จาก .env และไม่เรียก SlipOK/Messenger

คำสั่ง: `node --test scripts/test-qr-designer.cjs scripts/test-qr-designer-api.cjs`, `npx.cmd tsc --noEmit`, `npm.cmd run lint`, `npm.cmd run build` แล้ว `node scripts/check-qr-designer-browser.cjs` (ต้องรอ build เสร็จก่อน browser เพราะอ่าน CSS จาก .next)
