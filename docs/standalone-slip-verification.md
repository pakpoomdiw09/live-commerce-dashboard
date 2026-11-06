# ตรวจสลิปอิสระจาก Messenger

ระบบตรวจสอบสลิปโดยไม่สร้างออเดอร์ ไม่ตัดสต็อก และไม่เปลี่ยนสถานะชำระเงินของลูกค้า รองรับรูปสลิปจาก Messenger และบันทึกธุรกรรมที่ผ่านการตรวจใน `standalone_slips`

## ติดตั้งก่อนนำโค้ดขึ้นใช้งาน

1. รัน [complete_schema.sql](../supabase/complete_schema.sql) ทั้งไฟล์ใน Supabase SQL Editor ตาม [คู่มือ migrations](../supabase/MIGRATIONS.md) ไฟล์รวมมี `standalone-slips.sql` แล้ว ไม่ต้องรันแยกอีก หากเลือกอัปเดตเฉพาะฟีเจอร์ ให้รัน [standalone-slips.sql](../supabase/standalone-slips.sql) หลัง `security.sql`, `payments.sql`, `billing-auto-approval.sql`, `bank-accounts.sql` และ `facebook-webhook-queue.sql` พร้อม dependencies ของไฟล์เหล่านั้น
2. ผู้ให้บริการตรวจสลิปถูกเลือกแบบ global ผ่าน `SLIP_VERIFICATION_PROVIDER` (`slipok` เป็นค่าเริ่มต้น หรือ `zwiz`). ตั้ง credential ฝั่งเซิร์ฟเวอร์ของ provider ที่เลือก (`SLIPOK_BRANCH_ID`/`SLIPOK_API_KEY` หรือ `ZWIZ_API_KEY` และ optional `ZWIZ_API_URL`). ร้านต้องมีสิทธิ์ `slip_auto_pilot` และเครดิตตรวจสลิปตามระบบเดิม
3. เปิดการตรวจสลิปอัตโนมัติ `tenants.auto_verify_enabled` พร้อมการตอบอัตโนมัติ `tenants.auto_reply_enabled` และ `customers.bot_enabled` ของแชทนั้น ระบบยังใช้ Page Access Token และ Webhook `messages` เดิม
4. บัญชีรับเงินที่เปิดใช้งานใน `bank_accounts` ใช้ตรวจปลายทางตามธนาคารและเลขบัญชีที่ถูก mask หากไม่มีรายการบัญชีเลยจะสำรองจาก `tenants.account_number/bank_code` หากมีแต่บัญชีที่ปิดใช้งานจะไม่ตรวจผ่านด้วยบัญชีเก่า

หากไม่มีการตั้งบัญชีใดเลย ฟังก์ชันยังตรวจความถูกต้อง/อายุ/การใช้ซ้ำของธุรกรรมตาม SlipOK ได้ตามโหมดบัญชีปลายทางไม่บังคับ แต่ไม่ได้ยืนยันว่าเงินเข้าร้าน ต้องตั้งบัญชีรับเงินหากต้องการตรวจเงื่อนไขนี้

## ไฟล์ที่เพิ่มหรือแก้ไข

| ไฟล์                                           | หน้าที่                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `supabase/standalone-slips.sql`                | Ledger, unique reference/image hash, RLS, tenant/customer/message scope และ trigger จอง reference ใน ledger กลาง |
| `lib/features/slips/standalone-verifier.ts`    | `processStandaloneSlip(db, input)`, ดาวน์โหลด/ตรวจไฟล์, ใช้เครดิต, เรียก SlipOK, บันทึกผลและจัดการ 23505         |
| `lib/features/slips/standalone-slip.ts`        | ตรวจผล provider, อายุสลิป/ปลายทาง/ข้อมูลการเงิน และประกอบข้อความตอบกลับ                                          |
| `lib/integrations/facebook/webhook-handler.ts` | เลือกเส้นทางภาพตาม pending orders และตอบกลับผู้ส่งด้วย durable delivery                                          |
| `tests/standalone-slip.test.ts`                | ทดสอบ validation, processor, migration, ledger/RLS และ replay ข้ามโหมด                                           |
| `scripts/test-slip-automatic-gate.cjs`         | ทดสอบ Webhook, การตอบกลับ, การส่ง event ซ้ำ และการเคารพสวิตช์อัตโนมัติ                                           |

