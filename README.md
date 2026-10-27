# SnapBot - Live Commerce & AI Chatbot (Next.js 15 App Router, Tailwind, Supabase)

แพลตฟอร์มหลายร้านค้า (multi-tenant) สำหรับไลฟ์ขายของผ่าน Facebook Page: รับแชท/คอมเมนต์, ระบบ CF ด้วยรหัสสินค้า, ตรวจสลิปอัตโนมัติด้วย SlipOK และแดชบอร์ดแอดมินแบบ Realtime

## รันครั้งแรก
ต้องใช้ Node.js 20 ขึ้นไป (แนะนำ 22 หรือ 24)

1. `npm install`
2. สร้าง `.env.local` จาก `.env.example` แล้วกรอกค่า (`copy .env.example .env.local` บน Windows, `cp` บน macOS/Linux)
   - ถ้า Supabase แสดงเป็น publishable key (`sb_publishable_...`) และ secret key (`sb_secret_...`) ให้ใส่ลงใน `NEXT_PUBLIC_SUPABASE_ANON_KEY` และ `SUPABASE_SERVICE_ROLE_KEY` ตามลำดับ
3. รันใน Supabase SQL editor **ตามลำดับ** (ทุกไฟล์รันซ้ำได้ปลอดภัย ใช้อัปเดตฐานข้อมูลเดิมด้วย):
   1. `supabase/schema.sql`: ลูกค้า ข้อความ คอมเมนต์ สลิป
   2. `supabase/tenants.sql`: ร้านค้า
   3. `supabase/comment-rules.sql`: กฎตอบกลับคอมเมนต์
   4. `supabase/platform.sql`: การตั้งค่าร้าน, CRM, เครดิต, Page token รายร้าน
   5. `supabase/orders.sql`: สินค้าและออเดอร์ CF
   6. `supabase/automation.sql`: บอทตอบแชท, ทวงสลิปอัตโนมัติ, บรอดแคสต์, เซลเพจ (ตั้ง cron ทวงสลิปได้ที่ท้ายไฟล์)
   7. `supabase/security.sql`: **สิทธิ์ทั้งหมด (RLS) ต้องรันเป็นไฟล์สุดท้ายเสมอ**
4. ตั้งตัวเองเป็นผู้ดูแลแพลตฟอร์ม (SQL editor):
   ```sql
   insert into platform_admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
   ```
5. ปิดการสมัครเอง: Supabase > Authentication > Sign In / Providers > ปิด **Allow new users to sign up** (ผู้ดูแลสร้างบัญชีให้ใน Authentication > Users)
6. `npm run dev` แล้วเปิด http://localhost:3000 → "ตั้งค่าร้านค้า" สร้างร้านแรก: ใส่ Page Access Token ของเพจ (ระบบอ่าน Page ID ให้), บัญชีรับเงิน, เครดิต

## AI Agent (Google Gemini)

