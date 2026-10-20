# Smart Follow-up Assistant — ติดตั้งและทดสอบ

ใช้ Next.js App Router, Supabase Auth/Postgres/Realtime, Facebook Messenger, Gemini, เครดิตข้อความ และระบบตรวจสลิปเดิม ไม่มีบริการ queue หรือ payment จำลอง

## สถานะและสิ่งที่ต้องตั้งค่า

- COMPLETED: Workflow 3 ประเภท, Dashboard 6 ส่วน, atomic claims, delivery leases, quota reservation, opt-out, quiet hours, audit logs, review queue, human handoff และการยืนยันหลักฐานส่งถึง
- Dashboard แสดงแพ็กเกจ/วันหมดอายุ/ยอดเครดิตจริงจาก server และมีปุ่มหยุดติดตามรายลูกค้า/รับช่วงใน Inbox ไม่ต้องเปิดหลายหน้าก่อนสั่งหยุด
- TESTED: ดูผลคำสั่งจริงในรายงาน `docs/smart-followups-implementation.md` Tests ใช้ mock provider และ PGlite แยกจากฐานข้อมูลจริง
- REQUIRES CONFIGURATION: สำรองฐานข้อมูล, รัน migration, ตั้ง Page token/Gemini/CRON_SECRET, ตั้ง scheduler และอนุมัติเปิดส่งจริงด้วย environment flag
- NOT IMPLEMENTED: ดึงสถานะส่งถึงจากบริษัทขนส่งอัตโนมัติ ขณะนี้เจ้าของร้านต้องตรวจและบันทึกหลักฐานจริง ไม่ตีความ `shipped` ว่า `delivered`
- ไม่ Deploy ไม่รัน migration จริง และไม่ส่งข้อความให้ลูกค้าจริงระหว่างการพัฒนา

## Migration และสำรองข้อมูล

1. สำรองฐานข้อมูลผ่าน Supabase backup/PITR หรือ `pg_dump` ตามระบบที่ใช้อยู่ รวม `tenants`, `customers`, `messages`, `orders`, `slips`, `bot_settings`, `follow_up_jobs` และทดสอบ restore ในฐานข้อมูลทดสอบ **ก่อน** แก้ฐานข้อมูลจริง
2. ตรวจว่า migration เดิมครบ: `automation.sql`, `security.sql`, `package-access.sql`, `feature-access.sql`, `free-message-quota.sql`, `inbox-realtime.sql`, `smart-inbox.sql`
3. รัน `smart-follow-ups.sql` แล้วรัน **`smart-follow-up-presend.sql` เป็นไฟล์สุดท้าย** ก่อน deploy โค้ดนี้ รันซ้ำได้ คงประวัติและข้อความเดิม ไม่รีเซ็ตเครดิต ไม่สร้างการชำระสำเร็จ ไม่ส่ง network request
4. ตารางใหม่: `follow_up_policies`, `follow_up_workflows`, `follow_up_execution_logs`, `order_delivery_events` งานยังใช้ `follow_up_jobs` เดิม เพิ่ม state/claim/dispatch/usage/source columns และ index
5. Realtime ต้องเปิด `follow_up_jobs`, `follow_up_workflows`, `follow_up_policies` Migration เพิ่มสองตารางหลังเข้า publication ที่มีอยู่
6. หากรัน `security.sql` รุ่นเก่าซ้ำหลัง migration ให้รัน `smart-follow-ups.sql` แล้วตามด้วย `smart-follow-up-presend.sql` ซ้ำ เพื่อคืนการยกเลิกงานผ่าน audited API และการตรวจซ้ำก่อนส่ง

## การตรวจออเดอร์และสลิปก่อนส่ง

