# Live Auction & Fulfillment Automation — Production Readiness Audit

วันที่ตรวจ: 6 พฤศจิกายน 2026 (Asia/Bangkok)

**ผล: ยังไม่พร้อมรับรอง production แบบครบวงจรตามโฟลว์ที่ร้องขอ** แม้ build, TypeScript, ชุดประมูลหลัก, ledger และ shipping SQL ผ่าน มีทั้งความต่างจากข้อกำหนดธุรกิจ การเชื่อมต่อจริงที่ขาด และชุดทดสอบที่ยังล้มเหลว

การตรวจครั้งนี้ไม่ได้แก้ business logic, deploy, migrate ฐานข้อมูลจริง, ส่งข้อความหาลูกค้า, ตรวจสลิปแบบเสียโควต้า หรือสร้างพัสดุจริง การเปลี่ยน component/validator/test ที่มีอยู่ก่อนเริ่ม audit ยังคงอยู่ ใช้ฐานข้อมูล PostgreSQL แบบ disposable ผ่าน PGlite สำหรับทดสอบ mutation

## ขอบเขตและระดับหลักฐาน

- อ่าน UI → API → signed Facebook Webhook → durable queue → auction SQL → customer tab/payment ledger → shipping/provider/notification
- รัน `npm test`, `scripts/test-*.cjs` ทั้ง 147 ไฟล์, Facebook tenant SQL `.mjs`, ชุด npm ที่เกี่ยวข้อง, lint, typecheck, production build และ browser fixture ของโฟลว์ที่ตรวจ
- ตรวจฐานข้อมูลที่ `.env.local` ชี้ไปด้วย HEAD requests: 19 ตารางพร้อมคอลัมน์สำคัญตอบ HTTP 200 ทั้งหมด ตรวจ OpenAPI พบ RPC ที่เลือกตรวจ 18 รายการทั้งหมด ข้อนี้ยืนยันการมี schema/signature ใน API cache ไม่ยืนยันว่า function body ในระบบจริงตรงกับ source ทุกบรรทัด หรือ RLS ทุก role ถูกต้อง
- อ่าน Meta API จริงจากตัวอย่าง 5 เพจที่ active ในระบบ; อ่าน subscription ของแอปที่ตั้งค่าใน environment; อ่าน SlipOK quota จริง ไม่เปิดเผย token หรือข้อมูลลูกค้าในรายงาน
- การผ่าน API mock/browser fixture ไม่ใช่หลักฐานว่า Meta ส่งข้อความหรือ Bee Move ออก tracking จริง การอ่าน API live ได้ในขณะไม่มี active stream ไม่ใช่ end-to-end comment test

คำว่า **ผ่านใช้งานได้จริง** ในตารางหมายถึงส่วนที่ระบุมี implementation และหลักฐานผ่านตามขอบเขตในช่องผลตรวจ ไม่ใช่การรับรองบริการภายนอกที่ยังไม่ได้ยิงธุรกรรมจริง

## Checkpoint ตามโฟลว์ธุรกิจ

