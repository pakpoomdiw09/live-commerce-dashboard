# คิวรับข้อความ Facebook แบบถาวร

รองรับทั้ง `/api/webhook/facebook` และ URL เดิม `/api/webhooks/facebook` ผ่าน HTTP handler และคิวชุดเดียวกัน ไม่เปลี่ยนการตั้งค่าส่งจริง สิทธิ์แพ็กเกจ หรือโหมดความปลอดภัยเดิม

## ติดตั้ง

1. รัน `supabase/facebook-webhook-queue.sql` หลัง schema หลัก, `platform.sql` และ `smart-inbox.sql` ใน Supabase SQL Editor ก่อนนำโค้ดใหม่นี้ขึ้นใช้งาน ไฟล์รันซ้ำได้และไม่เรียกบริการภายนอก
   หากติดตั้ง Part 1 ไว้ก่อนแล้ว ให้รัน `supabase/facebook-message-window.sql` เพื่ออัปเกรดการตรวจเวลาและ trigger ตามรายละเอียดใน `docs/FACEBOOK-MESSAGE-WINDOW.md`
2. ตั้งค่า `FB_APP_SECRET`, `FB_VERIFY_TOKEN` (หรือ `FACEBOOK_VERIFY_TOKEN`), Supabase URL และ `SUPABASE_SERVICE_ROLE_KEY` ตามเดิม ตั้ง `CRON_SECRET` เป็นค่าลับสำหรับ worker ห้ามใช้ตัวแปร `NEXT_PUBLIC_` เก็บค่าลับ
3. ตั้ง scheduler เรียก `POST /api/cron/facebook-webhooks` ทุกนาที พร้อม header `Authorization: Bearer <ค่าของ CRON_SECRET>` รองรับ GET สำหรับ scheduler ที่ส่งได้เฉพาะ GET เช่น Vercel Cron ด้วย header เดียวกัน คำขอพร้อมกันหลายชุดปลอดภัยเพราะใช้ database lease และ `FOR UPDATE SKIP LOCKED`
4. ให้ runtime รองรับการทำงานได้ 300 วินาที ตาม `maxDuration` ของทั้งสอง route Meta ใช้ URL `/api/webhook/facebook` หรือ `/api/webhooks/facebook` ที่ลงทะเบียนไว้เดิมได้ทันที โดยไม่ต้องเปลี่ยน URL หรือผ่าน redirect

การประมวลผลผ่าน `after()` ช่วยให้ตอบลูกค้าได้เร็ว แต่ไม่ใช่ตัวทดแทน scheduler หากโปรเซสหยุดหลังตอบรับ Meta แล้ว scheduler จะกู้คืนงานค้างและงานที่ถึงเวลาลองใหม่

## การรับและการลองใหม่

