# SnapBot Sales Page Pro — 17 ตุลาคม 2026

## โครงสร้างและสิ่งที่พัฒนา

ใช้ Next.js App Router, React 19, Tailwind และ Supabase เดิม ไม่ได้สร้างโปรเจกต์ใหม่
ระบบเดิมมี `products`, CF `orders`, `/shop`, `/p/[id]`, ระบบตรวจสลิปและ Facebook
อยู่แล้ว จึงใช้สินค้าและสต็อกเดิม เพิ่มข้อมูลประกอบด้วย migration แบบเพิ่มโครงสร้าง
และแยกออเดอร์หน้าร้านเว็บออกจาก CF เพื่อไม่เปลี่ยนความหมายของสถานะ/ยอดค้างชำระเดิม

ไม่มีภาพต้นแบบ UI ในไฟล์ที่ได้รับ ใช้ธีมส้ม/ชมพูและคอมโพเนนต์เดิมเป็นแนวทาง
ภาพหน้าจอในรายงานมาจาก React คอมโพเนนต์จริงที่รันใน Chrome กับข้อมูลทดสอบออฟไลน์
ไม่ใช่หน้าร้านหรือข้อมูลยอดขายจริง

พัฒนาเมนู `/shop?tab=...` ครบ 8 ส่วน:

1. **overview** ภาพรวม: จำนวนสินค้า ยอดรับชำระวันนี้ ออเดอร์วันนี้ ลูกค้า
   รอชำระ รอจัดส่ง กราฟ 14 วัน สินค้าขายดี สต็อกใกล้หมดและออเดอร์ล่าสุด
2. **products**: เพิ่ม/แก้ไข/คัดลอก/นำออกจากการขาย ค้นหา หมวดหมู่ เรียงราคา/วันที่
   SKU ตามรูปแบบ CF เดิม ราคาเปรียบเทียบ ต้นทุน รูปสูงสุด 8 รูป สถานะสินค้าแนะนำ
   ตัวเลือกสี/ขนาดพร้อมราคา/สต็อก และตัวอย่างสินค้า
3. **categories**: เพิ่ม แก้ชื่อ ลบหมวดหมู่ โดยไม่ลบสินค้า
4. **orders**: สถานะ 7 ขั้น รายการ/ราคา snapshot ข้อมูลจัดส่ง ประวัติ ผู้ดำเนินการ
   หลักฐานเปลี่ยนสถานะ เลขพัสดุ ยกเลิกและคืนสต็อกครั้งเดียว
5. **editor**: หลายหน้า เทมเพลตพื้นฐาน/พรีเมียม เพิ่ม/ลบ/เลื่อนส่วนประกอบด้วยปุ่ม
   ที่ใช้คีย์บอร์ดได้ แก้ข้อความ ภาพ สี ป้ายปุ่ม ดูตัวอย่างมือถือ/คอมพิวเตอร์
   บันทึกร่าง เผยแพร่ฉบับที่บันทึก และยกเลิกเผยแพร่
6. **customers**: ลูกค้าหน้าร้านพร้อมจำนวนออเดอร์ ไม่ตีความว่าให้ความยินยอมรับการตลาด
7. **reports**: กราฟรายวันและสรุปรายเดือน วันที่รับชำระตามเวลาไทย ไม่รวมยกเลิก
   รายงานรายเดือนสร้างฝั่ง Backend ตามสิทธิ์จริง
8. **settings**: ชื่อ/ลิงก์/โลโก้/แบนเนอร์/คำแนะนำ/การติดต่อ และเปิด–ปิดร้าน

หน้าร้าน `/s/[slug]` และเซลเพจ `/s/[slug]/[page]` รองรับค้นหา หมวดหมู่
สินค้าแนะนำ รูป/รายละเอียดสินค้า ตัวเลือก จำนวน ตะกร้า ข้อมูลจัดส่ง และสั่งซื้อ
ราคาทั้งหมดคำนวณจากฐานข้อมูล ไม่รับราคาใน Browser เป็นราคาจริง
หน้าแรกของร้านมีแค็ตตาล็อกพื้นฐานแม้ยังไม่เผยแพร่แบบ `home`
การยกเลิกเผยแพร่ `home` เอาเฉพาะแบบออก **หากต้องการหยุดหน้าร้านทั้งหมดให้ปิดร้าน**

## ขอบเขตการเชื่อมระบบเดิม