## การเรียกใช้ฟังก์ชันฝั่ง server

```ts
import { supabaseAdmin } from '@/lib/supabase/server'
import { processStandaloneSlip } from '@/lib/features/slips/standalone-verifier'

const result = await processStandaloneSlip(supabaseAdmin(), {
  tenantId, // derive จากเพจ/สิทธิ์ผู้ใช้ฝั่ง server
  slipImageUrl, // URL รูปจาก signed Messenger webhook
  customerId,
  messageId,
  maxAgeHours: 24,
  // expectedReceivingAccount: '1234567890', // optional override ฝั่ง server
})
```

ส่ง `file: File` แทน `slipImageUrl` ได้ แต่ต้องส่งอย่างใดอย่างหนึ่งเท่านั้น URL จาก Messenger ต้องเป็น HTTPS ของ Meta CDN ผ่าน downloader เดิมที่จำกัด bytes, ตรวจ magic bytes และไม่ตาม redirect ส่วนไฟล์ต้องเป็น JPG/PNG/WebP ขนาดไม่เกิน 5 MB ตัว verifier ไม่รับ URL เว็บใดก็ได้มาดาวน์โหลดบนเซิร์ฟเวอร์

ฟังก์ชันคืน `{ success, message, data? }` กรณีผ่านมี `transRef`, `amount`, `sender`, `senderBank`, `receiver`, `receiverAccount`, `transTimestamp` กรณีไม่ผ่านมี `reason` สำหรับระบบและ `message` ภาษาไทยสำหรับลูกค้า

## เงื่อนไขตรวจสอบ

- ใช้ verifier กลางที่เลือกจาก `SLIP_VERIFICATION_PROVIDER`; ทั้งสอง provider ใช้บัญชีรับเงินที่ derive จากฐานข้อมูลฝั่ง server ไม่ส่งยอดที่คาดหวังจากออเดอร์
- อ่านเวลาจาก `raw.data.transTimestamp` หรือ `transDate/transTime` ของ provider โดย fallback รูปแบบวันเวลาคิดเป็น Asia/Bangkok
- อายุย้อนหลังไม่เกิน 24 ชั่วโมง กำหนด `maxAgeHours` ให้น้อยกว่าได้ แต่เพิ่มเกิน 24 ไม่ได้ เวลาอนาคตเกิน 60 วินาทีหรือเวลาหาย/ไม่ถูกต้องไม่ผ่าน
- ใช้ account/bank matcher เดิมสำหรับบัญชีที่ตั้งไว้ ไม่เปรียบเทียบเฉพาะเลขท้าย 4 หลัก หาก SlipOK ตอบ 1014 จะยอมรับเฉพาะกรณีข้อมูลธุรกรรมถูกตรวจแล้วและปลายทางตรงบัญชีร้านที่ตั้งไว้จริง
- ต้องมียอดเงินเป็นบวกถึงหน่วยสตางค์ และ reference ที่ไม่ว่าง จึงบันทึก ledger ได้
- `UNIQUE(tenant_id, trans_ref)` และ image hash กันการบันทึกซ้ำระดับฐานข้อมูล รหัส `23505` และ provider duplicate แสดงข้อความ **“สลิปนี้เคยส่งตรวจแล้ว”**
- รูปเดิมที่ตรวจผ่านและมี hash ใน ledger แล้วจะถูกปฏิเสธก่อนเรียก provider/หักเครดิต หาก provider ขัดข้องจะคืนเครดิตหนึ่งครั้งตามกลไกเดิม
- สำเร็จได้หลังเขียน ledger สำเร็จเท่านั้น หากเขียนไม่ได้จะไม่ส่งข้อความยืนยันสำเร็จ