| โฟลว์ / Checkpoint | สถานะ | ผลตรวจและหลักฐาน | วิธีแก้ / สิ่งที่ต้องยืนยัน |
|---|---|---|---|
| 1. เลือก Page / active Live Video | **ต้องแก้ไขเพิ่ม** | มี Graph API จริง, token/page ownership checks, pagination, retry และ UI error; ในตัวอย่าง 5 เพจ อ่าน live list ได้ 4 เพจแต่ไม่มี live ขณะตรวจ อีก 1 เพจ HTTP 400/code 190 | เชื่อมต่อ token ของเพจที่เสียใหม่; เปิด test live แล้วตรวจว่า video ID ที่เลือกตรงกับ event จาก `feed`/`live_comments` |
| 1. บันทึกชื่อสินค้า ราคาเปิด min-step ค่าส่ง บัญชี | **ผ่านใช้งานได้จริง** | Workspace API + transaction `save_auction_workspace`; ตรวจ tenant/Page/bank, revision, idempotency; รอบที่มีคนบิดแล้วปฏิเสธแก้เงื่อนไขราคา; API/SQL tests ผ่าน | ทำ authenticated staging smoke กับ Page และบัญชีร้านที่ใช้งานจริงอีกครั้งก่อนปล่อย |
| 1. ค่าใช้จ่ายเริ่มต้น 0 / ว่าง | **ต้องแก้ไขเพิ่ม** | ค่า default เป็น 0 และ SQL เก็บได้ แต่ UI ส่ง `''` หลังล้าง input แล้ว API `inputMoney('')` คืน null → HTTP 400; ทำ reproduction ยืนยันแล้ว | แปลงเฉพาะช่อง finance ที่เป็น `''` เป็น 0 ก่อน validate/save ทั้ง client และ server; ค่าที่ผิดรูปแบบหรือ object หายยังต้อง reject |
| 1. ยอดขาย / กำไร Dynamic | **ต้องแก้ไขเพิ่ม** | ฟอร์มหลักใช้ sales ลบ cost/ads/shipping/fees แต่ SQL `metrics.profit` ใช้ยอดรับเงินลบค่าใช้จ่ายและไม่หัก `other_fees`; reproduction: fees=50 ไม่มีรายรับ → SQL=0, ฟอร์ม=-50; ฟอร์มนับ current bid ที่ยังไม่ปิดใน sales ด้วย | แยกยอดบิดปัจจุบัน ยอดขายปิดรอบ และยอดรับเงิน; กำหนดฐานกำไรให้ชัดและใช้สูตรเดียวกัน; เพิ่ม `other_fees` ใน SQL ที่เกี่ยวข้อง |
| 2. Keywords `1`, `+1`, ราคาเต็ม / Highest Bidder | **ผ่านใช้งานได้จริง** | Configured `1`/`+1` เป็น STEP_BID, ราคาเต็มเป็น NUMERIC_BID; SQL row lock ตรวจขั้นต่ำและอัปเดต leader; กัน replay, stale, cross-tenant และ event overtaking มี tests | ต้องบันทึก keyword ที่ต้องการก่อน; UI poll ทุกประมาณ 5 วินาที ไม่ใช่ push ทันที และยังไม่มีผลทดสอบ latency/load จาก live จริง |
| 2. Admin/Page ปิดและล็อกผู้ชนะ | **ผ่านใช้งานได้จริง** | ตรวจ `page_id`/`host_ids`, configured close keyword, transaction finalize; สร้าง order/tab และกันปิดซ้ำ; ลูกค้าทั่วไปปิดเองไม่ได้ | แอดมินต้องมี Facebook identity ใน host list; ทดสอบ token/identity กับแอดมินจริง; lock winner ผ่าน แต่ notification ยังติด F1 ด้านล่าง |
| 2. ไม่มี implicit keyword fallback / Emoji ซ้ำ | **ผ่านใช้งานได้จริง** | Current workspace ส่ง arrays ว่างและ SQL latest defaults เป็น `[]`; ถ้าไม่ได้ตั้ง `ปิด` ก็ไม่ปิดเอง; duplicate tags ผ่าน UI rapid clicks → ลบ index กลาง → mock save/reload และ API/SQL persistence tests | แท็ก `['❌','❌','❌']` เป็นคำทางเลือกซ้ำ ไม่ได้แปลว่าต้องพิมพ์ `❌❌❌`; ถ้าต้องการทั้งสามตัวติดกันให้ตั้งเป็นแท็กเดียว; test เก่าที่คาด fallback/ห้ามค่าซ้ำต้องแก้ |
| 2. Webhook subscription / recovery worker | **ขาดการเชื่อมต่อ** | โค้ด signature, durable enqueue, lease และ replay มีจริง; จาก 5 เพจ: 1 เพจ subscribe แอปนี้ด้วย `feed,messages`; 3 เพจ API อ่านได้แต่ไม่พบ subscription ของแอปนี้; อีก 1 ตรวจไม่ได้เพราะ code 190 | Subscribe แอปที่ถูกต้องให้ทุกเพจเป้าหมายหลัง reconnect และตรวจ signed event เข้า queue; ยืนยัน external cron `/api/cron/facebook-webhooks` จริง — `vercel.json` ไม่มี cron และ workflow customer-tabs ไม่ได้แทน worker นี้ |
| 3. Public Reply ประกาศผู้ชนะทันที | **ต้องแก้ไขเพิ่ม** | มี Graph reply จริง แต่ trigger เปลี่ยน delivery เป็น `awaiting_confirmation`; TypeScript ข้ามจนผู้ชนะพิมพ์ bid keyword ยืนยันหลังปิด | เอา confirmation gate ออกจากทั้ง SQL และ TypeScript สำหรับนโยบายส่งทันที แล้วปล่อย outbox ไปยัง `leading_comment_id`; จัดการรายการค้างอย่างมีเงื่อนไขไม่ส่งซ้ำ |
| 3. Private Reply / บิลสะสม / บัญชี / payment link | **ต้องแก้ไขเพิ่ม** | มี template/ยอดจาก ledger, ค่าส่ง, บัญชีและ signed link; HTTPS origin + secret ยาวพอใน local config แต่ติด confirmation gate เดียวกัน; toggle ใหม่ default เป็น off | แก้ F1 และเปิด Public/Private ตามที่ร้านต้องการ; ทดสอบรับจริงด้วย test buyer; `pending`/`requires_review` ไม่ถือว่า delivered |
| 4. Customer Tab สะสมหลายรอบ | **ผ่านใช้งานได้จริง** | Unique `(live_session_id,customer_id)`, รวม item, ค่าส่งครั้งเดียว, partial/duplicate/reopen protections; customer-tab 12/12 และ SQL tests ผ่าน | กติกาปัจจุบันใช้ค่าส่งของบิลที่มีอยู่ โดยเติมค่าจากรอบใหม่เมื่อของเดิมเป็น 0; ไม่มีการเลือกเงื่อนไข per-item/max แบบทั่วไป; รวมภายใน session เดียว ไม่ได้รวมทุก live ตลอดไป |
| 4. Messenger image → SlipOK → paid | **ผ่านใช้งานได้จริง** | มีเส้นทาง webhook จริง ไม่ใช่ placeholder; exact auction amount + winner sender + receiver + reference/time + atomic settlement; order=`paid`, tab=`fully_paid`, slip=`valid` เป็นคนละ state; tests หลักผ่าน; SlipOK quota GET จริง HTTP 200/success และมีโควต้า | ยังไม่ได้ส่งภาพสลิปจริง; ต้องทดสอบผ่าน Page ที่ subscribe แล้ว โดยเปิด Auto-Pilot และมีบิล pending; ถ้ามีหลาย tab ค้างจะเป็น ambiguous และไม่เลือกจ่ายเอง; full-suite webhook fixture ยังล้มเหลวต้องซ่อม/ตรวจซ้ำ |
| 5. Paid orders → Shipping Workspace | **ผ่านใช้งานได้จริง** | SQL sync allocations จาก paid orders; gate บิลต้อง remaining=0; unpaid orders ส่งไม่ได้; recheck ตอนสร้าง/print/dispatch; shipped history คงแสดงได้ | ไม่ควรเปลี่ยนเป็นกรองเฉพาะ status=`paid` ทุกจุดจนประวัติ shipped หาย; staging ตรวจจ่ายครบแล้ว parcel ปรากฏและยอดเปลี่ยนแล้วส่งไม่ได้ |
| 5. ชื่อ/ที่อยู่/โทรจาก chat หรือการกรอก | **ผ่านใช้งานได้จริง** | Thai parser, capture candidate, explicit confirmation, shipping profile และ staff edit มีจริง; ข้อมูลกำกวมหรือไม่ครบไม่เดาเอง; UI/SQL tests ผ่าน | ผู้ซื้อต้องยืนยันที่อยู่; ยังไม่ได้ทดสอบที่อยู่จาก Messenger จริง/แบบฟอร์มจริง; ไม่รับรองข้อความภาษาธรรมชาติทุกรูปแบบ |
| 5. Bee Move / Courier API + tracking + label จริง | **ขาดการเชื่อมต่อ** | มีเพียง generic DMove-compatible adapter `GET /health`, `POST /parcels`, Bearer auth; Flash/J&T/Thailand Post ชี้ adapter เดียวกัน; ไม่มี provider `beemove`; DB มีชื่อ Bee Move เป็น default label เท่านั้น; ฐานข้อมูลที่เชื่อมไม่พบ active shipping integration; local ไม่มี encryption key | ขอ contract/sandbox ของ Bee Move แล้วทำ adapter/auth/payload/response เฉพาะ; เพิ่ม provider ใน TS/UI/SQL checks; ตั้ง key และ integration; ทดสอบ tracking/label จาก provider จริงก่อนเปิดใช้ |
| 5. แจ้ง Tracking กลับ Messenger | **ต้องแก้ไขเพิ่ม** | `create_parcels` เรียก `deliverOnce` และบันทึก notification status จริง; generic flow ทดสอบด้วย mocks; manual `dispatch` ไป SQL อย่างเดียว ไม่มี notify; failed/paused/window-closed ไม่มี background recovery ที่ครบ | ใช้ durable tracking outbox รวมทั้ง manual dispatch, retry เฉพาะผลที่ปลอดภัย, มี review/receipt reconciliation และตรวจ messaging window; ทดสอบลูกค้าได้รับจริงหลังแก้ carrier |