- ใช้สวิตช์หลักเดียวควบคุมการติดตามค้างชำระ ต้องกดบันทึกการตั้งค่า ส่วนการติดตามสนใจสินค้า/หลังการขายคงตัวเลือกเปิดใช้แยกกัน การติดตั้งจะปรับสวิตช์ค้างชำระให้ตรงกับสวิตช์หลักที่ร้านบันทึกไว้ แต่ไม่เปิดฟลากส่งจริง
- เมื่อมีสลิปใหม่ ระบบพักคิวค้างชำระของลูกค้าในร้านเดียวกันทันทีหากยังไม่เริ่มส่ง โดยเทียบเวลาสลิปกับเวลาสร้างออเดอร์ สลิปเป็นเหตุให้รอตรวจสอบ ไม่ใช่หลักฐานยืนยันว่ารับเงินสำเร็จ
- ตรวจออเดอร์/สลิปอีกครั้งผ่าน `authorize_follow_up_dispatch` หลังเตรียมข้อความและก่อนเรียกผู้ให้บริการ หากชำระแล้ว ยกเลิกออเดอร์ หรือมีสลิปเข้า จะไม่เรียกส่ง และคืนเครดิตข้อความที่จองไว้พร้อมปลดล็อกห้องแชท
- ตรวจเวลาถึงกำหนด สิทธิ์แพ็กเกจ สถานะพักแชท การรับช่วงของแอดมิน และช่วงตอบกลับ 24 ชั่วโมงซ้ำด้วย ถ้าตรวจไม่ได้ให้หยุดส่ง และคงการป้องกันส่งซ้ำ
- ประวัติแยกเหตุการณ์ตรวจผ่าน/ระงับก่อนส่งพร้อมเหตุผล ส่วนการปิดส่งระดับเซิร์ฟเวอร์บันทึกในบันทึกการทำงานของเซิร์ฟเวอร์ โดยไม่จองคิวหรือหักเครดิต
- ตารางสลิปปัจจุบันไม่มีรหัสออเดอร์ จึงพักทุกออเดอร์ค้างชำระของลูกค้ารายเดียวกันที่สร้างก่อนสลิปนั้น เพื่อให้แอดมินตรวจสอบก่อน ไม่ตีความสลิปเก่าก่อนสร้างออเดอร์เป็นการจ่ายออเดอร์ใหม่
- การตรวจอ้างอิงข้อมูลที่บันทึกสำเร็จก่อนอนุญาตส่งครั้งสุดท้าย ไม่สามารถเรียกคืนข้อความที่ส่งออกไปแล้ว หรือรับประกันการเปลี่ยนข้อมูลหลังอนุญาตส่งได้
- หากยังไม่ติดตั้ง SQL ใหม่ ตัวส่งจะหยุดส่งเมื่อเรียกจุดตรวจใหม่ไม่ได้ และคืนเครดิตที่จองไว้ ไม่ย้อนกลับไปใช้การส่งที่ข้ามการตรวจ

ทดสอบส่วนนี้ด้วย `node scripts/test-smart-followup-presend-sql.cjs` และ `node --test scripts/test-smart-followups.cjs` ในฐานข้อมูลทดสอบแยก ไม่มีการส่งข้อความจริง ใช้ `node scripts/check-smart-followup-browser.cjs` หลังบิลด์เพื่อตรวจคอมโพเนนต์จริงใน Chrome พร้อมข้อมูลทดสอบ ขนาด 375/768/1440 พิกเซล

## สิทธิ์แพ็กเกจ

รักษาสิทธิ์เดิมที่ยืนยันแล้ว: Free ถูกล็อก ไม่มี trial 5 งาน; Starter ใช้ค้างชำระได้สูงสุด 3 ขั้น ไม่ลดเหลือ 2 ขั้น; Pro เพิ่ม Workflow สนใจสินค้า/หลังการขายและ AI ใช้ `has_tenant_feature` จากฐานข้อมูลพร้อม tenant active และวันหมดอายุ ไม่มี bypass สำหรับ admin

Workflow ใหม่ขั้นสูงและ AI ใช้สิทธิ์ `ai_agent` ของ Pro ร่วมกับ `customer_follow_up` ยังไม่เพิ่ม plan keys ซ้ำซ้อน ตัวอย่างข้อจำกัดใน prompt ไม่ได้ลดสิทธิ์ลูกค้าเดิม

## Workflow และการหยุด