- ใช้ `products.stock` ร่วมกับ CF เดิม และเพิ่ม version เพื่อป้องกันการแก้สินค้าทับยอดขาย
- `place_cf_order` รักษาผลลัพธ์เดิมสำหรับสินค้าปกติ สินค้าที่มีตัวเลือกจะคืน `no_match`
  โดยไม่ตัดสต็อก เพื่อไม่ให้ CF สร้างออเดอร์ที่ไม่ระบุสี/ขนาดหรือใช้ราคาผิด
  สินค้าที่มีตัวเลือกต้องซื้อบนหน้าร้านเว็บ ทดสอบทั้งกรณีนี้และสินค้าปกติแล้ว
- ระบบ CF orders, สลิป, ยอดค้างชำระ, workflow และการส่ง Facebook เดิมยังใช้เส้นทางเดิม
  มีลิงก์ `/shop?legacy=1` สำหรับข้อมูล/เครื่องมือเดิม ไม่มีการย้ายหรือลบข้อมูลเดิม
- ออเดอร์เว็บอยู่ `commerce_orders` ลูกค้าอยู่ `commerce_customers`
  ไม่สร้าง PSID ปลอม ไม่จับคู่ CRM จากชื่อหรือเบอร์โดยเดา
  มี `crm_customer_id` เผื่อการจับคู่ที่ยืนยันสิทธิ์จริงในอนาคต แต่ยังไม่มี auto-sync
- ยังไม่เชื่อมออเดอร์เว็บเข้ากับการตรวจสลิป/บัญชีรับเงิน/การแจ้งเตือน Facebook/
  งานติดตามอัตโนมัติ เพราะ pipeline เดิมผูกกับลูกค้าแชทและ CF orders
  ไม่ควรยืนยันว่าเงินเข้า หรือส่งข้อความ หากยังไม่มีการจับคู่และสิทธิ์ที่ตรวจแล้ว
  ลูกค้าจะได้รับเลขออเดอร์และช่องทางติดต่อร้าน การรับชำระเป็นขั้นตอนตรวจหลักฐานด้วยคน
- สถานะ `paid` ต้องผ่าน `payment_review` และผู้จัดการต้องระบุหลักฐานการรับเงินจริง
  มี audit ว่าใครยืนยัน นี่ไม่ใช่ผลตรวจสลิปอัตโนมัติ
- การยกเลิกคืนเฉพาะสต็อก ไม่โอนเงินคืนอัตโนมัติ ร้านต้องดำเนินการคืนเงินจริงเอง
- ไม่มีการสร้างค่าส่ง ภาษี โปรโมชันส่วนลด รีวิวจริง AI หรือผลขนส่งจากข้อมูลสมมุติ
  บล็อกโปรโมชั่นเป็นเนื้อหา ไม่ใช่เครื่องคิดส่วนลด รีวิวต้องกรอกข้อมูลจริงที่ได้รับอนุญาต
  ค่าส่งเพิ่มเติมต้องสอบถามร้านก่อนชำระ ไม่ได้เรียกเก็บเงินอัตโนมัติ

## Database migration และแพ็กเกจ

ไฟล์: `supabase/commerce-v2.sql`

ก่อนใช้ ต้องมี schema เดิม: `schema.sql`, `platform.sql`, `orders.sql`,
`automation.sql` (เพิ่ม description/image ของสินค้า), `billing.sql`,
`security.sql` และ Storage `comment-media` จาก `comment-rules.sql`
ตรวจตามลำดับติดตั้งจริงของโปรเจกต์ ไม่ควรรันไฟล์เก่าทับการตั้งค่าปัจจุบันโดยไม่ตรวจ

ทดสอบ migration ซ้ำสองครั้งบน PGlite ในเครื่องแล้ว ยังไม่ได้รันบน Supabase จริง
ให้สำรองฐานข้อมูลและทดสอบ migration บน staging ก่อนนำไป production

เพิ่มตาราง:

- `commerce_limits`, `commerce_stores`, `commerce_categories`, `commerce_variants`
- `commerce_pages`, `commerce_customers`, `commerce_orders`, `commerce_order_items`
- `commerce_audit`, `commerce_rate`

