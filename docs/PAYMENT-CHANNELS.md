# ระบบรับเงินและตรวจสลิป — Payment Channels

## ขอบเขตและผลลัพธ์

ต่อยอด `/slips` เดิมเป็น 6 แท็บหลัง `PAYMENT_CHANNELS_ENABLED=true`:

| แท็บ | สิ่งที่ใช้งานได้ |
|---|---|
| QR / Barcode รับชำระเงิน | พร้อมเพย์แบบไม่ระบุยอด ระบุยอดคงที่ และตามยอดออเดอร์; นำเข้ารูป QR ที่อ่านและเทียบผู้รับได้; preview, PNG, copy, เปิด/ปิดรหัส |
| บัญชีธนาคาร | ใช้ API/RPC เดิม เพิ่มหลายบัญชี แก้ไข เปิด/ปิด ตั้งบัญชีหลัก พร้อม QR พร้อมเพย์ในบัตรบัญชีของเจ้าของร้าน |
| ประวัติการตรวจสลิป | ใช้ Payment Pro และประวัติเดิมตาม flag; ค้นหา กรอง ดูหลักฐานและ CSV ตามความสามารถเดิม; เพิ่ม mobile cards ของรายการ Pro |
| ระบบตอบกลับอัตโนมัติ | ปรับสวิตช์ auto verify/auto reply ผ่าน tenant API เดิม ไม่ส่งข้อความเมื่อเปิดหรือบันทึกหน้านี้ |
| ความปลอดภัย | สถานะตั้งค่า สิทธิ์ แพ็กเกจ ประวัติแก้บัญชีและ QR ตามสิทธิ์ |
| ตั้งค่าขั้นสูง | แสดงสถานะตั้งค่า SlipOK โควตา และเงื่อนไขจริง ไม่แสดงหรือแก้ API keys ใน browser |

มีคำอธิบายและคู่มือไทยทุกแท็บ ใช้ design system เดิม สีส้มไล่ชมพูและ grid ปรับตามขนาดจอ ไม่มีข้อมูลตัวอย่างใส่ในข้อมูล Production

ไม่ได้สร้างโปรเจกต์ใหม่ เปลี่ยน Framework แก้ `.env.local` เปลี่ยนคีย์ ตรวจสลิปจริง ทำธุรกรรม ส่ง Messenger หรือ deploy ในงานนี้

## มาตรฐานและขอบเขต QR

ใช้ `promptpay-qr` เดิมสร้าง payload และ `qrcode.react` เดิมแสดงภาพ โดยตรวจ TLV, CRC16, currency THB, country TH และ recipient กลับอีกครั้ง

- รองรับ merchant-presented PromptPay credit transfer ใน tag 29 / AID `A000000677010111` เท่านั้น
- หมายเลขผู้รับต้องตรงกับบัญชี `PROMPTPAY` ที่เปิดใช้งานของ tenant ไม่ใช้เลขบัญชีธนาคารทั่วไปแทน proxy
- รูปนำเข้าอ่านใน server ด้วย `sharp` + `jsqr`; ตรวจ MIME/magic bytes ขนาด 5 MB และจำกัดภาพที่ถอดได้ 16 ล้านพิกเซล ก่อน resize ภายใน 1600×1600
- นำเข้ารูป PNG/JPEG/WebP; ไม่รับ SVG, URL, รหัสที่ CRC ผิด ผู้รับไม่ตรง หรือมี payment scheme ที่ยังไม่รองรับ
- สร้างภาพ QR ใหม่จาก payload ที่อ่านได้ ไม่เก็บรูปนำเข้าต้นฉบับ ไม่สร้าง public storage bucket
- QR นำเข้าคงยอดเดิม ถ้ากรอกยอดหรือผูกออเดอร์ต้องตรงกับยอดในรูป หากต้องการเปลี่ยนยอดให้สร้าง QR ใหม่
- Barcode, bill-payment tag 30 และ QR ธนาคารแบบอื่นแสดงว่ายังไม่เชื่อมต่อ ไม่มี adapter ที่อ้างว่ารับชำระได้ทุกธนาคาร