- Payment: ออเดอร์จริงสถานะ `pending_payment` และ `confirmed_at` เท่านั้น CF order ที่อ้างอิงข้อความจริงถือเป็นยืนยันแล้ว ออเดอร์ที่สร้างทางอื่นให้เจ้าของร้านกด “ยืนยันออเดอร์” ในหน้าร้าน การยืนยันนี้ **ไม่ใช่** การยืนยันชำระเงิน
- เทมเพลตใหม่เริ่ม 30 นาที / 180 นาที ร้านเดิมคงเวลาและข้อความที่บันทึกไว้ เปลี่ยนเป็นเทมเพลตใหม่ได้ใน editor
- Interested: ใช้ Gemini จำแนกข้อความล่าสุดกับ catalog สินค้าจริง (50 สินค้า active และ 8 ข้อความล่าสุด) ตรวจ product ID และ tenant ซ้ำ ไม่สร้างงานจากผลไม่แน่ชัด ต้องไม่มีออเดอร์ที่ใหม่กว่าข้อความนั้น และไม่มีข้อความใหม่กว่าระหว่างวิเคราะห์
- After-sales: เจ้าของร้านบันทึกเลขพัสดุ/หลักฐานพร้อมวันเวลาส่งถึงจริงจากออเดอร์ `shipped` ผ่านปุ่มในหน้าร้าน เก็บผู้ยืนยันและหลักฐาน ไม่เริ่มจากสถานะจัดส่งอย่างเดียว
- AI ร่างข้อความเพื่อให้ผู้ดูแลตรวจ ไม่อนุมัติเนื้อหา AI เอง สนใจสินค้าแบบใช้ข้อความสำเร็จรูปใช้ AI แค่จำแนกเจตนา ข้อความที่ส่งใช้ template ร้าน ส่วนเปิดตัวเลือกตรวจร่างจะเข้าคิว `requires_review` ให้แก้/ขอ AI ช่วยร่างก่อนอนุมัติ
- พบข้อร้องเรียนหลังมีหลักฐานส่งถึง: พักบอทผ่าน handoff/lease เดิมและหยุดงานติดตาม ลูกค้าอยู่ในแชทรอแอดมินของ Inbox
- ก่อนส่งจริงตรวจซ้ำ: ร้าน/แพ็กเกจ/workflow/version, เครดิต, opt-out/พักติดตาม, assignee/บอท/แชทปิด, สถานะออเดอร์/สลิป/หลักฐาน, การตอบกลับ, rate limits, quiet hours และช่วงเวลา Messenger
- รับแชท/opt-out/ยกเลิกหรือชำระแล้วจะหยุดงานที่ยังไม่ dispatch งาน network ที่เริ่มไปแล้วอาจเสร็จได้ จึงใช้ lease กันแอดมินรับช่วงระหว่างส่ง และไม่อ้างว่าสามารถเรียกคืนข้อความที่ส่งออกไปแล้วได้
- การบันทึก settings ยกเลิกงานที่ยังไม่ส่งจากการตั้งค่าเก่า ใช้เวอร์ชันใหม่กับออเดอร์/เหตุการณ์ใหม่ ไม่สร้าง reminder เก่าย้อนหลังเอง
- คำสั่งลูกค้าแบบตรงตัว: `STOP`, `UNSUBSCRIBE`, `ไม่รับข้อความ`, `หยุดส่งข้อความ`, `ยกเลิกติดตาม`, `ไม่ต้องส่งแล้ว` หยุดติดตาม โดยไม่ต้องมีแพ็กเกจให้ webhook บันทึกความต้องการนี้
- กลับมารับติดตามได้ด้วยข้อความจริง `START`, `SUBSCRIBE`, `เริ่มติดตาม`, `รับข้อความติดตาม` ผู้ดูแลสั่ง opt-in แทนลูกค้าไม่ได้ การพักติดตามเป็นนโยบาย follow-up ไม่ระงับข้อความบริการอื่นของระบบ

## ความปลอดภัยการส่งและเครดิต

