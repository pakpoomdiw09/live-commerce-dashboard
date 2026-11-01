# SnapBot / Live Commerce — Architecture & Security Audit

วันที่ตรวจ: 1 พฤศจิกายน 2026 (Asia/Bangkok) · Source revision: `682b3e8`

**ผลประเมิน: ยังไม่พร้อมรับรองการใช้งาน Production แบบครบวงจร** มีพื้นฐาน Webhook, HMAC, tenant isolation, atomic stock และ idempotency ที่ดี แต่ยังมีข้อบกพร่องเรื่องสิทธิ์สถานะการเงิน การผูกสลิปกับออเดอร์ การเข้าหน้าชำระเงิน และการกู้คืนข้อความที่ส่งไม่สำเร็จ

การตรวจนี้ไม่แก้ application logic ไม่รัน migration บนฐานข้อมูลจริง และไม่ส่งข้อความ/สลิปไป Meta หรือ SlipOK จริง รายงานและตัวอย่างแก้ไขด้านล่างจึงไม่ใช่การยืนยันว่าได้แก้ช่องโหว่แล้ว

## ขอบเขตและหลักฐาน

- สำรวจไฟล์ที่ติดตามใน Git 900 ไฟล์ สแกนไฟล์ข้อความ/โค้ด 822 ไฟล์ และทำ inventory API routes 89 เส้นทาง การสแกนทั้ง repository ไม่เท่ากับการตรวจทุกบรรทัดด้วยมือ; ตรวจเชิงลึกในเส้นทาง Live CF, checkout/stock, payment/slip, Messenger, authentication, grants/RLS, Webhook queue และ configuration
- ใช้ PGlite รัน SQL จริงในฐานข้อมูลจำลอง รวมทั้ง `full_database_setup.sql` ที่ commit อยู่ และใช้ mocks ตรวจจุดเชื่อมต่อภายนอก
- ตรวจ `.env`/`.env.local` เฉพาะสถานะการตั้งค่า ไม่เผยแพร่ค่าคีย์ เปรียบเทียบค่าความลับที่ตั้งไว้กับไฟล์ที่ติดตามใน Git โดยไม่พิมพ์ค่าจริงออกมา
- ไม่ได้ตรวจสิทธิ์ในฐานข้อมูล Production, Vercel environment, Meta App Review/Page permissions, external scheduler, traffic/load จริง หรือ backup/restore จึงยังยืนยันสภาพการติดตั้งจริงไม่ได้
- ไม่ได้ทำ penetration test บนระบบออนไลน์ และไม่ได้ทำ production build ใหม่; ผลด้าน build ในรายงานจำกัดอยู่ที่ TypeScript/lint/tests และ dependency inspection

## 1. Ready — ส่วนที่ยืนยันได้จากโค้ดและการทดสอบ