## Findings ที่ต้องแก้ก่อน sign-off

**F1 — P1: ปิดรอบแล้วข้อความผู้ชนะไม่ออกทันที และอาจรอโดยไม่มีทางยืนยัน**

- หลักฐาน: `supabase/live-auction-winner-confirmation.sql:12`, `:21`, `:65`; `lib/features/commerce/auction-server.ts:68`, `:361`
- Gate ใช้การมี property `closeKeywords` ซึ่ง current workspace มีเสมอ แม้เป็น `[]` เมื่อผู้ชนะยังไม่พิมพ์ bid keyword หลังปิด ทั้ง public/private จะรอ หากร้านใช้ราคาเต็มและ `keywords=[]` จะไม่มี STEP_BID สำหรับยืนยันเลย
- แก้ SQL trigger + TS guard ให้สอดคล้องนโยบายส่งทันที; เก็บ confirmation เป็นตัวเลือกแยกถ้ายังจำเป็น; การเปลี่ยนเฉพาะ UI ไม่แก้ปัญหา
- Acceptance: close event หนึ่งครั้งสร้าง order เดียวและ public/private outbox ส่งไปยังคอมเมนต์ผู้ชนะเดิมได้โดยไม่ต้องมีคอมเมนต์เพิ่ม; replay ไม่ส่งซ้ำ