เพิ่มคอลัมน์ `commerce_*` ใน products ไม่เปลี่ยนข้อมูลสินค้าเก่า ไม่ลบตาราง
สินค้าที่ผู้ใช้กดลบจะถูกซ่อน/ปิดขาย ประวัติออเดอร์และตัวเลือกที่อ้างอิงยังอยู่

สิทธิ์ระบบใหม่อ่านจาก `commerce_limits` และแผน/วันหมดอายุจริงของ tenants:

| แผน | จำนวนสินค้า | เซลเพจ | รับออเดอร์เว็บ | รายงาน | เทมเพลตพรีเมียม |
|---|---:|---:|---|---|---|
| free | ไม่เปลี่ยนเพดานเดิม (`NULL`) | 1 | ปิด | ปิด | ปิด |
| starter | ไม่เปลี่ยนเพดานเดิม (`NULL`) | 3 | เปิด | เปิด | ปิด |
| pro | ไม่เปลี่ยนเพดานเดิม (`NULL`) | 10 | เปิด | เปิด | เปิด |

ค่าเหล่านี้เป็นค่าตั้งต้น **เฉพาะความสามารถใหม่** ไม่แก้ `plan_features`
หรือสิทธิ์เดิมของสมาชิก ไม่มีการลดจำนวนสินค้าเดิมจากไม่จำกัดเป็นโควตาตามตัวอย่าง
เจ้าของแพลตฟอร์มควรตรวจ/ปรับ configuration นี้บน staging ก่อนเปิดให้สมาชิกใช้
`max_products` ตั้งจำนวนได้ในฐานข้อมูล และ trigger บังคับกับ legacy inserts ด้วย
ข้อมูลที่เกินโควตาหลังลดแพ็กเกจไม่ถูกลบ การสร้างใหม่/เผยแพร่จะตรวจสิทธิ์อีกครั้ง

## Feature Flags และการเปิดใช้

ยังไม่ได้เปลี่ยน `.env.local` หรือเปิดระบบใหม่ให้ production
ค่า master ไม่ตั้ง/ไม่ใช่ `true` จะใช้ร้านค้าเดิม

```dotenv
SALES_PAGE_V2_ENABLED=true
STORE_DASHBOARD_V2_ENABLED=true
PRODUCT_MANAGER_V2_ENABLED=true
STOREFRONT_V2_ENABLED=true
SALES_PAGE_EDITOR_V2_ENABLED=true
```

เมื่อ master เปิด flags ย่อยจะเปิดเว้นแต่ตั้ง `false` flags ฝั่ง server ไม่ต้องใช้
`NEXT_PUBLIC_*` และไม่ใส่ secret ใหม่

ลำดับเปิดใช้:

1. ติดตั้ง migration บน staging ตรวจ role/membership และ bucket เดิม
2. ตรวจ `commerce_limits` ให้ตรงแพ็กเกจที่อนุมัติ
3. เปิด flags บน staging แล้ว restart/redeploy ตามวิธีรันระบบ
4. ทดสอบด้วยร้านทดสอบและข้อมูลทดสอบเท่านั้น
5. ตั้งค่าร้าน เพิ่มสินค้า บันทึกเซลเพจ แล้วค่อยเปิดหน้าร้าน
6. ตรวจและอนุมัติขั้นตอนรับชำระ/จัดส่ง/ดูแลข้อมูลลูกค้า ก่อนเปิด production

Rollback:

- ปิดเฉพาะ UI: `STORE_DASHBOARD_V2_ENABLED=false`, `PRODUCT_MANAGER_V2_ENABLED=false`,
  `SALES_PAGE_EDITOR_V2_ENABLED=false` หรือเปิด `/shop?legacy=1`
- ปิดหน้าร้าน/checkout: `STOREFRONT_V2_ENABLED=false`
- กลับทั้งระบบ: `SALES_PAGE_V2_ENABLED=false` แล้ว restart/redeploy
- ไม่ drop ตาราง ไม่ลบข้อมูลหรือ variant และไม่ย้อน schema ระหว่างมีออเดอร์ค้าง
- ปิด master แล้ว API ใหม่หยุดด้วย ข้อมูลออเดอร์ใหม่ยังอยู่ครบ ต้องเปิดระบบใหม่กลับมา
  เพื่อจัดการออเดอร์เหล่านั้น จัดการคำสั่งซื้อค้าง/คำขอที่ยังไม่ทราบผลก่อน maintenance
