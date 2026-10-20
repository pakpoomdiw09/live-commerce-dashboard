# ตรวจ Cron และ Worker ของ Smart Follow-up

Route จริงคือ `GET` หรือ `POST /api/cron/follow-ups` ต้องมี `Authorization: Bearer <CRON_SECRET>` (ถ้าไม่ได้ตั้งใช้ `INTERNAL_API_SECRET`) ทั้ง dev และ production ต้องมี scheduler เรียก Route นี้ จอดหน้า Dashboard ค้างไว้ไม่ได้ทำให้ Worker รันเอง

ใน repository มี `vercel.json` ตั้งเรียกทุกนาทีแล้ว ดูการตั้ง Production Secret และ deploy ใน [FOLLOW-UP-CRON-SETUP.md](FOLLOW-UP-CRON-SETUP.md) ส่วนคำสั่ง `cron.schedule` ใน `supabase/automation.sql` เป็นตัวอย่างที่คอมเมนต์ไว้ ไม่ได้ติดตั้ง Supabase Cron อัตโนมัติ ตรวจบนระบบจริงด้วย `supabase/follow-up-worker-diagnostics.sql` ใน SQL Editor ซึ่งไม่ส่งข้อความและไม่แสดง secret หรือเนื้อหาแชท หากใช้ Supabase Cron ให้ดู Messages/Notices ใน SQL Editor เพิ่มเติม

หากยังไม่มี scheduler ใช้ตัวอย่างส่วนท้าย `automation.sql` โดยแทน URL เป็นโดเมน deployment ที่ออนไลน์จริงและ Secret ให้ตรงกับ Environment ของ deployment แล้วตั้งเรียกทุกนาที ใช้ scheduler เพียงแห่งเดียว ไม่ต้องเพิ่ม browser polling การตั้ง `.env.local` อย่างเดียวไม่ได้ตั้งค่า Secret ใน production และ Supabase บนคลาวด์เรียก localhost ในคอมพิวเตอร์ไม่ได้

Cron `succeeded` สำหรับคำสั่ง `net.http_post` หมายถึงส่งงาน HTTP เข้าคิวแล้ว ยังไม่ยืนยันว่า Worker ตอบ 200 ตรวจ HTTP status ในประวัติ request ของ scheduler/pg_net และ Log ฝั่งแอปด้วย 401 หมายถึง Secret ขาดหรือไม่ตรง 404 หมายถึง URL/deployment ไม่ตรงหรือยังไม่มี Route รุ่นนี้

Log ตามลำดับ:

- `[FOLLOW-UP CRON] invoked` — Route ได้รับคำขอที่ผ่านสิทธิ์
- `[FOLLOW-UP WORKER] started` — เริ่มรอบทำงานจริง คำขอที่ซ้อนกันใน process ใช้รอบเดียวกัน
- `[FOLLOW-UP CLAIM] claimed` / `no due jobs` — Claim ได้หรือยังไม่มี `pending` ที่ถึงกำหนด
- `[FOLLOW-UP PREPARE] result` — ตรวจเงื่อนไข เช่น `ai_draft`, `window_closed`, `handover`, `workflow_changed`, `quota_exhausted`
- `[smart-follow-up] final check` — ตรวจอีกครั้งทันทีก่อนส่ง
- `[FOLLOW-UP SEND] request` / `accepted` / `failed` — เรียก Facebook, ได้ message ID หรือ error พร้อม HTTP status, code, subcode โดยไม่ log token/ผู้รับ/ข้อความ
- `[FOLLOW-UP SEND] persisted` — บันทึกผลสำเร็จลงฐานข้อมูลแล้ว `accepted` อย่างเดียวไม่ได้ยืนยันว่าผู้รับเห็นข้อความ
- `[FOLLOW-UP WORKER] complete` — จำนวน claimed/sent/review และเวลาที่ใช้

`run_at` และ `anchor_at` เป็น `timestamptz`; SQL ตั้งเวลาจาก `anchor_at + make_interval(mins => delay_minutes)` และ Claim เปรียบเทียบ `run_at <= now()` ซึ่งเปรียบเทียบจุดเวลาเดียวกัน ไม่ต้องบวก 7 ชั่วโมง การแสดง Asia/Bangkok มีผลต่อรูปแบบแสดงเวลาเท่านั้น ตั้ง 2 นาทีแล้ว Cron ทุกนาทีอาจเริ่มหลังครบ 2 นาทีไปจนถึงรอบถัดไป ไม่ได้ส่งตรงวินาทีที่ 120 เสมอ

Worker Claim ทีละงาน สูงสุด 10 งาน/รอบ และมีเวลารันจำกัดเพื่อไม่ให้ลูปค้าง หากค้างอยู่ `requires_review` ไม่ใช่ `pending` Worker จะไม่ส่งอัตโนมัติ งาน Manual ที่ไม่มีออเดอร์ต้องกดตรวจร่างและอนุมัติก่อน ส่วนการเกินกรอบ 24 ชั่วโมงไม่สามารถแก้ด้วยการปรับ timezone หรือกด retry