**F2 — P1: Meta connection ไม่พร้อมทุกเพจในตัวอย่างที่ตรวจ**

- ผลอ่านจริง: 4/5 active-live GET สำเร็จแต่ไม่มี active live ในขณะตรวจ; 1/5 code 190; 1/5 subscription ของแอปนี้พบ `feed,messages`; 3/5 API subscription ตอบ 200 แต่ไม่พบแอปนี้ และ 1/5 ตรวจไม่ได้เพราะ token เสีย
- จำนวนนี้เป็นตัวอย่างห้าเพจ ไม่ใช่ inventory ทั้งระบบ และการไม่พบแอปนี้ไม่ใช่การยืนยันว่าไม่มีแอปอื่น subscribe
- Page ID ของแต่ละผลตรวจอยู่ใน `.tmp/production-audit/external-readonly.log` เพื่อระบุเพจที่ต้อง reconnect/subscribe โดยไม่มี token ในไฟล์นี้
- Reconnect Page token, subscribe `messages` และ comment fields ที่ใช้กับ app ID ที่ deployment ใช้ แล้วตรวจ event ที่เซ็นจริงเข้า queue/worker ทั้ง message และ comment
- ตรวจ App Mode/สิทธิ์/token scope/Meta approval จากบัญชีแอปจริงต่อ; ยังไม่มีหลักฐานเหล่านี้จากการอ่าน source

**F3 — P1: ยังไม่มี Bee Move integration ที่ใช้งานได้จริง**

- หลักฐาน: `lib/features/shipping/shipping-provider.ts:153`, `:214`; `lib/features/shipping/shipping-types.ts:16`; `supabase/shipping-integrations.sql:7`, `:72`
- ชื่อ Bee Move ใน UI/default SQL ไม่ได้แปลว่ามี API ของ `client.beemove.co.th`; test สร้าง tracking `TH123456789` และ label `labels.example.test` จาก mock response
- ไม่พบ active integration ในฐานข้อมูลที่เชื่อม; `SHIPPING_CREDENTIALS_ENCRYPTION_KEY` ไม่ถูกตั้งใน local environment ที่โหลด ตรวจค่าบน hosting จริงแยกต่างหาก ยังสรุปว่าบน hosting ขาด key ไม่ได้
- ทำ adapter ตามเอกสาร provider จริงและทดสอบ sandbox; ตั้ง encryption key 32 bytes อย่างถาวรและเก็บใน secret manager; ห้ามสุ่มเปลี่ยน key ถ้ามี ciphertext เก่า
- เว็บ Bee Move ไม่สามารถอ่านด้วยเครื่องมือเว็บครั้งนี้ และไม่พบเอกสารทางการจากการค้น จึงไม่เดา endpoint/auth contract