- ไม่ควรย้อน `place_cf_order` ให้ขาย variant แบบไม่ระบุตัวเลือก หรือถอด quota/version
  trigger ขณะยังใช้สต็อกร่วม หากต้องย้อน schema จริงให้วางแผนย้ายข้อมูลแยกต่างหาก

## Security และข้อจำกัดที่ต้องรับทราบ

ทุก API จัดการร้านตรวจ Supabase session, active tenant, role เจ้าของ/แอดมิน
และ RLS/service-role boundaries ฝั่ง server Staff อ่านได้แต่แก้ไม่ได้
ตารางใหม่และ RPC ไม่เปิดให้ anon/authenticated เรียกตรง
Public storefront ส่งเฉพาะข้อมูลสินค้าเปิดขายและคอลัมน์ปลอดภัย ไม่ส่งต้นทุน
ข้อมูลลูกค้า shipping หรือ Page token และไม่ส่ง variant ของสินค้าที่ซ่อน

Mutations ตรวจ Origin เดียวกัน มี validation และขนาด JSON จำกัด
Rate limit เก็บในฐานข้อมูล (จัดการ 90/นาทีต่อผู้จัดการ, อัปโหลด 30/นาที,
checkout 10/นาทีต่อ IP/ร้าน และ 120/นาทีต่อร้าน) ต้องให้ reverse proxy
เขียน `X-Forwarded-For` จากต้นทางที่เชื่อถือได้และกำหนด request body limit 6 MB
ที่ hosting/proxy ด้วย Rate limit ไม่ใช่ระบบป้องกัน DDoS เต็มรูปแบบ

รูปต้อง JPG/PNG/WebP จริง ไม่เกิน 5 MB จำกัดพิกเซล ถอด metadata และแปลงเป็น WebP
ชื่อ Storage สร้างจาก tenant UUID + random UUID ฝั่ง server ไม่ใช้ชื่อไฟล์จากผู้ใช้
ใช้ bucket public เดิมเพราะรูปสินค้าต้องแสดงให้ลูกค้าดู ห้ามใส่เอกสารส่วนตัวในรูปสินค้า
รูปที่อัปโหลดแล้วไม่ได้บันทึกอาจเป็น orphan ต้องมีงาน cleanup ที่ตรวจการอ้างอิงก่อนลบ

Editor ไม่รองรับ raw HTML/JavaScript/iframe URLs ของปุ่มเป็น anchor ไปสินค้าร้านเท่านั้น
ข้อความถูก escape โดย React และ URL รูปต้อง HTTPS ไม่รับ `javascript:`/`data:`

Checkout อ่านราคาใหม่ใน transaction ล็อก tenant/product/variant ตัดสต็อก
สร้าง customer/order/items/audit พร้อมกัน คืนสต็อกเมื่อยกเลิกครั้งเดียว
ข้อมูลจัดส่ง snapshot คงไว้แม้แก้ข้อมูลลูกค้าทีหลัง
Idempotency ผูก tenant+request UUID และ payload เดิม คำขอเปลี่ยนเนื้อหาแต่ใช้ key เดิมถูกปฏิเสธ
หาก network ไม่ทราบผล หน้าเว็บเก็บคำขอเดิมชั่วคราวใน sessionStorage ของแท็บ
และหยุดแก้ตะกร้า ให้ retry key เดิมก่อนเริ่มรายการใหม่ ลบข้อมูลชั่วคราวเมื่อสำเร็จ
ไม่ควรเปิดแท็บใหม่สั่งซ้ำในขณะที่ยังไม่ทราบผล ต้องกำหนดนโยบาย retention ของ shipping,
เบอร์โทร และ audit ในฐานข้อมูลจริงก่อนเปิด production

ตัวเลขภาพรวม/รายงานในหน้าร้านใหม่เป็นออเดอร์เว็บ ไม่แอบรวม CF orders เพื่อไม่ทำให้ยอดซ้ำ
กราฟรายวัน 14 วันและรายเดือนนับวันที่ชำระตาม Asia/Bangkok
การโหลดข้อมูลใช้ pagination ฝั่ง server เพื่อไม่ตกหล่นที่ PostgREST 1,000 แถว
แค็ตตาล็อก/รายงานยังส่ง snapshot ไป client จึงต้องทดสอบปริมาณจริงก่อนใช้ร้านขนาดใหญ่
Audit ที่แสดงหน้าเว็บจำกัด 300 เหตุการณ์ล่าสุด (ประวัติเต็มอยู่ในฐานข้อมูล)
ยังไม่มีระบบ export/report warehouse, payment gateway, auto-expire abandoned stock,
real shipping integration หรือระบบ CRM/notification ของออเดอร์เว็บ

