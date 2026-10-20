# เปิด Cron ทุก 1 นาที

โปรเจกต์มี API `GET/POST /api/cron/follow-ups` แต่ `vercel.json` ไม่มี Cron เพื่อให้ deploy บน Hobby ได้ ต้องตั้ง External Scheduler หรือ Supabase Cron เรียก API ทุกนาทีเอง การเปิด Dashboard หรือรัน `npm run dev` ไม่ได้เริ่ม Worker อัตโนมัติ

## ตั้งค่าบน Vercel

1. Project → Settings → Environment Variables: ตั้ง `CRON_SECRET` สำหรับ Production ให้ตรงกับค่าใน `.env.local` หรือ secret ที่ใช้ทดสอบ ห้ามใช้ชื่อขึ้นต้น `NEXT_PUBLIC_`
2. Deploy โค้ดนี้ไป Production แล้วตั้ง External Scheduler ทุกนาที: URL `https://live-commerce-dashboard-xi.vercel.app/api/cron/follow-ups`, Method `POST` (รองรับ `GET` ด้วย), Header `Authorization: Bearer <CRON_SECRET>` และ Body `{}` หากใช้ JSON ให้เพิ่ม `Content-Type: application/json` ห้ามใส่ Secret ใน URL
3. ตรวจ Runtime Logs ด้วย `[FOLLOW-UP CRON]`, `[FOLLOW-UP WORKER]` และ `[FOLLOW-UP SEND]`

Route เลือก `CRON_SECRET` หลังตัดช่องว่างก่อน ถ้าไม่มีหรือว่างจึงใช้ `INTERNAL_API_SECRET` หากตั้งทั้งสองค่า Scheduler ต้องใช้ `CRON_SECRET` เท่านั้น ไม่รับ Secret เก่าควบคู่กัน คำขอที่ไม่มี Secret หรือไม่ตรงจะได้ 401 ก่อนอ่านฐานข้อมูลหรือส่งข้อความ ไม่ใช้ User-Agent ยืนยันตัวตน และ `?dryRun=1` ต้องยืนยันสิทธิ์เช่นกัน เมื่อตั้งค่าหรือเปลี่ยน Secret บน Vercel ให้ redeploy และปรับ Header ของ Scheduler ให้ตรงกัน

หากเลือกใช้ Vercel Cron ในอนาคต ต้องเพิ่ม configuration เองและใช้แพ็กเกจที่รองรับความถี่นั้น โดย Vercel แนบ `Authorization: Bearer <CRON_SECRET>` ให้อัตโนมัติ

Vercel Hobby รองรับ Cron เพียงรายวัน ไม่รองรับตารางทุกนาที ต้องใช้แพ็กเกจที่รองรับทุกนาที หรือตั้ง scheduler ภายนอกเรียก endpoint เดียวกันทุกนาทีพร้อม Authorization header ถ้าเลือกตัวภายนอกให้เอารายการออกจาก `vercel.json` ก่อน deploy และอย่าเปิด Supabase Cron ซ้ำพร้อมกัน

เอกสารอ้างอิง: [Vercel Cron setup](https://vercel.com/docs/cron-jobs/quickstart), [Security](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## ทดสอบ

สคริปต์อ่าน Secret จาก environment หรือ `.env.local` โดยไม่พิมพ์ค่าออกมา และไม่ส่งต่อ Secret ไป URL ที่ redirect

```
# ตรวจสิทธิ์และอ่านคิว ไม่ Claim และไม่ส่งข้อความ
node scripts/trigger-follow-up-cron.cjs http://localhost:3000
node scripts/trigger-follow-up-cron.cjs https://YOUR-PRODUCTION-DOMAIN

# ส่งจริง: ประมวลผลงานที่ถึงกำหนดของทุกร้าน ตาม Worker เดิม
node scripts/trigger-follow-up-cron.cjs https://YOUR-PRODUCTION-DOMAIN --send

# ทดสอบ config และสิทธิ์ด้วย mock ไม่เรียก Supabase/Facebook
node scripts/test-follow-up-cron.cjs
```

ผล Dry-run: `dryRun:true`, `hasDueJobs`, `nextDueJob` หมายถึงอ่านฐานข้อมูลสำเร็จ ไม่ใช่ยืนยันว่ารายการนั้นผ่านเงื่อนไขส่งทั้งหมด ผลส่งจริงดู `sent`, `review`, `failed` และ Log ที่เกี่ยวข้อง รายการ `requires_review` ต้องตรวจร่าง/อนุมัติก่อน และยังต้องอยู่ในกรอบ 24 ชั่วโมง

ถ้าไม่มีงานที่ถึงเวลา `sent:0` เป็นผลปกติ ตั้งหลังเหตุการณ์ 2 นาทีจะส่งได้ตั้งแต่ครบ 2 นาทีในรอบ Cron ถัดไป ไม่ใช่เวลาเป๊ะทุกวินาที Worker มีการรวมคำขอซ้อนใน process และ Claim แบบล็อกในฐานข้อมูลเพื่อป้องกันการส่งซ้ำ