**F4 — P1: สูตรกำไรไม่ตรงกัน และช่อง finance ว่างบันทึกไม่ได้**

- หลักฐาน: `components/live-cf/AuctionUnifiedForm.tsx:233`, `:242`; `app/api/live-auction/workspace/route.ts:118`; `supabase/live-session-dashboard.sql:143`
- Reproduction ใช้ SQL bundle ปัจจุบัน: session `other_fees=50`, ยอดรับ=0, ค่าใช้จ่ายอื่น=0 → API SQL profit=0 แต่ฟอร์ม=-50
- ฟอร์มรวม current bid ที่ยัง active ลง sales ขณะที่ SQL ใช้ยอดโอนที่ตรวจผ่าน เป็นความต่างทั้งสูตรและฐานรายได้ ต้องแยกชื่อ metrics/นิยามให้ชัด
- แปลง finance ช่องว่างเป็น 0 และเพิ่ม tests ที่ล้างทีละช่องแล้วกดบันทึก; ใช้ชุดตัวอย่างเดียวกันตรวจ UI/API/SQL: ยังไม่ปิด, ปิดยังไม่จ่าย, จ่ายครบ, ยกเลิก และมี fees

**F5 — P1: การฟื้นตัวของงานสร้างพัสดุยังมีช่องว่าง**

- หลักฐาน: `app/api/shipping/route.ts:409`; `lib/features/shipping/shipping-provider.ts:125`; `supabase/shipping-integrations.sql:95`
- เมื่อ provider รับสร้างแล้วแต่ส่ง HTTP 2xx ที่ JSON/schema ไม่ตรง adapter จะ throw RESPONSE_INVALID; `providerCreated` ยัง false และโค้ดจัดเป็น failed แทน uncertain ผู้ใช้ส่ง request ID ใหม่ได้ job/idempotency key ใหม่ จึงเสี่ยงสร้างพัสดุซ้ำถ้าฝั่ง provider สร้างไปแล้ว
- Job ค้าง `creating` หลัง process crash ไม่พบ lease expiry/recovery worker ในเส้นทาง shipping นี้ จึงอาจแสดง in_progress ต่อไปโดยไม่มี reconciliation
- ถือว่าผลหลัง POST ที่ยืนยันไม่ได้เป็น uncertain; ใช้ shipment operation key คงที่ข้าม HTTP retries; เพิ่ม provider lookup/reconciliation และ lease recovery ก่อนให้ retry
- เป็นข้อค้นพบจาก source path ยังไม่ได้จำลองความเสียหายกับขนส่งจริง

**F6 — P1: Tracking notification ไม่ครอบคลุมทุกทางส่ง และไม่มีหลักฐานส่งจริง**

- หลักฐาน: `app/api/shipping/route.ts:394`, `:670`, `:681`; `lib/features/slips/notify.ts:153`
- API create_parcels พยายามส่งจริงผ่าน Messenger delivery lease; ถ้าพ้น window/paused จะบันทึก failed ซึ่งไม่ควรแสดงเป็นสำเร็จ; manual dispatch ไม่มี enqueue notification
- การกลับมาเรียก create_parcels บน job created ที่ notification pending อาจช่วยบางกรณี แต่ไม่ใช่ background recovery; ผล ambiguous ควร review ห้าม blind resend
- เพิ่ม outbox จาก transaction ที่เปลี่ยน tracking/dispatch, ส่งผ่าน worker และเก็บ provider receipt; ทดสอบเส้นทาง manual และ API, provider success + Messenger failure, window ปิด และ process crash

**F7 — P1: Full test suite ยังแดง ต้องแยก harness เก่าออกจาก defect จริงก่อนรับรอง**