| ส่วนประกอบ                | สิ่งที่ยืนยันได้                                                                                                                                                                                                                 | เงื่อนไข/ข้อจำกัด                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Webhook ingress           | `/api/webhook`, `/api/webhooks`, `/api/webhook/facebook`, `/api/webhooks/facebook` ใช้ `postFacebookWebhook` ร่วมกัน ตรวจ HMAC SHA-256 จาก raw bytes และ `timingSafeEqual` ก่อน enqueue; ไม่มี secret ตอบ 503, ลายเซ็นผิดตอบ 401 | ต้องติดตั้ง queue RPC และตั้ง Meta App Secret จริง                                                                      |
| Input limits              | จำกัด Webhook 2 MiB และ 1,000 events รวมถึงตรวจขนาดระหว่างอ่าน stream                                                                                                                                                            | ไม่มี freshness check ที่แทน idempotency ได้; การป้องกัน replay อาศัยคีย์ event/ออเดอร์ด้วย                             |
| Live CF                   | normalize `live_comments`/`feed`, ผูกเพจกับ active tenant, กรองกฎตามเพจ/โพสต์ และหยุดเมื่อหลายกฎกำกวม                                                                                                                            | flexible mode ยังมี false positives ตาม F10                                                                             |
| Strict matching           | `match_type=exact` ถูกตีความเป็น strict; เปรียบเทียบทั้งข้อความหลัง normalize ไม่ใช่ substring                                                                                                                                   | strict ของรหัส `159` จะไม่รับ `CF 159` หากตั้ง keyword เป็น `159`                                                       |
| Atomic stock              | checkout/Live CF ใช้ SQL transaction กับ `FOR UPDATE` บน tenant/product/variant และตรวจ stock ก่อนลด; มี `CHECK(stock>=0)`                                                                                                       | การันตีนี้ใช้เส้นทางที่หัก stock; `live_deduct_stock=false` เป็นข้อยกเว้นโดยตั้งใจ ไม่ควรอ้างว่าทุกโหมดกัน overselling  |
| Order idempotency         | `unique(tenant_id,request_key)` สำหรับ storefront และคีย์ source/comment สำหรับ CF รวมทั้ง checkpoint ของ Webhook                                                                                                                | ลูกค้าส่งคนละ comment ID หรือคนละ request key ถือเป็นคนละคำสั่งซื้อ                                                     |
| Payment link cryptography | ลงลายเซ็น `orderId.expires` ด้วย HMAC SHA-256; ตรวจ UUID, signature แบบ constant-time และ expiry                                                                                                                                 | เป็น bearer link สำหรับดูข้อมูล ไม่ใช่การพิสูจน์ตัวผู้โอน; มีข้อขัดข้องการเข้าหน้าตาม F03                               |
| ป้องกันสลิปที่เคยใช้แล้ว  | SlipOK `log:true`, unique `trans_ref`, image hash สำหรับ package/Pro และ permanent `payment_transfer_ledger` ร่วม sale/package                                                                                                   | ต้องติดตั้ง `payments.sql`; การกันธุรกรรมซ้ำไม่ครอบคลุมธุรกรรมเก่าที่ยังไม่เคยเข้าระบบตาม F02                           |
| Tenant isolation          | API หลักใช้ `getActor`/tenant scope; browser ใช้ RLS; bundle จำลองไม่มี public application table ที่ปิด RLS และ authenticated อ่าน Page Access Token ไม่ได้                                                                      | service-role bypass RLS จึงต้องรักษาการตรวจสิทธิ์ในทุก server route; ไม่พบการอ่านข้อมูลข้ามร้านที่ยืนยันได้ในการตรวจนี้ |
| Inbound Messenger         | มี route `product-reply` ก่อน AI; `CF159`, `FC159`, `FC 1`, `1`, `สนใจ 09` สกัดรหัสได้; ค้น tenant-scoped RPC แล้วส่ง Generic Template Card พร้อม URL                                                                            | ต้องติดตั้ง `messenger-product-lookup.sql`, เปิดร้าน/บอต/เซลเพจ และมี public app URL                                    |
| Messenger fallback        | ไม่พบสินค้า/ไม่ใช่รหัส/รหัสกำกวม ปล่อยต่อแชทเดิม; inquiry ไม่สร้างออเดอร์หรือตัด stock; ใช้ durable delivery key                                                                                                                 | ไม่ใช่การยืนยันว่าข้อความถูกส่งถึง Meta จริง และยังมี F05                                                               |