โหมด AI ในหน้า "ผู้ช่วยตอบบทสนทนา" ใช้ `@google/genai` และโมเดล `gemini-3-flash-preview` ฝั่งเซิร์ฟเวอร์ ตั้งค่า API Key จาก Google AI Studio ใน `.env.local`:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
```

รีสตาร์ท `npm run dev` หลังตั้งค่า แล้วเลือกโหมด AI พร้อมกรอกข้อมูลร้านและคำแนะนำ ระบบส่งประวัติแชทล่าสุดและรายการสินค้าของร้านให้ Gemini และยังส่งต่อให้แอดมินหรือใช้ข้อความสำรองเมื่อ AI ตอบไม่ได้ ไม่มี SQL migration เพิ่มสำหรับการเปลี่ยน SDK นี้

## ชำระค่าแพ็กเกจอัตโนมัติ

หน้า `/billing` รองรับ QR พร้อมเพย์ตามยอด Starter 390 บาท / Pro 990 บาท และตรวจสลิปด้วย SlipOK เพื่อเพิ่มเครดิตและเปิดแพ็กเกจ 30 วันทันที ตั้งค่าผู้รับเงินจริงแทนค่า mock แล้วรัน `supabase/payments.sql` หลัง `billing.sql` และ `security.sql` ดูขั้นตอนและข้อกำหนดบัญชี SlipOK ที่ [payments-setup.md](supabase/payments-setup.md)

## สิทธิ์ผู้ใช้ (Multi-tenant)
| บทบาท | เก็บที่ | ทำอะไรได้ |
|---|---|---|
| ผู้ดูแลแพลตฟอร์ม | `platform_admins` | ทุกร้าน, สร้างร้าน, ปรับโควตาเครดิต, เห็นแชทจากเพจที่ยังไม่ผูกร้าน |
| เจ้าของร้าน (`owner`) | `tenant_members` | ทุกอย่างในร้านตัวเอง รวมบัญชีธนาคาร เพจ และ token |
| พนักงาน (`staff`) | `tenant_members` | แชท ตรวจ/อนุมัติสลิป CRM และสวิตช์ระบบอัตโนมัติ |

เพิ่มสมาชิกร้าน:
```sql
insert into tenant_members (tenant_id, user_id, role)
select '<tenant uuid>', id, 'owner' from auth.users where email = 'owner@shop.com' on conflict do nothing;
```
- RLS ทุกตาราง (`tenants`, `customers`, `messages`, `comments`, `slips`, `comment_rules`, `products`, `orders`) อ่านได้เฉพาะร้านที่เป็นสมาชิก (`can_access_tenant()`)
- API ทุกตัวใช้ service role จึงตรวจสิทธิ์ในโค้ดเอง (`lib/auth.ts`: `getActor`, `canAccessTenant`)
- `tenants.page_access_token` ไม่ถูกส่งไปที่เบราว์เซอร์ (column grant) หน้าเว็บเห็นแค่ `page_token_set`
- การเรียกแบบ server-to-server ใช้ `Authorization: Bearer <INTERNAL_API_SECRET>` (สิทธิ์เท่าผู้ดูแลแพลตฟอร์ม)

## หน้าจอ
| เมนู | path | หมายเหตุ |
|---|---|---|
| แดชบอร์ดสรุปยอด | `/overview` | Realtime: ยอดรับรายวัน 14 วัน (สลิปถูกต้อง + สลิปที่แอดมินอนุมัติเอง), สลิปค้างตรวจ, เครดิต |
| กล่องข้อความรวม | `/inbox` | รายชื่อแชท / แชท + การ์ดผลตรวจสลิป / แผงลูกค้า + สลิป, **แผงตอบกลับของแอดมิน** (ส่งผ่าน Messenger), สวิตช์ SlipOK Auto-Pilot และสวิตช์บอทรายแชท |
| ตรวจสอบสลิป | `/slips` | ประวัติ + ตัวกรอง + อัปโหลดตรวจเอง |
| จัดการลูกค้า | `/customers` | CRM: เบอร์, ที่อยู่, แท็ก, สถานะออเดอร์, ยอดสะสม |
| ตอบกลับคอมเมนต์ | `/comment-replies` | กฎตอบใต้คอมเมนต์ / ส่งเข้าอินบ็อกซ์อัตโนมัติ (รายร้าน) |
| ตั้งค่าร้านค้า | `/settings` | เพจ + Page Access Token, บัญชีธนาคาร, ยอดที่คาดหวัง, Auto-reply / Auto-verify, เครดิต |
| ใบเสร็จ | `/receipts/<slipId>` | พิมพ์ / บันทึก PDF ได้เฉพาะสลิปที่ผ่านหรืออนุมัติแล้ว |

ร้านที่เลือกใน Quick Switcher เก็บใน cookie `active_tenant` ทุกหน้ากรองข้อมูลตามร้านนี้

## ระบบอัตโนมัติใน Messenger
Webhook หาร้านจาก `entry.id` (Page ID) → `tenants.page_id` แล้วใช้ token, บัญชี และการตั้งค่าของร้านนั้น
**เพจที่ยังไม่ผูกร้าน: เก็บข้อความไว้อย่างเดียว ไม่ตอบ ไม่ตรวจสลิป (ไม่ใช้เครดิต SlipOK ของแพลตฟอร์ม)**

1. **CF ด้วยรหัสสินค้า**: ลูกค้าพิมพ์รหัส เช่น `1`, `A12`, `cf 3` → หา `products.code` ของร้าน (ไม่สนตัวพิมพ์เล็ก/ใหญ่) → ตัดสต็อกและสร้าง `orders` สถานะ `pending_payment` ในคำสั่งเดียว (`place_cf_order`) → ส่งสรุปยอดพร้อมเลขบัญชีกลับในแชท ถ้าสินค้าหมดจะแจ้งลูกค้า
   - เพิ่มสินค้าได้ที่ Supabase > Table editor > `products` (`tenant_id`, `code`, `name`, `price`, `stock`)
2. **Auto-Reply**: ข้อความอื่นตอบด้วย `lib/features/agents/bot.ts` (แก้คำตอบ หรือเปลี่ยนเป็น FAQ / LLM ได้ในไฟล์นี้) ปิดได้ทั้งร้าน (Settings) หรือรายแชท (สวิตช์บอทในกล่องข้อความ เมื่อแอดมินรับช่วงต่อ)
3. **SlipOK Auto-Pilot**: รูปในแชทถูกตรวจทันที ยอดที่ต้องตรง = ยอดรวมออเดอร์ CF ที่ค้างชำระ (ถ้ามี) ไม่งั้นใช้ "ยอดที่คาดหวัง" ของร้าน สลิปถูกต้อง → ออเดอร์เป็น `paid` และส่งการ์ด "ชำระเงินสำเร็จ" กลับไป

## เครดิตและการตรวจสลิป
- ตรวจ 1 สลิปใช้ 1 เครดิต (`consume_slip_credit` ตัดแบบ atomic) เครดิตหมด = ไม่เรียก SlipOK และบันทึกเป็น `error`
- **คืนเครดิตอัตโนมัติ** (`refund_slip_credit`) เมื่อ SlipOK timeout / เครือข่ายล่ม / รหัส 1000-1004, 1009, 1010 / ตอบกลับผิดรูปแบบ ส่วนรูปที่ไม่ใช่สลิป (1005-1008) ไม่คืน
- ร้านใช้บัญชีของตัวเอง: SlipOK ตอบ 1014 (บัญชีไม่ตรงกับบัญชีหลักของ branch) ระบบจะตรวจธนาคาร + เลขบัญชีกับของร้านแทน
- สลิปซ้ำข้ามร้าน: unique index `slips_one_valid_per_ref` ไม่มี tenant_id สลิปที่ผ่านแล้วที่ร้านหนึ่งจะเป็น `duplicate` ที่ร้านอื่นเสมอ
- สลิปค้าง `pending` เกิน 3 นาที (ฟังก์ชันถูกตัดกลางคัน) กด "ตรวจอีกครั้ง" ในแชทได้ ระบบปิดรายการเก่าเป็น `error` แล้วตรวจใหม่
- ทดสอบ:
  `curl -X POST http://localhost:3000/api/slips/verify -H "Authorization: Bearer <INTERNAL_API_SECRET>" -F file=@slip.jpg -F tenantId=<uuid> -F expectedAmount=199`