## Messenger routing และการตอบกลับ

เปิด Auto-Pilot + ส่งรูปที่ไม่ใช่ sticker:

1. มี pending orders ของลูกค้า/ร้านนี้ → ใช้ `processSlip` และเส้นทางชำระออเดอร์เดิม
2. ไม่มี pending orders และร้าน/แชทเปิดตอบอัตโนมัติ → ใช้ `processStandaloneSlip` แล้วตอบผลสำเร็จหรือสาเหตุที่ไม่ผ่าน
3. ปิด Auto-Pilot → ใช้เส้นทางรูปภาพ/AI เดิม ไม่เสียเครดิตตรวจสลิปอิสระ

การเลือกเส้นทางถูก checkpoint ต่อข้อความ ส่วนการตรวจและการส่งผลมี checkpoint แยกต่อรูป การ replay event จึงไม่ตรวจ/ตอบซ้ำ รูปที่เข้าการตรวจอิสระจะไม่ส่งให้ Vision/AI ตอบซ้ำอีก

ตัวอย่างผลผ่าน:

```text
✅ ตรวจสอบสลิปถูกต้องเรียบร้อย
💰 ยอดโอน: 159.25 บาท
👤 ผู้โอน: ผู้โอนทดสอบ
⏰ เวลาที่โอน: [เวลาประเทศไทยจาก provider]
📌 รหัสอ้างอิง: [transRef]
บันทึกประวัติการตรวจสลิปเรียบร้อยแล้ว
```

ตัวอย่างผลไม่ผ่าน:

```text
⚠️ ตรวจสอบสลิปไม่สำเร็จ
สาเหตุ: สลิปนี้เคยส่งตรวจแล้ว
```

Ledger เก็บเฉพาะธุรกรรมที่ผ่านตรวจ ข้อความแจ้งผลไม่ผ่านอยู่ในประวัติแชทเดิม ไม่สร้างออเดอร์สมมติหรือแก้ customer payment status

## การป้องกัน replay และการเข้าถึงข้อมูล

SQL เพิ่ม source `standalone` ใน `payment_transfer_ledger` และ claim reference ภายใน transaction เดียวกับการ insert สลิป จึงกันนำธุรกรรมที่ตรวจอิสระแล้วไปใช้เป็นหลักฐานชำระ sale/package หรือส่งข้ามร้านซ้ำได้ด้วย การตรวจอิสระนี้ไม่ได้สร้างเครดิตล่วงหน้าสำหรับชำระออเดอร์ภายหลัง

หากมีข้อมูลจากตารางตัวอย่างเก่า migration จะ backfill reference เข้า ledger กลางก่อน และหยุดติดตั้งเมื่อพบความขัดแย้งที่ต้องตรวจสอบ ประวัติใน ledger กลางไม่ถูกปล่อยให้ใช้ซ้ำเมื่อ source row ถูกลบ

เปิด RLS ให้สมาชิกอ่านเฉพาะร้านที่เข้าถึงได้ ฝั่ง browser ไม่มีสิทธิ์ insert/update/delete และ service role มีเฉพาะ select/insert บนตารางนี้ พร้อมตรวจ customer/message ว่าตรง tenant ก่อนบันทึก `raw_payload` มีข้อมูลส่วนบุคคล จึงไม่ส่งออกไปกับข้อความลูกค้าหรือพิมพ์ลง log

## ทดสอบ

```powershell
npm.cmd test
node --test scripts/test-slip-automatic-gate.cjs
npx.cmd tsc --noEmit
```

ทดสอบด้วย mock Meta/SlipOK และ PostgreSQL จำลอง PGlite ไม่มีการส่งข้อความจริง เรียก provider จริง หรือแก้ฐานข้อมูล Production

อ้างอิงสัญญา API: [SlipOK Check Slip](https://slipok.com/api-documentation/check-slip/), [SlipOK error status codes](https://slipok.com/api-documentation/error-status-code/)