- อ่าน request เป็น byte stream ขนาดรวมไม่เกิน 2 MiB ตรวจ HMAC-SHA256 จาก bytes จริง และตรวจรูปแบบ Page payload ก่อนบันทึก
- บันทึก raw payload และรายการเหตุการณ์ในธุรกรรมเดียวกัน ตอบ 200 หลัง commit เท่านั้น หากบันทึกไม่ได้ตอบ 503 เพื่อให้ Meta ส่งใหม่
- SHA-256 ของ raw body ป้องกันซ้ำทั้ง request และ `(page_id,event_key)` ป้องกันเหตุการณ์เดิมที่ถูกบรรจุมาใน request คนละชุด
- ทั้งสอง URL ใช้ `lib/integrations/facebook/webhook-http.ts` ร่วมกันและเข้าสู่ `lib/integrations/facebook/webhook-handler.ts` ชุดเดียวกัน จึงได้รับการดึงโปรไฟล์ การประมวลผล AI การวิเคราะห์รูป การติดตามลูกค้า และกฎคอมเมนต์เหมือนกัน ขึ้นอยู่กับสิทธิ์และการตั้งค่าเดิมของร้าน
- คีย์ป้องกันซ้ำไม่รวม URL ของ request จึงป้องกันเหตุการณ์ซ้ำข้ามทั้งสอง endpoint รวมถึงการเรียกพร้อมกันจากหลาย instance ด้วยข้อบังคับ unique และ lease ในฐานข้อมูล
- worker ประมวลผลตามลำดับภายในลูกค้าของเพจเดียวกัน แต่ลูกค้าคนอื่นทำงานขนานกันได้
- lease อายุ 120 วินาที ต่ออายุทุก 20 วินาที ทุก checkpoint ตรวจ claim token เพื่อกัน worker เก่ากลับมาเขียนผล
- ข้อผิดพลาดก่อนเริ่มขั้นตอนที่อาจมีผลกับบริการภายนอกจะลองใหม่สูงสุด 8 ครั้ง หน่วง 5, 10, 20, 40, 80, 160 และ 320 วินาที พร้อม jitter ไม่เกิน 2 วินาที งานที่ worker หยุดก่อนเริ่มขั้นตอนภายนอกจะกลับเข้าคิวด้วย backoff เช่นกัน
- การบันทึกแชท/คอมเมนต์และ checkpoint ใช้ธุรกรรมเดียวกัน จึงกู้คืนหลังบันทึกข้อความได้โดยไม่ข้ามขั้นตอนตอบกลับที่ยังไม่เริ่ม
- ขั้นตอนที่เสร็จแล้วเก็บผลลัพธ์ไว้เพื่อไม่เรียกซ้ำ งานจากระบบเดิมที่มี external ID อยู่แล้วจะไม่ส่งตอบกลับซ้ำ

## ผลลัพธ์ที่ไม่แน่นอนและการดูแลคิว

ไม่สามารถรับประกัน exactly-once ระหว่าง PostgreSQL กับ Facebook Send API ได้ หากส่งคำขอไปแล้วแต่ไม่ได้รับคำตอบ หรือ worker หยุดก่อนบันทึก checkpoint จะเก็บงานเป็น `requires_review` และไม่ส่งซ้ำอัตโนมัติ งานที่ลองครบแล้วยังไม่สำเร็จเป็น `dead` ทั้งสองสถานะจะพักงานถัดไปของลูกค้ารายนั้นเพื่อรักษาลำดับ ลูกค้าคนอื่นยังทำงานได้ตามปกติ

ตรวจสถานะด้วยบัญชีผู้ดูแลฐานข้อมูล:

```sql
select status, count(*), min(created_at) as oldest
from public.facebook_webhook_events
group by status;

select id, page_id, ordering_key, status, attempts, last_error, created_at
from public.facebook_webhook_events
where status in ('requires_review', 'dead')
order by created_at;

select event_id, name, status, started_at, completed_at
from public.facebook_webhook_steps
where status = 'started'
order by started_at;
```

ก่อนนำงานกลับเข้าคิว ต้องตรวจหลักฐานจากข้อความขาออก ออเดอร์ สลิป และผู้ให้บริการ หากยืนยันว่าเสร็จแล้วให้ผู้ดูแลบันทึก checkpoint ว่าเสร็จแล้วพร้อมผลที่ตรวจสอบได้ หากยืนยันว่าไม่ได้เกิดผลภายนอกจึงปลด checkpoint นั้นและนำงานกลับเข้าคิว อย่ารีเซ็ต `started` หรือ requeue งานที่ไม่ทราบผลแบบเหมารวม

ตารางทั้งสามเปิด RLS และให้สิทธิ์เฉพาะ `service_role` ข้อมูล raw มีข้อมูลลูกค้า จึงควรจำกัดผู้เข้าถึงและตั้งระยะเวลาเก็บตามนโยบายร้าน ห้ามลบ event/checkpoint ที่ยังต้องใช้ป้องกันข้อความซ้ำ การลบ idempotency records ทำให้เหตุการณ์เก่าที่ถูกส่งซ้ำอาจถูกประมวลผลใหม่

## ทดสอบ

```sh
node --test scripts/test-facebook-webhook-queue.cjs
npm run build
```

ชุดทดสอบใช้ PostgreSQL ผ่าน PGlite และบริการจำลอง ไม่แก้ฐานข้อมูลจริง ไม่เรียก AI และไม่ส่งข้อความไป Facebook