- Worker ใช้ `FOR UPDATE SKIP LOCKED` จองงานครั้งละ 1 งาน มี token/lease/attempts เก็บในฐานข้อมูล
- ก่อนเรียก Meta บันทึก dispatch marker และ `messages.external_id = followup:<job uuid>` พร้อมจองเครดิต shared broadcast/auto-reply และ customer delivery lease ใน transaction เดียว
- Restart ก่อน dispatch: คืนเข้าคิว delay 10 วินาที สูงสุด 3 attempts; restart/timeout หลัง dispatch: `requires_review` ไม่มี auto retry
- Meta รับแล้วแต่บันทึกผลล้มเหลว: เก็บคิวไว้ให้ recovery เปลี่ยนเป็น review แทนส่งซ้ำ การส่งครั้งเดียว/มากที่สุดหนึ่งครั้งอาจทำให้บางงานต้องตรวจเองเมื่อ process หยุดหลังเตรียมงานแต่ก่อน network นี่เป็นการเลือกป้องกันข้อความซ้ำ
- คืนเครดิตเฉพาะเมื่อ Meta ปฏิเสธแน่ชัด หรือ preflight transaction ไม่สำเร็จ ผลไม่แน่นอนเก็บเครดิตจองไว้เพื่อไม่คืนเครดิตของข้อความที่อาจส่งสำเร็จแล้ว
- Rate limit นับ dispatch attempts รวมผลไม่แน่นอน/การปฏิเสธ เพื่อป้องกันรบกวนจากการลองซ้ำ ไม่ถือว่าเป็นสถิติผู้รับอ่านจริง
- `sent` หมายถึงได้ provider message ID; `delivered/read` ของ bubble อาศัย signed Facebook webhook เดิม สถิติ “ตอบกลับ” อ้างอิงข้อความขาเข้าที่บันทึกจริง ไม่ใช่ AI คาดเดาหรือยอด conversion ที่ยืนยันเหตุไม่ได้
- นอกหน้าต่าง 24 ชม. สร้างงานแอดมิน ไม่ใช้ HUMAN_AGENT หรือ tag เพื่อหลบข้อจำกัด [Meta Send API](https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api)
- API ทุกเส้นตรวจ session/tenant/feature จาก server ยืนยันหลักฐานส่งถึง/ยืนยันออเดอร์/พักติดตามต้อง owner; การแก้ Workflow และตรวจร่างใช้สมาชิกของร้านตามสิทธิ์เดิม RPC ของ worker มีเฉพาะ service role

## เปิดใช้งานจริงหลังอนุมัติและทดสอบเพจทดสอบ

ตั้งค่าฝั่ง server เท่านั้น:

```dotenv
SMART_FOLLOW_UP_SEND_ENABLED=false
# ตั้งเป็น true เฉพาะเมื่อพร้อมเปิดส่งจริง แล้ว restart/deploy
CRON_SECRET=<random-secret>
GEMINI_API_KEY=<server-only-key>
```

ใช้ Page Access Token ของ tenant เดิม ไม่ใช้ token ร่วมผิดเพจ ตั้ง Facebook webhook `/api/webhook/facebook`, app secret และสิทธิ์ `pages_messaging` ตามระบบเดิม

ตั้ง scheduler ทุก 1 นาทีให้เรียก `POST /api/cron/follow-ups` พร้อม `Authorization: Bearer <CRON_SECRET>` หรือใช้ `GET` สำหรับ scheduler ที่รองรับ วิธีตั้ง pg_cron/pg_net ดูตัวอย่างใน `automation.sql` เปลี่ยน URL/secret ให้ถูกต้องก่อนเปิดจริง ไม่มี scheduler ถูกติดตั้งอัตโนมัติ

ในเครื่อง:

```powershell
npm.cmd install
npm.cmd run dev
# เปิด /chatbot/follow-ups
```

## ทดสอบก่อนส่งจริง

1. สร้างฐานข้อมูล staging และเพจทดสอบ รัน migrations และเพิ่ม owner/staff คนละร้าน
2. คง flag false ตรวจ UI/API unauthorized/cross-tenant และสิทธิ์ Free/Starter/Pro/หมดอายุ
3. เปิดส่งเฉพาะ staging หลังอนุมัติ ใช้ผู้รับทดสอบสร้าง CF order → ตรวจคิว 30/180 นาที → ทดสอบชำระ/ยกเลิก/ส่งสลิป/STOP/รับแชทก่อน due
4. ทดสอบ quiet hours ข้ามเที่ยงคืน, เครดิตหมด, rate limit, reply, duplicate cron, kill/restart worker, Meta timeout และ persistence failure
5. Pro เปิด interested แล้วถามสินค้าจริง ตรวจ draft/approval และกรณีมีข้อความหรือออเดอร์ใหม่ระหว่าง AI ทำงาน
6. ตั้ง after-sales: สถานะ shipped อย่างเดียวต้องไม่มีงาน เพิ่มหลักฐานจริงจึงมีงาน หากเกิน 24 ชม. ต้อง review ไม่ส่งจริง
7. ตรวจ Inbox, delivery/read webhook, audit logs และ credit balances ไม่มีข้อความซ้ำ/การเติมเครดิตจากผล AI

```powershell
npm.cmd run lint
npx.cmd tsc --noEmit
node --test scripts/test-smart-followups.cjs
node scripts/test-smart-followups-sql.cjs <path-to-@electric-sql/pglite>
npm.cmd run build
```