โค้ดสำคัญ: [signature parser](../lib/integrations/facebook/webhook-envelope.ts#L23), [shared HTTP handler](../lib/integrations/facebook/webhook-http.ts#L41), [live ordering](../supabase/live-cf-setup.sql#L94), [checkout](../supabase/commerce-v2.sql#L91), [payment token](../lib/features/commerce/live-cf-payment-link.ts#L33), [transfer ledger](../supabase/payments.sql#L40), [Messenger routing](../lib/integrations/facebook/webhook-handler.ts#L373)

## 2. Findings — เรียงตามความเร่งด่วน

### F01 — High / Security: staff เปลี่ยนสถานะออเดอร์เป็น paid ได้โดยไม่มีหลักฐาน

**หลักฐาน:** [security.sql:135](../supabase/security.sql#L135) อนุญาต UPDATE ภายใน tenant และบรรทัด 139 ให้ `update(status)` แก่ `authenticated`; membership policy ไม่จำกัด role เป็น owner ส่วน [ShopClient.tsx:105](../components/shop/ShopClient.tsx#L105) ยังอัปเดตโดยตรงจาก browser ได้ ผ่านหน้า legacy `/shop?legacy=1` หรือ Supabase client โดยตรง

Probe ด้วย role `authenticated` และสมาชิก `staff`: เห็นออเดอร์ร้านตัวเอง 1 รายการ มองไม่เห็นร้านอื่น และเปลี่ยน `pending_payment → paid` ได้โดย `slip_id = NULL` แม้ติดตั้ง [Payment Pro guard](../supabase/payment-pro.sql#L239) เพราะ guard ตรวจเฉพาะเมื่อมี Pro attempt ของ `new.slip_id`

**ผลกระทบ:** ข้ามข้อกำหนด owner-only ของ `/api/slips/[id]/approve`; สถานะการเงิน/รายงาน/การจัดส่งเปลี่ยนโดยไม่มีหลักฐานหรือ audit trail ของการอนุมัติ นี่เป็นปัญหาสิทธิ์ภายในร้าน ไม่ใช่การรั่วข้อมูลข้าม tenant หากธุรกิจตั้งใจให้ staff ยืนยันรับเงินเอง ต้องกำหนดนโยบายนี้อย่างชัดเจนและบันทึกผู้อนุมัติ

**แก้ไข:** ย้าย `ShopClient.moveOrder` ไป server route ที่ตรวจ role/transition/หลักฐาน แล้วถอน direct UPDATE โดยต้องถอนทั้ง table และ column grants ตัวอย่างอยู่ในหัวข้อ 4

### F02 — High / Security: legacy slip verification ยอมรับธุรกรรมเก่าที่ยังไม่เคยเข้าระบบ

**หลักฐาน:** [process.ts:161](../lib/features/slips/process.ts#L161) ตรวจยอด บัญชีรับเงิน และ reference แต่ไม่เทียบ `transDate/transTime` กับเวลาออเดอร์และเวลาปัจจุบัน Probe mock คำตอบ SlipOK ที่ถูกต้องของธุรกรรมวันที่ `2025-01-01`, reference ที่ไม่เคยใช้ และยอดตรงกับออเดอร์ใหม่: ได้ verdict `valid` และเรียก mark current orders paid

**ผลกระทบ:** ลูกค้าอาจใช้การโอนเก่าที่เคยจ่ายนอกระบบและไม่มีใน ledger มาจ่ายออเดอร์ใหม่ การมี unique reference กันเฉพาะธุรกรรมที่ระบบเคยเห็น ไม่พิสูจน์ว่าเงินโอนนั้นเป็นของออเดอร์ปัจจุบัน

**ขอบเขต:** เป็น legacy path เมื่อ Payment Pro ไม่ได้เปิดใช้หรือไม่เข้าร่วม `riskEngine`; ใน configuration ไฟล์ local ที่ตรวจ `PAYMENT_PRO_ENABLED` ยังไม่ถูกตั้ง ส่วน Pro มี [PAYMENT_TIME_INVALID](../supabase/payment-pro.sql#L174) และ order snapshot อยู่แล้ว จึงไม่ควรเหมารวมว่าทั้งสองเส้นทางมีปัญหาเดียวกัน

**แก้ไข:** ใช้ข้อมูลวันเวลาที่ provider ตรวจสอบแล้ว บังคับอายุธุรกรรม/ช่วงเวลาหลังสร้างออเดอร์ และส่งเข้า manual review เมื่อขาด timestamp หรือเป็นเงินโอนล่วงหน้า โดยมี flow แยกที่ตรวจสอบได้สำหรับเครดิตล่วงหน้าจริง

### F03 — High / Availability: ลูกค้าที่ไม่ล็อกอินเปิดลิงก์ HMAC ไม่ได้

**หลักฐาน:** [PUBLIC_PATHS](../lib/supabase/middleware.ts#L7) ไม่มี `/pay/live`; [middleware fallback](../middleware.ts#L10) ก็ไม่มีเส้นทางนี้ ทดสอบ token ที่ signature ถูกต้องแล้ว `updateSession` ยังคืน redirect ไป `/login` สำหรับ anonymous user ก่อนเข้าหน้า token verifier

**ผลกระทบ:** ผู้ซื้อจาก Facebook ถูกขอให้ล็อกอิน dashboard ทั้งที่ลิงก์ควรเปิดหน้าชำระเงินได้ด้วย token

**แก้ไข:** เพิ่มเฉพาะ `/pay/live` ลง public paths และ fallback โดยคงการตรวจ token ก่อน query ไว้ ไม่เปิด `/pay` ทั้งหมดโดยไม่มีเหตุผล

### F04 — High / Correctness: ยอดที่แจ้งในแชทไม่ตรงกับยอดในหน้าชำระเงินเมื่อมีหลายออเดอร์

**หลักฐาน:** [live-cf-comment.ts:64](../lib/features/commerce/live-cf-comment.ts#L64) รับยอด pending รวมและ [ข้อความ default](../lib/features/commerce/live-cf-comment.ts#L88) แจ้งยอดรวมนั้น แต่ลิงก์ผูกกับ order ID เดียวและ [payment page:75](../app/pay/live/[token]/page.tsx#L75) แสดง `orderData.amount` เพียงรายการเดียว ส่วน `processSlip` เทียบกับ pending total รวม

**ตัวอย่างยืนยัน:** ลูกค้า CF สินค้า 159 บาทสองรายการ แชทแจ้ง 318 บาท ลิงก์แสดง 159 บาท หากโอนตามหน้า ระบบตรวจสลิปจะเทียบกับ 318 บาทและไม่ผ่าน

**แก้ไข:** ใช้ payment session ที่บันทึก order IDs และยอดรวมเป็น snapshot เดียวกัน แล้วให้ token/page/slip verifier ใช้ session นี้ร่วมกัน หากจะรับชำระทีละ order ต้องทำให้แชทและ slip matching เป็นทีละ order ทั้ง flow

### F05 — High / Reliability: Graph API ถูกจำกัดอัตราส่งแล้วข้อความอาจค้างโดยไม่ retry

**หลักฐาน:** [client.ts:225](../lib/integrations/facebook/client.ts#L225) มี timeout แต่ไม่มี policy ที่อ่าน rate-limit headers/`Retry-After` หรือจัดคิวใหม่; [once](../lib/integrations/facebook/webhook-worker.ts#L139) เปลี่ยน error จาก side effect เป็น `WebhookNeedsReview` และ [worker:192](../lib/integrations/facebook/webhook-worker.ts#L192) จบ message event เป็น `completed` หากบันทึก inbound แล้ว Probe explicit simulated rate-limit หลัง persist ให้ `outcome=completed, retried=0, sideEffectFailed=1`

[deliverRichOnce](../lib/features/slips/notify.ts#L132) มีประโยชน์ในการกันส่งซ้ำ แต่ durable key ที่ถูก claim ไปแล้วไม่ใช่กลไกกู้คืน rejected send; comment private reply ยังทิ้งรายละเอียด HTTP เมื่อแปลงเป็น generic Error

**ข้อดีที่ต้องรักษา:** ไม่ replay POST อัตโนมัติเมื่อ timeout/ไม่ทราบผลส่ง ช่วยกันลูกค้าได้รับข้อความซ้ำ

**แก้ไข:** เพิ่ม durable outbox แยก `rejected-retryable`, `accepted`, `unknown`, เก็บ provider code/`is_transient`/retry time แล้ว retry เฉพาะ explicit rejection ที่ทราบว่าไม่ส่งสำเร็จ ส่วน `unknown` ให้ reconcile/manual review ห้ามใส่ generic retry ครอบทุก Graph POST

### F06 — High / Reliability: legacy บันทึกสลิป valid กับเปลี่ยนออเดอร์ paid คนละ transaction

**หลักฐาน:** [process.ts:238](../lib/features/slips/process.ts#L238) บันทึกสลิปก่อน [markOrdersPaid](../lib/features/slips/process.ts#L319) ซึ่งเพียง log เมื่อ update error และไม่ตรวจจำนวนแถวที่เปลี่ยน อีกทั้ง snapshot pending ถูกโหลดก่อนเรียก provider ซึ่งอาจใช้เวลาถึง 20 วินาที

**กรณีผิดพลาด:** DB เขียนสถานะ order ไม่สำเร็จ หรือแอดมินยกเลิก order ระหว่างรอ SlipOK ระบบยังคืนสลิป `valid` ได้และอาจส่งคำยืนยัน ในขณะที่ order ไม่ได้เป็น paid และธุรกรรมถูกจองใน ledger แล้ว

**แก้ไข:** ย้าย finalize ไป service-only RPC transaction เดียว: lock tenant/customer/orders/slip ด้วยลำดับคงที่ → ตรวจจำนวน order และยอด snapshot → claim transfer ledger → update slip/orders → commit แล้วจึง enqueue notification แนวทาง Pro ที่มีอยู่ช่วยเป็นฐานได้ แต่ต้องตรวจการเปิด flags และติดตั้ง migration ให้ครบ

### F07 — High / Deployment: ชุดติดตั้งฐานข้อมูลกับโค้ดปัจจุบันไม่ตรงกัน

**หลักฐาน:** `node scripts/build-full-database-setup.cjs --check`/ชุดทดสอบ full setup ปฏิเสธ SQL 14 ไฟล์ที่ยังไม่ได้ classify รวม `live-cf-variants.sql`, `live-cf-mode.sql`, `live-cf-setup.sql`, `messenger-product-lookup.sql` และ migration บัญชี/AI/vision อื่น ๆ [ตัวตรวจรายการ](../scripts/build-full-database-setup.cjs#L178)

ไฟล์ `full_database_setup.sql` ที่ commit อยู่รันบน fixture ได้และเปิด RLS ให้ทุก application table แต่ไม่รวม migration Live CF/Messenger ข้างต้น การรัน SQL รวมเพียงไฟล์เดียวจึงไม่ทำให้ feature ใหม่พร้อมใช้งาน

**configuration local:** ไม่พบการตั้ง `LIVE_CF_PAYMENT_LINK_SECRET`, `LIVE_CF_APP_URL`, `NEXT_PUBLIC_APP_URL` หรือ `VERCEL_PROJECT_PRODUCTION_URL` ในไฟล์ env ที่ตรวจ ส่งผลให้ private payment-link setup ไม่พร้อม และ Messenger default sales-page URL ประกอบไม่ได้ นี่ไม่ใช่ข้อสรุปว่า Production environment ขาดเหมือนกัน

**แก้ไข:** review และจัดลำดับ migration ตาม dependency ให้ครบ สร้าง bundle/manifest ใหม่ ทดสอบ fresh install และ upgrade แยกกัน เพิ่ม preflight ตรวจ RPC/columns/secret presence โดยไม่เปิดเผยค่า secret

### F08 — Medium / Availability: stock ที่ถูกจองไม่มีเวลาหมดอายุอัตโนมัติ

**หลักฐาน:** [commerce_checkout](../supabase/commerce-v2.sql#L91) และ Live CF ตัด stock เมื่อสร้าง pending order; schema ไม่มี reservation expiry และไม่พบ worker คืน stock ของ pending orders ที่หมดเวลา มีคืน stock เมื่อยกเลิกด้วยตนเองเท่านั้น

**ผลกระทบ:** ผู้ซื้อทิ้งตะกร้าหรือส่งหลายคำสั่งซื้อสามารถกัก stock ได้โดยไม่จ่ายเงิน Public checkout มี rate limit แต่ยังจอง stock จำนวนน้อยจนหมดได้ การหมดอายุ HMAC 24 ชั่วโมงไม่ได้คืน stock

**แก้ไข:** เพิ่ม `reserved_until`, จำกัด pending ต่อผู้ซื้อ/ร้านตามนโยบาย และ worker ยกเลิก expired orders ด้วย transaction/locks ให้ใช้ทางคืน stock เดิมเพียงครั้งเดียว ไม่บวก stock เพิ่มเองซ้ำกับ cancellation trigger

### F09 — Medium / Functionality: real-time stock ใน UI ยังไม่ครบ

**หลักฐาน:** [CommerceStorefront](../components/shop/CommerceStorefront.tsx) ใช้ snapshot ตอนโหลดหน้า ไม่มี stock subscription ส่วน [admin subscriber](../lib/features/commerce/stock-subscription.ts#L9) อ่าน `commerce_variants` ด้วย browser client แต่ [commerce-v2.sql:47](../supabase/commerce-v2.sql#L47) ถอนสิทธิ์ client ตารางนี้ และไม่พบ SELECT policy/grant ที่คืนให้ ผล probe บน committed bundle: `variant_select=false`

ยิ่งกว่านั้น subscriber รวม product/variant snapshot ด้วย `Promise.all` แล้วหยุดทั้ง snapshot เมื่อ variant query error ทำให้การ refresh stock หลัง reconnect ของ product ได้รับผลด้วย Publication อย่างเดียวไม่ทำให้ผ่าน RLS

**แก้ไข:** ใช้ endpoint สำหรับ stock ที่คืนเฉพาะสินค้าที่เผยแพร่ของ store slug นั้น หรือจัด authenticated policy/grants ที่แคบสำหรับ admin; ไม่ปิด RLS และไม่เปิดข้อมูลทุกคอลัมน์ให้ anonymous เพียงเพื่อให้ Realtime ทำงาน ฐานข้อมูลยังกัน stock ติดลบได้แม้ UI เก่า

### F10 — Medium / Correctness: flexible matching ไม่เข้าใจเจตนาปฏิเสธ

**หลักฐาน:** [matchOrderCode](../lib/features/commerce/cf-code.ts#L25) ยอมรับ target เป็น complete token ที่อยู่ตรงไหนก็ได้ Probe `matchOrderCode('ไม่เอา 159','159','flexible') === true`

**ผลกระทบ:** คำถามหรือคำยกเลิกที่กล่าวถึงรหัสอาจสร้างออเดอร์/จอง stock โดยไม่ได้ตั้งใจ

**แก้ไข:** แยก “สอบถามสินค้า”, “ยืนยันจอง”, “ยกเลิก” ก่อน order placement ใช้ grammar คำนำที่กำหนดสำหรับ auto-order หรือใช้ strict mode/confirmation ตามนโยบายร้าน อย่าเปลี่ยน flexible matching ทั่วระบบโดยไม่มี regression tests

### F11 — Medium / Resource handling: downloader และบาง API อ่าน body ก่อนบังคับขนาด

**หลักฐาน:** [downloadSlipImage](../lib/features/slips/image.ts#L18) fetch URL ตาม payload, ตาม redirect และอ่าน `res.blob()` ก่อนตรวจ 5 MiB ไม่มี hostname/protocol allowlist ต่างจาก [downloadVisionImage](../lib/features/vision/vision-image.ts#L15) ที่ตรวจ Meta CDN, ห้าม redirect และนับ bytes ระหว่าง stream

[commerce POST](../app/api/commerce/route.ts#L26) อ่าน `req.text()` ก่อนตรวจ 300 KB; [package slip upload](../app/api/payments/verify-slip/route.ts#L53) อาศัย Content-Length ก่อน `formData()` ซึ่งไม่ป้องกัน chunked body ที่ไม่ส่ง header

**ผลกระทบ:** memory/egress abuse และเงื่อนไข SSRF หาก upstream URL ควบคุมหรือ redirect ได้ แต่ยังไม่ได้ยืนยัน SSRF ที่โจมตีได้จาก internet เพราะ Webhook มี signature และ attachment มาจาก Meta

**แก้ไข:** ใช้ downloader/`readUploadForm` ที่มีอยู่ร่วมกัน ตรวจ HTTPS/host, ปิด redirect, ตรวจ magic bytes และจำกัดขนาดระหว่างอ่าน ก่อน materialize body อย่าเพิ่งสรุปว่าเหล่านี้เป็น authenticated bypass ของ Webhook

### F12 — Medium / Business configuration: temporary Full Access ยังเปิดอยู่

**หลักฐาน:** [full-access.ts:5](../lib/full-access.ts#L5) ตั้ง `temporaryFullAccess=true`; [hasFeature](../lib/feature-access.ts#L29) ให้ฟีเจอร์กับ active tenant โดยไม่เช็กแพ็กเกจปกติ

เป็นการตั้งค่าที่มีคำอธิบายว่าผู้ใช้เคยร้องขอไว้ ไม่ใช่ RLS bypass และการตรวจครั้งนี้ไม่ปิดให้เอง แต่ถ้าจะเก็บเงินตามแพ็กเกจ Production ต้องยืนยันว่าตั้งใจให้ข้ามข้อจำกัด และตรวจฝั่ง SQL คู่กันด้วย `full-access.sql`/rollback

### F13 — Medium / Dependency maintenance: npm audit แจ้ง 2 production packages

ติดตั้ง `next@15.5.27`, `next/node_modules/postcss@8.4.31`, root `postcss@8.5.29`, และ Next ใช้ `sharp@0.35.5` แบบ deduped

- `npm audit --omit=dev` คืน exit 1: 1 package Critical, 1 package High เป็นผลของ dependency scanner ไม่ใช่จำนวน exploit ที่พิสูจน์แล้ว
- [Next.js RCE advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) ระบุ affected ถึง 15.5.27 และ workaround `sharp >=0.35.5` ซึ่ง repository นี้ติดตั้งอยู่แล้ว จึงไม่ยืนยันว่า RCE ใช้งานได้กับ installation นี้ โดยเฉพาะ host ปัจจุบันเป็น Windows ส่วน advisory กล่าวถึง glibc Linux ต้องตรวจ dependency ที่ deploy จริงอีกครั้ง
- [Server Actions DoS advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r) ต้องมี Server Action; ไม่พบ `use server` ใน application source ที่สแกน จึงยังไม่ยืนยัน reachability
- [PostCSS advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp) ขึ้นกับการประมวลผล CSS/source maps ที่ผู้โจมตีควบคุม ไม่พบ public runtime CSS compilation endpoint ในเส้นทางที่ตรวจ การอัปเดต root PostCSS อย่างเดียวไม่แก้ nested dependency ของ Next

**แก้ไข:** อัปเดต Next ไป patched compatible release เช่น 15.5.28 ขึ้นไป ทดสอบแล้วตรวจ dependency tree/audit ซ้ำ รักษา sharp patch และจัดการ nested PostCSS ให้ใช้รุ่น patched ที่เข้ากันได้ ไม่รัน `audit fix --force` โดยไม่ review

### F14 — Medium / Operations: ยังไม่พบ scheduled queue recovery ใน repository

[vercel.json](../vercel.json) ไม่มี cron; workflow ที่พบเรียก follow-ups เท่านั้นและปิด schedule ไว้โดยตั้งใจ ไม่มีตัวเรียก `/api/cron/facebook-webhooks` ตามกำหนดเวลาใน repository แม้ ingress มี `after()` drain อยู่แล้ว

**ผลกระทบ:** restart/process termination หรือ event ที่ต้องรอ `available_at` อาจไม่มีใครหยิบจนกว่าจะมี trigger อีกครั้ง หากระบบไม่มี scheduler ภายนอก

**แก้ไข:** ยืนยัน scheduler ภายนอก หรือเพิ่ม cron เฉพาะ Facebook queue พร้อม secret, queue lag/dead/review alert โดยไม่เปิด follow-ups ที่ถูกพักโดยเจตนา การตรวจ source อย่างเดียวพิสูจน์ไม่ได้ว่า Production ไม่มี external scheduler

### F15 — Low / UX correctness: cancelled order แสดงคล้ายชำระแล้ว

[payment page:55](../app/pay/live/[token]/page.tsx#L55) ตั้ง `paid = status !== 'pending_payment'` ทำให้ `cancelled` แสดง “ได้รับการชำระหรือดำเนินการแล้ว” ควรแยก `paid/shipped`, `cancelled`, `pending_payment` อย่างชัดเจนและแสดงคำแนะนำเมื่อ order ถูกยกเลิก

## 3. Secrets / Data Leakage — ผลที่ตรวจพบและที่ยังยืนยันไม่ได้

- ไม่พบค่าความลับที่ตั้งใน local env ฝังอยู่ใน tracked source และไม่พบชื่อ `NEXT_PUBLIC_*` ที่เป็น service-role key, private secret หรือ Page Access Token จากการสแกนนี้ พบ pattern คล้าย Meta token ใน package-lock เพียงรายการเดียว ตรวจแล้วเป็น integrity checksum ไม่ใช่ credential
- `.env*` ถูก ignore และ Git HEAD ติดตามเฉพาะตัวอย่าง env; ตรวจประวัติ path `.env`/`.env.local` ที่มีอยู่ไม่พบรายการ แต่ไม่ได้ตรวจทุก blob/branch/secret รุ่นเก่าใน Git history ทั้งหมด
- Supabase URL/anon key และ Facebook App ID ที่เป็น `NEXT_PUBLIC_*` ไม่ถือเป็นความลับโดยตัวมันเอง การป้องกันข้อมูลขึ้นกับ RLS/grants และ authorization ที่ถูกต้อง
- `supabaseAdmin` ใช้ `server-only` และเก็บ service-role key ฝั่ง server; Page token ถูกตัดออกจาก browser column grants ที่ตรวจแล้ว
- ยังไม่ได้ตรวจ client bundle ใหม่ของ deployment, hosting logs, backup exports, CI secret scopes หรือ permission ที่ติดตั้งจริง จึงไม่รับรองว่า “ไม่มีข้อมูลรั่วทุกทาง”
- ไม่พบหลักฐาน cross-tenant data leak ที่ยืนยันได้; F01 เป็น role/financial-integrity gap ภายใน tenant และ F11 เป็น conditional hardening gap

เอกสารอ้างอิงหลัก: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [SlipOK status codes](https://slipok.com/api-documentation/error-status-code/), [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

## 4. ตัวอย่างปรับปรุงเร่งด่วน

ตัวอย่างเหล่านี้เป็นแนวทางสำหรับ PR แก้ไข ไม่ได้ apply ให้ application/ฐานข้อมูลจริง และยังต้องทดสอบการเชื่อมต่อกับ flow เดิม

### 4.1 เปิดเฉพาะหน้าลิงก์ที่มี token

```ts
// lib/supabase/middleware.ts — เพิ่มใน PUBLIC_PATHS
;('/pay/live',
  // middleware.ts — เพิ่มในเงื่อนไข public fallback
  pathname.startsWith('/pay/live/'))
```

คง `verifyLiveCfPaymentToken` ก่อนอ่าน order และเพิ่มกรณี token tampered/expired, anonymous valid token, cancelled order ใน integration tests

### 4.2 ปิด direct financial-status writes จาก browser

ย้าย legacy UI ไป authenticated server route/RPC ที่ตรวจ owner หรือ permission สำหรับ manual payment, tenant/customer/order scope, allowed transitions และบันทึกผู้อนุมัติ/เหตุผลก่อนถอนสิทธิ์

```sql
-- table privilege และ column privilege เป็นคนละ grant ต้องถอนทั้งคู่
revoke update on public.orders from anon, authenticated;
revoke update (status) on public.orders from anon, authenticated;

-- RPC สำหรับเปลี่ยนสถานะต้อง service-only และตรวจ actor/scope ภายใน
-- ด้วย ไม่รับคำยืนยันว่าเป็น owner มาจาก request body
```

หากยังไม่ย้าย `ShopClient.moveOrder` การถอน grant จะทำให้ legacy UI เปลี่ยนสถานะไม่ได้ จึงต้อง deploy code และ migration เป็นชุดเดียวกัน

### 4.3 เพิ่ม timestamp guard ให้ legacy โดยใช้เวลาจาก provider เท่านั้น

```ts
function transferFitsOrder(
  providerPaidAt: string | null,
  oldestOrderCreatedAt: string,
  now = Date.now(),
) {
  const paid = Date.parse(providerPaidAt ?? '')
  const created = Date.parse(oldestOrderCreatedAt)
  const tolerance = 2 * 60_000
  return (
    Number.isFinite(paid) &&
    Number.isFinite(created) &&
    paid >= now - 24 * 60 * 60_000 &&
    paid <= now + tolerance &&
    paid >= created - tolerance
  )
}
```

`providerPaidAt` ต้อง derive จาก trusted SlipOK response เช่น helper `providerPaidAt` ที่มีอยู่; `oldestOrderCreatedAt` ต้องอ่านจาก selected orders ของ tenant/customer บน server และ recheck ภายใน finalize transaction เมื่อไม่ผ่านให้ review โดยไม่ claim เป็น paid ห้ามใช้วันที่จาก form/filename/EXIF แทน provider

### 4.4 ใช้ payment session เป็นหน่วยเดียวตลอด flow

```ts
// ตัวอย่าง contract: สร้าง snapshot ฝั่ง server ภายใน transaction
type SalePaymentSession = {
  id: string
  tenantId: string
  customerId: string
  orderIds: string[]
  expectedSatang: number
  expiresAt: string
}

// ลงนาม sessionId + expires; หน้าเว็บอ่าน expectedSatang จาก DB
// verifier ใช้ orderIds/expectedSatang เดียวกันและ recheck ก่อน commit
// ไม่รับ amount/orderIds ที่ลูกค้าส่งมาทับ snapshot
```

### 4.5 เก็บ rate-limit retry เป็น outbox state ไม่ใช่ loop ส่งซ้ำ

```ts
type SendOutcome =
  | { state: 'accepted'; providerMessageId: string }
  | { state: 'retryable-rejection'; retryAt: string; providerCode: number | null }
  | { state: 'unknown'; requiresReview: true }

// explicit provider rejection ที่ระบุ throttling -> retryable-rejection
// accepted response -> accepted; timeout/connection lost/ผลกำกวม -> unknown
// persist outcome ก่อนคืนผล และ worker claim ด้วย lease/idempotency key เดิม
```

ปรับ adapter ให้เก็บ HTTP status, Graph code, `is_transient`, retry headers แบบไม่บันทึก token/ข้อความลูกค้า และทดสอบ crash หลังส่งก่อนบันทึกผลด้วย

## 5. ผลตรวจคุณภาพที่รันจริง

| คำสั่ง/การตรวจ                                                                                                                             | ผล                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npx.cmd tsc --noEmit`                                                                                                                     | ผ่าน                                                                                                                                      |
| `npm.cmd test`                                                                                                                             | ผ่าน 36/36                                                                                                                                |
| `npm.cmd run lint`                                                                                                                         | 0 errors, 12 warnings (native img)                                                                                                        |
| ชุดทดสอบเพิ่มเติม 13 scripts ที่เกี่ยวกับ route security, payment/commerce SQL, Webhook, upload, logging, isolation, SlipOK และ full setup | 64 ผ่าน / 6 ล้มเหลว จาก 70 results; บาง script สรุปหลาย scenario เป็น result เดียว จึงไม่ควรรวมจำนวนนี้เป็นจำนวน unit tests เทียบกันตรง ๆ |
| `npm.cmd audit --omit=dev --json --cache .npm-audit-cache`                                                                                 | exit 1: 1 Critical package + 1 High package; reachability/mitigation ตาม F13                                                              |
| รัน committed full SQL บน isolated fixture                                                                                                 | ผ่าน, ไม่มี public application table ที่ปิด RLS, client อ่าน Page token ไม่ได้                                                            |
| Security/business probes                                                                                                                   | ยืนยัน F01, F02, F03, F04, F05, F10 และ variant read denial ของ F09                                                                       |
| Production DB/Meta/SlipOK live smoke test, independent PostgreSQL concurrent load, production build/deployment                             | ไม่ได้รัน                                                                                                                                 |

13 scripts ที่รัน:

```text
test-route-security.cjs          test-sensitive-logging.cjs
test-upload-security.cjs         test-commerce-sql.cjs
test-payment-sql.cjs             test-payment-pro-sql.cjs
test-live-cf-mode.cjs             test-facebook-webhook-queue.cjs
test-slipok-request.cjs           test-slip-order-total.cjs
test-full-database-setup.cjs      test-inbox-reply-isolation.cjs
test-tenant-page-connections.cjs
```

สาเหตุ 6 results ที่ล้มเหลว:

1. `test-facebook-webhook-queue.cjs` และ `test-live-cf-mode.cjs` จบก่อนทดสอบเนื่องจาก mock loader ไม่รู้ dependency `@/lib/features/commerce/cf-code` ของ comment rules — 2 results
2. `test-full-database-setup.cjs` ล้มเหลว 3 tests จาก migration registry ไม่ครบตาม F07
3. `test-inbox-reply-isolation.cjs` ล้มเหลว 1 test จาก mock loader ไม่รู้ dependency `@/lib/features/agents/tenant-ai-quota`

ความล้มเหลวของ mocks ไม่ได้พิสูจน์ว่า runtime feature เสีย แต่ทำให้ยังใช้ suite เหล่านี้รับรอง regression ไม่ได้ และ `npm test` ปัจจุบันไม่ได้รวม scripts ชุดนี้ จึงเห็น default suite เขียวทั้งที่ checks สำคัญยังแดง

## 6. ลำดับงานก่อนเปิดใช้งานจริง

1. ปิดช่องทางเปลี่ยนสถานะการเงินที่ข้าม policy (F01) และเพิ่ม regression test ระดับ authenticated database role
2. รวม slip/order/ledger finalize เป็น transaction พร้อม timestamp/order snapshot (F02/F06) ทดสอบ stale slip, cancelled-during-verification และ DB failure
3. แก้ public payment route และทำยอด session ให้สอดคล้องกันทั้งแชท/หน้าเว็บ/SlipOK (F03/F04)
4. แก้ rejected-send recovery, ยืนยัน queue scheduler และตั้ง alert เมื่อ side effect ล้มเหลว (F05/F14)
5. ทำ migration registry + environment preflight ให้ครบและซ่อม mocks/CI ให้รันทั้ง unit/SQL/security suites (F07)
6. ตัดสินใจ reservation expiry, flexible intent, Full Access และ UI real-time policy (F08–F12) แล้วอัปเดต dependencies ที่มี advisory (F13)
7. บน staging ที่ติดตั้ง SQL/permissions เหมือน Production: ทดสอบ anonymous payment link, Meta webhook จริงหนึ่งรายการ, Messenger card, สลิปถูกต้อง/ซ้ำ/ยอดผิด และ checkout แข่ง Live CF ของชิ้นสุดท้ายจากหลาย PostgreSQL connections ก่อนพิจารณาอนุมัติ release