- มี test เก่าที่ยังห้าม duplicate keywords จากก่อนการแก้แท็กซ้ำ และ parser test ที่คาด built-in fallback ขัดกับ requirement ปัจจุบัน ต้องแก้ test ให้ป้อน configured keywords ไม่ใส่ fallback กลับเพื่อทำให้ test ผ่าน
- Failure ของ Webhook queue อยู่เส้นทาง Auto-Pilot จริง แต่ fixture เดิมไม่ได้รองรับ queries/modules ใหม่ของ auction/standalone routing; จึงยังไม่ถือเป็นหลักฐานว่า production ไม่ตรวจสลิป และก็ยังรับรอง integration test นี้ไม่ได้
- ส่วนอื่นเป็น missing mock dependency, schema fixture ไม่ครบ, script diagnostic ที่ต้องรับ argument และ network; รายละเอียด failure อยู่ตารางท้ายรายงาน

**F8 — P2: การเก็บ log และ production flags ต้องทบทวน**

- `lib/integrations/facebook/webhook-http.ts:85` log verified raw payload ทุกครั้ง; `diagnostics.ts` mask token/account keys แต่ไม่ mask `message.text`, ชื่อผู้ส่ง หรือ URL attachment โดยทั่วไป จึงอาจเก็บที่อยู่/เบอร์โทร/URL ภาพสลิปลง log แม้ไม่มี credential รั่ว
- เปลี่ยน default เป็น event metadata, เปิด debug แบบจำกัดเวลาและ redact PII/URL; จำกัด retention และสิทธิ์อ่าน log; sensitive-logging test ปัจจุบันหยุดที่ log count 3 vs 2 ยังไม่ใช่การพิสูจน์ว่าเนื้อหา log ปลอดภัยครบ
- `lib/full-access.ts:5` hardcode `temporaryFullAccess=true` พร้อม comment ว่า owner-requested; เป็น package/quota bypass ที่มีเจตนา ไม่ใช่ auth bypass ต้องทบทวนความตั้งใจก่อน production และตรวจ SQL counterpart โดยไม่เปลี่ยนออกเอง
- `isFeatureEnabled('live_cf')` เปิดเมื่อ public flag ไม่ใช่ literal `false`; `.env.example` ตั้ง false แต่ code ไม่ได้ fail closed เมื่อไม่ตั้งค่า ต้องกำหนด release config ชัดเจน

## ผลคำสั่งทดสอบ

| ชุด / คำสั่ง | ผล | หมายเหตุ |
|---|---|---|
| `npm.cmd test` | **119 ผ่าน / 1 ไม่ผ่าน** จาก 120 | `auction-comment.test.ts` คาด built-in close/bid fallback ซึ่ง parser ปัจจุบันไม่ใช้ |
| `node --test --test-concurrency=2 scripts/test-*.cjs` โดยส่งรายชื่อจริงทั้ง 147 ไฟล์ | **723 ผ่าน / 16 ไม่ผ่าน** จาก 739 ตาม Node test runner | มี file-level failures และ CLI diagnostics รวมอยู่ด้วย ไม่ใช่ 739 independent business cases |
| `npm.cmd run test:auctions` | **37/37 ผ่าน** | รวม engine, host identity, delivery, exact auction slip และ cron authorization |
| `npm.cmd run test:shipping` | **8/8 ผ่าน** | provider calls เป็น mocks; ledger/fulfillment ใช้ disposable PostgreSQL |
| `npm.cmd run test:live-auction-dashboard` | **8 ผ่าน / 1 ไม่ผ่าน** | test เก่าที่คาด duplicate rejection ได้ HTTP 201 แทน 400 |
| `npm.cmd run test:customer-tabs` | **12/12 ผ่าน** | รวมยอด ค่าส่งครั้งเดียว payment/reopen และ reminder delivery controls |
| `npm.cmd run test:schema` | **11/11 ผ่าน** | fresh/partial/older install, order/dependency, RLS grants และ rollback checks |
| `npm.cmd run db:schema:check` | **ผ่าน** | 123 SQL sources, 106 included, 17 excluded; generated bundle ไม่ตกหล่นจาก source registry |
| `test-facebook-tenants.mjs` พร้อม local PGlite path | **ผ่าน** | rerun, ownership, RLS/token restrictions และ diagnostic SQL |
| Auction unified browser UI | **ผ่าน** | viewport 375/768/1024/1440, finance, save/reload, draft polling; mocked APIs |
| Duplicate emoji browser regression เพิ่มเฉพาะ audit | **ผ่าน** | คลิก ❌ 3 ครั้งรวด, ลบตำแหน่งกลางเหลือ 2, save และ reload แล้วยังมี 2 |
| Legacy auction browser UI | **ผ่าน** | responsive, leader polling, shortcuts, errors, slip form; mocked APIs |
| Live session browser UI | **ผ่าน** | finance/proof adjustment/conflict/reminder preview; mocked APIs |
| Shipping browser UI | **ผ่าน** | address/tracking/CSV; Chromium PDF 100x150mm และ A4/QR/no-clipping; ไม่เรียก courier/Messenger จริง |
| Live CF setup browser UI | **ผ่าน** | product/tenant state isolation และ variant confirmation; mocked APIs |
| Legacy `check-live-cf-browser.cjs` | **ไม่ผ่าน** | timeout ที่ selector `input[name="rule-mode"]` ซึ่งไม่มีในหน้าปัจจุบัน ต้องปรับ test และยืนยันทางเข้าโฟลว์ปัจจุบัน |
| `npm.cmd run lint` | **ผ่าน: 0 errors, 11 warnings** | ส่วนใหญ่ `<img>` และ React effect dependencies |
| `tsc --noEmit --incremental false` | **ผ่าน** | ไม่มี type errors |
| `npm.cmd run build` | **ผ่าน** | Next.js production compile/build สำเร็จ มี lint warnings |
| Focused reproduction | **ยืนยันข้อผิดพลาด F4** | blank finance rejection และ SQL/form profit mismatch; configured parser/emoji ผ่าน |