## API และไฟล์สำคัญ

- `GET /api/commerce?tenantId=...` โหลดข้อมูลร้านที่มีสิทธิ์
- `POST /api/commerce` action: product, archive, category, category_delete, store,
  page, publish, unpublish, order; ทุก mutation ตรวจ role และ tenant ใหม่
- `POST /api/commerce/media?tenantId=...` รูปสินค้า/ร้าน/เซลเพจ
- `POST /api/storefront/[slug]/checkout` สั่งซื้อแบบ transaction และ idempotency
- Public pages `/s/[slug]`, `/s/[slug]/[page]` ดึงเฉพาะ published snapshot

ไฟล์ใหม่หลัก: `lib/commerce-core.ts`, `lib/commerce-server.ts`,
`components/shop/CommerceWorkspace.tsx`, `CommerceProducts.tsx`, `CommerceEditor.tsx`,
`CommerceDesign.tsx`, `CommerceStorefront.tsx`, API/หน้า public ข้างต้น,
หน้า loading/error, migration และชุดทดสอบ `scripts/test-commerce*.cjs`

ไฟล์เดิมที่แก้สำหรับงานนี้: `app/(dashboard)/shop/page.tsx`, `middleware.ts`,
`lib/supabase/middleware.ts` และปรับ regression test ของ Sidebar ให้ตรงกับ
การเปลี่ยน `/slips?tab=banks` และข้อความไม่มีชื่อผู้ให้บริการจากงานก่อนหน้า

## ผลทดสอบจริง

- `node --test scripts/test-commerce.cjs scripts/test-commerce-sql.cjs scripts/test-commerce-media.cjs`
  ผ่าน 12 tests (unit, service/API boundary, upload และ SQL integration)
- SQL integration ทดสอบ migration ซ้ำ, permissions, tenant isolation, สินค้า/หมวดหมู่ CRUD,
  optimistic version, draft/published snapshot, quota, ราคา server, idempotency,
  stock contenders, variants, transition 7 สถานะ, refund stock ครั้งเดียวและ CF compatibility
- ใช้ PostgreSQL/WASM PGlite ในเครื่อง ไม่ใช่ Supabase production
  การทดสอบคำขอแข่งกันใช้ local engine ที่ serialize คำสั่ง ยังไม่ใช่ load test หลาย PostgreSQL connections
- ชุดทดสอบ commerce + regression สลิป/Facebook/auth/feature access/message quota/safety:
  ผ่าน 59 tests ดูรายชื่อคำสั่งและผลในรายงานการทำงาน ไม่ส่ง outbound จริง
  คำสั่งที่รัน:

  ```powershell
  node --test scripts/test-commerce.cjs scripts/test-commerce-sql.cjs scripts/test-commerce-media.cjs scripts/test-payment-validation.cjs scripts/test-slip-order-total.cjs scripts/test-facebook-auth-flow.cjs scripts/test-feature-access-api.cjs scripts/test-message-quota.cjs scripts/test-automation-safety.cjs scripts/test-feature-restoration.cjs
  ```

- `npm.cmd run lint`: 0 errors, 19 warnings รวม native merchant images และ warnings เดิม
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: ผ่าน
- `npm.cmd run build`: ผ่าน
- `node scripts/check-commerce-browser.cjs`: actual React components ใน Chrome,
  mocked APIs เท่านั้น ทดสอบเพิ่มสินค้า ร่าง/เผยแพร่เซลเพจ ตะกร้า/checkout และ
  ไม่มี horizontal overflow ที่ 375/768/1440px
- ภาพ: `docs/screenshots/commerce-dashboard-{375,768,1440}.png`,
  `commerce-storefront-{375,1440}.png` มีป้ายข้อมูลทดสอบชัดเจน

ยังไม่ได้ทดสอบ Supabase ที่ติดตั้งจริง, production RLS/Storage configuration,
real customer checkout, load หลาย worker, payment/Meta/shipping ภายนอก หรือเงินจริง
จึงควรเปิด staging ก่อน และยังไม่ถือเป็นการรับรองว่า production พร้อมเปิดขายทันที