## Auth
- `middleware.ts` + `lib/supabase/middleware.ts` เช็คการล็อกอินทุกหน้า (ยกเว้น `/api`, `/login`, `/auth`) API ตรวจสิทธิ์เอง
- บัญชีที่ล็อกอินได้แต่ไม่อยู่ใน `platform_admins` / `tenant_members` จะไม่เห็นข้อมูลใดๆ

## Webhook
- ตั้ง Meta webhook ไปที่ `https://<โดเมน>/api/webhook/facebook` ใส่ Verify token ให้ตรงกับ `FB_VERIFY_TOKEN` (หรือ `FACEBOOK_VERIFY_TOKEN`) และ subscribe fields `messages`, `feed`
- ตอบ 200 ทันที แล้วประมวลผลใน `after()` (สูงสุด 60 วินาที) แต่ละ event มี try/catch ของตัวเอง event หนึ่งพังไม่กระทบ event อื่นใน batch
- Page token ต้องมีสิทธิ์ `pages_messaging` (ตอบแชท) และ `pages_manage_engagement` (ตอบคอมเมนต์)
- `FB_PAGE_TOKEN` ใน `.env.local` เป็น fallback สำหรับระบบเพจเดียวเท่านั้น และจะไม่ถูกใช้กับเพจอื่นนอกจาก `FB_PAGE_ID`

## ข้อจำกัดที่ควรรู้
- Messenger ไม่มี Flex Message (เป็นของ LINE) การ์ด "ชำระเงินสำเร็จ" ใช้ generic template ถ้า Meta ปฏิเสธจะส่งเป็นข้อความธรรมดาแทน
- ส่งข้อความหาลูกค้าได้ภายใน 24 ชั่วโมงนับจากข้อความล่าสุดของลูกค้า (นโยบาย Meta)
- ยังไม่มีหน้าจัดการสินค้า/ออเดอร์และสมาชิกร้านในแดชบอร์ด: จัดการผ่าน Supabase Table editor / SQL
- ถ้าเพิ่มคอลัมน์ใหม่ที่หน้าเว็บต้องอ่านใน `tenants` ต้องเพิ่มชื่อคอลัมน์ใน `grant select (...)` ของ `security.sql` และ `TENANT_COLUMNS` ใน `lib/types.ts`

[โครงสร้างโปรเจกต์และแนวทางอ้างอิงโมดูล](docs/PROJECT-STRUCTURE.md)

[แนวทางหน้าตาและการตรวจ UI](docs/INTERFACE-DESIGN.md)