ชุดย่อยข้างต้นซ้อนกับ full script run จึงไม่ควรนำจำนวน pass มาบวกเป็นจำนวน test unique ทั้งหมด `npm test` ครั้งแรกติด OS user-info restriction ภายใน sandbox; รันใหม่ด้วยสิทธิ์ execution ที่เหมาะสมแล้วได้ผล 119/120 ตามตาราง `agent-browser` CLI ไม่มีในเครื่อง จึงใช้ Chromium/CDP browser scripts ที่โปรเจกต์มีอยู่แล้ว

## จำแนก 16 failures จาก scripts run

| Test / ไฟล์ | สิ่งที่พบ | การแก้ก่อน rerun |
|---|---|---|
| `test-admin-feature-bypass.cjs` | minimal tenant fixture ไม่มี `is_active`, function อ่าน field แล้ว 42703 | เติม schema fixture ให้ตรง production แล้วตรวจซ้ำกับ complete bundle; ยังสรุปว่า production column หายไม่ได้ |
| `test-agent-control.cjs` | Unexpected dependency `@/lib/features/commerce/cf-code` | อัปเดต dependency fixture |
| `test-billing-slip-topups.cjs` | VM/eval `require is not defined` หลังมี full-access import | อัปเดต loader/dependency injection |
| `test-broadcast-policy.cjs` สองกรณี | expected ready/true แต่ได้ review_missing/false | ตรวจ policy/approval fixture เทียบ requirement ปัจจุบัน ไม่ bypass guard เพื่อให้ test ผ่าน |
| `test-facebook-webhook-queue.cjs` | expected Slip Auto-Pilot invocation 1 ได้ 0 | เพิ่ม fixture สำหรับ auction target/standalone queries และตรวจ worker event error ก่อนตัดสิน runtime defect |
| `test-feature-restoration.cjs` | Unexpected dependency `./overview-recovery` | อัปเดต loader/dependencies |
| `test-followup-and-broadcast.cjs` | ต้องรับ tenant UUID และ origin; ไม่ใช่ isolated test | แยก diagnostics ออกจาก glob; ถ้าจะรัน live ให้ใช้ tenant/origin ที่ระบุชัดและ dry-run |
| `test-gemini-ai-agent.cjs` | VM `require is not defined` จาก full-access import | อัปเดต loader |
| `test-inbox-reply-isolation.cjs` | Unexpected dependency `tenant-ai-quota` | อัปเดต dependencies แล้วทดสอบ isolation จริงต่อ |
| `test-live-auction-dashboard-api.cjs` | duplicate keyword ได้ 201 แต่ยังคาด 400 | test เก่าตกหล่นจากการแก้ duplicate ก่อนหน้านี้ ต้องย้ายไป acceptance cases และ assert arrays ไม่ถูก deduplicate |
| `test-live-cf-mode.cjs` | Unexpected dependency `cf-code` | อัปเดต dependency fixture |
| `test-overview-fetch.cjs` | live read-only diagnostic `fetch failed` ใน sandbox | แยก live diagnostic; ใช้ network-enabled environment และระบุ tenant; read-only schema audit ครั้งนี้นอก sandboxสำเร็จ แต่ไม่ได้อ้างว่า overview diagnostic ผ่าน |
| `test-route-security.cjs` | mock ไม่มี `db.rpc` เมื่อ approve slip | เติม RPC mock ที่จำลอง ledger semantics แล้วตรวจ authorization/idempotency ต่อ |
| `test-sensitive-logging.cjs` | log count 3 แต่คาด 2 | ปรับ assertion ตาม operations และตรวจ payload ของทุก log ต่อ ห้ามสรุปว่าเป็นแค่ count จนตรวจเนื้อหาครบ |
| `test-slip-settings.cjs` | VM `require is not defined` จาก full-access import | อัปเดต loader |

