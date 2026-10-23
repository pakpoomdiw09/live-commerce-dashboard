# ตรวจข้อความ Facebook ไม่เข้า Inbox

รัน `node scripts/diagnose-facebook-webhook.cjs` จากโฟลเดอร์โปรเจกต์ เครื่องมืออ่านฐานข้อมูลจาก environment ของเครื่องเท่านั้น ไม่ส่งข้อความ ไม่เรียก worker และไม่แก้ข้อมูล ไม่พิมพ์ secret หรือเนื้อหาแชท แต่ผลลัพธ์มี ID ภายใน จึงควรเก็บไว้ใช้ตรวจระบบภายใน

## โค้ดปัจจุบัน

- `/api/webhook`, `/api/webhook/facebook`, `/api/webhooks`, `/api/webhooks/facebook` ใช้ handler เดียวกันใน `lib/integrations/facebook/webhook-http.ts` และใช้ Node.js runtime
- GET อ่าน query ผ่าน `req.nextUrl.searchParams` ตรวจ `hub.mode=subscribe` และ `hub.verify_token` กับ `FB_VERIFY_TOKEN` (ถ้าไม่มีจึงใช้ `FACEBOOK_VERIFY_TOKEN`) แล้วคืน `hub.challenge` เป็น plain text 200; ไม่ตรงตอบ 403
- POST ใน Next.js App Router ไม่ใช้ `req.body.entry` โดยตรง เพราะ body เป็น stream: อ่าน bytes ครั้งเดียว ตรวจ `x-hub-signature-256` ด้วย `FB_APP_SECRET` แล้ว parse JSON
- วนทุก `entry[].messaging[]` รวมทั้ง `changes[]` ไม่อ่านเฉพาะรายการแรก; sender อยู่ที่ `event.sender.id` และข้อความอยู่ที่ `event.message.text` ซึ่งอาจไม่มีเมื่อส่งรูป
- POST รอ `enqueue_facebook_webhook` commit สำเร็จก่อนตอบ 200; เมื่อฐานข้อมูลล้มเหลวตอบ 503 เพื่อไม่รับรองการรับข้อความที่ยังไม่ได้เก็บ ขอบเขต timeout ของ fetch ฐานข้อมูลคือ 10 วินาทีต่อคำขอ
- Worker ใน `after()` จึงบันทึก customer/message และทำงานตอบกลับภายหลัง มี deduplication และ database lease; `completed` อาจเป็น delivery/read/echo ที่ไม่ได้สร้างข้อความ ต้องตรวจขั้น `record` เพิ่มเติม
- `facebookInboundMessage` ตรวจ sender, recipient, mid, timestamp และเนื้อหา/ไฟล์แนบ; ไม่บันทึก echo และ system event เป็นแชทลูกค้า

## ไล่ตรวจตามอาการ

1. ไม่มี receipt ใหม่หลังส่งแชท: ตรวจ Callback URL/โดเมนของ Production, Vercel deployment protection/firewall, Meta Page subscription ของ `messages` และ app ที่ผูกกับเพจ ตรวจโหมดแอป/สิทธิ์ของบัญชีทดสอบใน Meta ด้วย ต้องใช้ URL HTTPS ที่เข้าถึงได้จากภายนอก
2. มี request ใน Vercel แต่ไม่มี receipt: ดู status และ log `facebook-webhook/ingress` — 401 คือลายเซ็นไม่ผ่าน, 400/413 คือ payload ไม่ถูกต้อง/ใหญ่เกิน, 503 คือ secret/ฐานข้อมูล/queue RPC ไม่พร้อม ตรวจ env ของ Vercel Production แล้ว redeploy; `.env.local` ไม่ได้ยืนยันค่าบน Vercel
3. มี receipt แต่ event ค้าง: ดู `unfinished_events`, `available_at`, `lease_until`, `last_error` และ worker logs ตรวจว่า migration ของ queue, nonblocking และ message-window ตรงกับโค้ดตามเอกสารของแต่ละ migration อย่าล้างคิวหรือ replay การส่งข้อความโดยไม่ตรวจ checkpoint
4. Event สำเร็จแต่ไม่เห็นแชท: ตรวจ log `record persisted`, `ignored`, `reason`, tenant ของ customer, `tenants.page_id`, `tenants.is_active` และสิทธิ์ `tenant_members` ของผู้เปิดแดชบอร์ด หากมีข้อความใน DB แล้วจึงตรวจตัวกรอง Inbox/Realtime

## Worker สำรอง

`vercel.json` ปัจจุบันไม่มี cron จึงต้องตรวจว่ามี scheduler ภายนอกอยู่แล้วหรือไม่ `after()` ทำงานภายในเวลาที่ route/platform อนุญาต ไม่รับรองการกู้คืนเมื่อ process หยุด

ถ้ายังไม่มี scheduler ให้ตั้งเรียก GET หรือ POST `/api/cron/facebook-webhooks` ทุกนาที พร้อม `Authorization: Bearer <CRON_SECRET>` หากใช้ Vercel Cron ให้ตั้ง `CRON_SECRET` บน Vercel และเพิ่มใน `vercel.json` โดยเลือกความถี่ที่แผนรองรับ:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/facebook-webhooks", "schedule": "* * * * *" }]
}
```

ตัวอย่างนี้ยังไม่ได้เพิ่มลง config จริง เพราะต้องตรวจแผนและ scheduler เดิมก่อน ดู [Vercel Cron](https://vercel.com/docs/cron-jobs/quickstart) และ [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after)

## ทดสอบโดยไม่แตะข้อมูลจริง

```sh
node --test scripts/test-facebook-webhook-queue.cjs scripts/test-webhook-db-timeout.cjs
```

ใช้ payload จำลอง, mocked HTTP และ PostgreSQL ในเครื่อง ครอบคลุม verification, signature, durable enqueue, retries, deduplication และการบันทึกข้อความ ไม่ส่งข้อความหา Facebook จริง