อ้างอิง: [มาตรฐาน Thai QR Payment ของธนาคารแห่งประเทศไทย](https://www.bot.or.th/content/dam/bot/documents/th/our-roles/payment-systems/about-payment-systems/ThaiQRCode_Payment_Standard.pdf) และ [promptpay-qr](https://github.com/dtinth/promptpay-qr)

การตรวจรูปแบบและเทียบกับบัญชีที่ร้านบันทึก **ไม่ได้ยืนยันการลงทะเบียนหรือเจ้าของหมายเลขกับธนาคาร** ผู้ดูแลต้องตรวจชื่อผู้รับในแอปธนาคารก่อนใช้งาน ไม่มีการเรียก bank ownership API ในงานนี้

## ความปลอดภัย Backend

`GET/POST/PATCH /api/payment-codes` ใช้ signed-in user + tenant access + Owner/platform Admin + entitlement `slip_auto_pilot` จาก DB ไม่รับ actor/tenant/plan override จาก body

FREE/แพ็กเกจหมดอายุหรือถูกปิด entitlement ใช้ API ใหม่นี้ไม่ได้ STARTER/PRO ใช้ได้ตามสิทธิ์ที่ฐานกำหนด ไม่ hardcode package bypass ใน client ระบบตั้งค่าบัญชีเก่าไม่ได้เปลี่ยนสิทธิ์โดยอนุมานจากชื่อแพ็กเกจ

- Mutation ตรวจ Origin/Sec-Fetch-Site, UUID, confirmation, amount exact satang และ input size
- ไม่รับ payload QR สำเร็จจาก JSON ฝั่ง client; generate จากบัญชีจริง หรือ decode จาก File แล้วตรวจผู้รับ
- DB RPC ตรวจสิทธิ์ซ้ำ ล็อก tenant และบัญชี และตรวจ `recipient_snapshot` ที่ API ใช้สร้าง payload เพื่อป้องกันบัญชีถูกเปลี่ยนระหว่าง read/save
- QR ตามออเดอร์ใช้ยอด DB และ recheck pending status/amount ภายใต้ lock ใน transaction; ยอด browser ไม่ใช่หลักฐาน
- requestId เดิมและข้อมูลเดิมคืน record เดิม ไม่เพิ่ม audit; key เดิมกับข้อมูลอื่นถูกปฏิเสธ
- จำกัดการสร้างสำเร็จ 20 รายการ/นาที/ผู้ดูแล/ร้าน ไม่ใช่ ingress rate limit สำหรับ upload ที่ถูกปฏิเสธก่อนบันทึก หากต้องป้องกัน volumetric abuse ให้ตั้ง reverse proxy/WAF เพิ่มตาม deployment
- toggle ใช้ desired state แบบ idempotent ไม่ใช้ invert state และบันทึก audit เฉพาะเมื่อเปลี่ยนจริง
- ตารางใหม่ใช้ RLS และ service-only grants ไม่มี browser access โดยตรง และไม่มีคีย์ใน response

## การแยก QR ออกจากการยืนยันเงิน

เส้นทาง QR ไม่เรียก SlipOK, Gemini, Messenger, payment settlement หรือ credit consumption และตอบ `paymentVerified:false` เมื่อสร้างสำเร็จ

การยืนยันยังใช้ `processSlip` / Payment Pro / transfer ledger เดิม ตรวจ provider result, transRef ซ้ำ, amount, receiving account และ order snapshot ตามระบบเดิม เมื่อผ่านจึงอัปเดตออเดอร์และหยุด follow-up ใน Payment Pro transaction เดิม การส่ง confirmation ยังต้องผ่าน flag ส่งจริงและ conversation/permission policy เดิม

การผูก QR กับ order เป็น metadata ภายใน SnapBot ไม่ได้ใส่ order ID เป็น bank reference และไม่สามารถพิสูจน์ว่าเงินก้อนใดเป็นของออเดอร์นั้นจาก QR อย่างเดียว ไม่เพิ่มการยืนยันอัตโนมัติด้วยภาพหรือ AI

## การหมดความพร้อมและข้อจำกัด

- GET ไม่คืน payload หาก QR ถูกปิด บัญชีถูกปิด/เปลี่ยนผู้รับ ออเดอร์ชำระแล้ว/ยอดเปลี่ยน หรือ payload ไม่ตรงกับ snapshot
- หน้าอ่านสถานะใหม่ทุก 30 วินาที และตรวจ GET ใหม่ก่อนดาวน์โหลด/copy
- การปิด QR ใน SnapBot ไม่ยกเลิก QR ที่ดาวน์โหลด พิมพ์ หรือส่งออกไปแล้ว ไม่มี provider-side revocation สำหรับ code ชนิดนี้
- บัญชีที่มี QR ผูกอยู่มี foreign key ป้องกันการลบหลักฐาน ให้ปิดบัญชีแทน API เดิมตอบ 409 พร้อมคำอธิบาย ไม่มีการลบ QR/audit เพื่อให้ลบบัญชีผ่าน
- แสดง QR ล่าสุด 100 รายการ ออเดอร์รอชำระให้เลือก 100 รายการล่าสุด และ audit QR ล่าสุด 30 รายการ (แท็บความปลอดภัย 50 รายการ) ยังไม่มี pagination ของหน้าใหม่
- การตั้งคีย์และอนุญาตส่งจริงยังทำใน server; สถานะ “ตั้งค่าครบ” ไม่ได้ยืนยันโควตาหรือ API สด หน้านี้ไม่ยิง API เพื่อทดสอบโดยเสียเครดิต
- ยังไม่มี barcode provider, gateway webhooks ใหม่, merchant enrollment API, custom confirmation templates รายช่องทาง หรือการกระทบยอดธนาคารอัตโนมัติ

## ไฟล์และ API

ไฟล์ใหม่:

- `lib/payment-codes-core.ts` — amount/TLV/CRC/proxy validation และสัญญาข้อมูล
- `lib/payment-codes-server.ts` — authorization/flag, generator wrapper และ raster decoder
- `app/api/payment-codes/route.ts` — tenant-scoped read/create/toggle
- `supabase/payment-receiving-codes.sql` — receiving codes, immutable snapshots, audit, atomic save/toggle
- `components/slips/ReceivingCodeManager.tsx`
- `components/slips/PaymentChannelsGuide.tsx`
- `components/slips/PaymentAutomationSettings.tsx`
- `components/slips/PaymentChannelStatus.tsx`

ไฟล์ปรับปรุง:

- `app/(dashboard)/slips/page.tsx`, `SlipsDashboard.tsx`, `SlipTabs.tsx` — 6 แท็บหลัง feature flag และ query-route aliases เดิม
- `components/settings/BankAccountsManager.tsx` — QR ในบัตรบัญชี, ref latch กันคำสั่งซ้ำ และการจัดวางที่ wrap ได้
- `app/api/bank-accounts/route.ts` — ข้อความ 409 เมื่อบัญชีมี QR ผูกอยู่
- `components/slips/PaymentProDashboard.tsx` — mobile cards, ภาษาไทย, ป้องกัน review ซ้ำ และตรวจ abort หลัง parse
- `package.json`, `package-lock.json` — เพิ่ม `jsqr` และระบุ `sharp` เป็น runtime dependency โดยตรง
- Tests/fixtures: `test-payment-codes*.cjs`, `check-payment-codes-browser.cjs`, `scripts/fixtures/payment-codes/*`, compatibility fixture ใน `test-slip-single-page.cjs`

Endpoint ใหม่ไม่เปลี่ยน paths/columns/enums/keys ของ SlipOK หรือ Webhook เดิม เพิ่มเฉพาะตารางและ RPC ใหม่ ส่วน bank API เดิมยังใช้ authorization และ audit RPC เดิม

## เปิดใช้และ rollback

1. ตรวจ backup/schema/grants ของ staging และติดตั้ง dependencies เดิม: orders, feature-access, bank-accounts และ slip-bank-controls ตามลำดับ setup ของโปรเจกต์
2. รัน `supabase/payment-receiving-codes.sql` ด้วย migration/admin role รันซ้ำได้ ไม่ใช้ service_role ที่ไม่ใช่เจ้าของตารางทำ DDL
3. Deploy source/dependencies แล้วตั้ง `PAYMENT_CHANNELS_ENABLED=true` ทุก instance และ restart ตามกระบวนการของทีม
4. ตรวจ owner/staff/tenant/package cases บน staging พร้อมตรวจบัญชีจริงโดยผู้รับผิดชอบก่อนใช้งานกับลูกค้า ไม่ใช้ test fixtures เป็นข้อมูล Production

Rollback: ตั้ง `PAYMENT_CHANNELS_ENABLED=false` ทุก instance แล้ว restart กลับใช้ 2 แท็บเดิมและไม่เรียกตาราง QR ใหม่จากหน้าเดิม API ใหม่ตอบว่ายังไม่เปิดใช้งาน เก็บ receiving codes/audit ไว้ ไม่ drop/reset หรือเปิดสวิตช์ส่งจริงใด ๆ

Foreign key ที่ป้องกันลบบัญชีที่มี QR ยังคงอยู่เมื่อ rollback ให้ใช้ปิดบัญชีแทน ไม่ถอนมาตรการป้องกันข้อมูลเพื่อให้ลบผ่าน

ไม่ได้ติดตั้ง migration, เปลี่ยน environment หรือ deploy กับ Supabase จริงในงานนี้

## หลักฐานการทดสอบ

- Unit: generator จริง + CRC/TLV, phone/tax/e-wallet identifiers, open/fixed amounts, fractional satang rejection, corrupt payload และ wrong recipient
- Decoder: สร้าง QR จริงแล้ว rasterize เป็น PNG/JPEG และถอดรหัสจริงด้วย sharp/jsqr; spoofed MIME/blank image ถูกปฏิเสธ
- API: auth/owner/package denial, origin, validation, server-derived order amount/actor/tenant, multipart import, hiding paid-order payload และไม่มี payment side effects
- PostgreSQL จำลอง: migration rerun, owner/staff/foreign/free gates, order/receiver changed during save, idempotency/audit, desired-state toggle, service-only access และไม่มีการเปลี่ยนออเดอร์เป็น paid จากการสร้าง QR
- Browser: Chrome + React Strict Mode กับ client components จริงและ API fixtures ออฟไลน์; server-only status panel ถูกแทนด้วยข้อมูลทดสอบ ทดสอบ 6 แท็บที่ 375/768/1440px ไม่มี page overflow, triple click สร้างครั้งเดียว, upload form, preview ที่ถอด QR ได้จริง, ดาวน์โหลด PNG จริง, copy ผ่าน clipboard mock และหนึ่ง guide dialog
- ภาพ `docs/screenshots/payment-codes-375.png`, `payment-codes-768.png`, `payment-codes-1440.png` เป็น fixture ออฟไลน์ ไม่ใช่ session ของร้านจริง

ยังไม่ได้ยืนยันการสแกนโอนในแอปธนาคารจริง ตรวจ API สด หรือสิทธิ์ที่ติดตั้งบน production — ไม่มีการทำธุรกรรมหรือส่งข้อความจริงระหว่างทดสอบ

## ผลตรวจสอบรอบนี้

- Type Check ผ่าน
- Lint ไม่มี error มี warning เดิมนอกไฟล์ที่แก้ 9 รายการ
- Regression รวม 28 ไฟล์ ผ่าน 164 test entries รวม PostgreSQL จำลอง (SQL suite บางไฟล์นับหนึ่ง entry แต่ตรวจหลาย scenario)
- Browser offline ผ่านทั้ง 6 แท็บที่ 375/768/1440px, QR preview decode จริง, upload, download PNG, copy ผ่าน clipboard mock, triple-submit guard และคู่มือหนึ่ง dialog
- Production build ผ่าน; ไม่มีการ deploy หรือติดตั้ง SQL บน Supabase จริง