## สิ่งที่ยังต้องพิสูจน์กับ deployment จริง

1. Reconnect/subscribe เพจเป้าหมาย แล้วเปิด test live เพื่อส่ง signed bid/close events จริง: คน A บิด, คน B บิด, ต่ำกว่าขั้นต่ำ, close, late bid และ duplicate webhook
2. หลังแก้ F1 ต้องรับ Public Reply และ Private Reply จริงโดยไม่พิมพ์ยืนยันเพิ่ม; ตรวจ provider message receipt ไม่ใช่แค่ local outbox
3. ให้ test buyer ชนะสองรอบใน session เดียว ตรวจบิล/ค่าส่งครั้งเดียว และให้ภาพสลิปจริงผ่านระบบที่อนุญาตทดสอบ แล้วตรวจ paid/tab/payment ledger/shipping ตามลำดับ รวมยอดผิด/สลิปซ้ำ/บัญชีผิดด้วย
4. ตั้ง Bee Move sandbox/credentials/encryption key; สร้าง parcel, ตรวจ tracking และดาวน์โหลดฉลาก provider จริง; ทดสอบ timeout/unknown outcome ผ่าน reconciliation
5. ส่ง tracking ไป test buyer ภายในหน้าต่างที่อนุญาต ตรวจ receipt และ failure/recovery โดยไม่สร้าง parcel ซ้ำ
6. ตรวจ external scheduler และ monitoring ของ queue backlog, failed/dead-letter events, `requires_review`, `creating` ค้าง และ notification failed; ไม่มีหลักฐานจาก repo ว่า external scheduler ถูกติดตั้งและกำลังเรียก deployment จริง
7. แก้ F4 และ tests ที่ค้าง แล้วรัน full suite ใหม่ ไม่มี business flow ที่สำคัญถูก skip; ตกลง threshold latency/throughput ก่อน load test เพราะ UI polling และ Page-wide queue ทำให้เวลาแสดงผลไม่เท่ากับเวลารับ bid

## หลักฐานและเอกสารอ้างอิง

- Logs และ reproduction scripts: `../.tmp/production-audit/` — `npm-test.log`, `scripts-tests.log`, `auctions.log`, `shipping.log`, `live-dashboard.log`, `customer-tabs.log`, `schema-tests.log`, `schema-check.log`, `typecheck.log`, `lint.log`, `build.log`, browser logs, `preflight-network.log`, `external-readonly.log`, `reproduce.log`
- Browser screenshots/PDF: `.tmp/all-in-one-auction-preview/`, `.tmp/auction-ui-preview/`, `.tmp/session-ui-preview/` และ output ของ shipping browser script
- [SlipOK Check Slip](https://slipok.com/check-slip/): request header `x-authorization`, `log`, optional `amount` สอดคล้องกับ implementation; ผล quota ไม่เท่ากับการผ่านตรวจภาพสลิปจริง
- [SlipOK Check Slip Quota](https://slipok.com/api-documentation/check-slip-quota/): ใช้ GET quota สำหรับ connectivity check ที่ไม่ส่งภาพตรวจสลิป
- [Bee Move client](https://client.beemove.co.th/): อ่านไม่ได้ด้วย web tool ครั้งนี้ ยังไม่มี contract ทางการให้ตรวจความเข้ากันได้กับ generic adapter
- แนวทาง scheduler ใน repo: `supabase/live-auctions-setup.md`, `supabase/facebook-webhook-cron-setup.md`; ตัว workflow ที่มีจริงคือ `.github/workflows/customer-tab-cron.yml` ซึ่งเรียก customer-tab reminders
