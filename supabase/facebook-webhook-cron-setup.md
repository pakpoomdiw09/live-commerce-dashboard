# เรียก Facebook Webhook Worker ทุก 1 นาทีด้วย cron-job.org

ใช้ external scheduler แทน Vercel Cron: `vercel.json` ไม่ประกาศ `crons` เพื่อไม่ให้
การ deploy ติดข้อจำกัดความถี่ของ Vercel Hobby

## เตรียม Vercel

1. ใน Project → Settings → Environment Variables ตั้ง `CRON_SECRET` สำหรับ Production
   เป็นค่าสุ่มลับยาว เช่น 32 bytes ขึ้นไป หากมีค่าใช้อยู่แล้วให้ใช้ค่าเดิม
2. Redeploy เพื่อให้ endpoint อ่าน environment ล่าสุด
3. ใช้โดเมน Production แบบ HTTPS ที่เข้าถึง endpoint ได้โดยไม่ต้องล็อกอิน Vercel
   ห้ามใช้ localhost หรือ URL หน้า Dashboard แทน API

## ตั้งค่า cron-job.org

สมัครที่ https://cron-job.org/en/ แล้วสร้าง cron job โดยใช้ค่าต่อไปนี้:

| ช่อง | ค่า |
| --- | --- |
| Title | Facebook webhook worker |
| URL | `https://YOUR-PRODUCTION-DOMAIN/api/cron/facebook-webhooks` |
| Schedule | ทุก 1 นาที / Every minute (เทียบเท่า `* * * * *`) |
| Request method | `GET` |
| Custom header name | `Authorization` |
| Custom header value | `Bearer YOUR_CRON_SECRET` |
| Request body | ไม่ต้องใส่ |

ใช้ค่า secret เดียวกับ `CRON_SECRET` บน Vercel ใส่ใน custom header ไม่ใช่ช่อง
HTTP Basic Authentication และไม่ใส่ secret ใน URL เปิดใช้งาน job และเปิดแจ้งเตือนเมื่องานล้มเหลว

## ตรวจการทำงาน

1. กดทดสอบ job ทันที ควรได้ HTTP `200` พร้อม JSON สรุป worker แม้ไม่มีงานค้าง
2. ตรวจ Execution history ว่ามีคำขอทุกนาที และตรวจ Vercel Function Logs ว่าไม่มี
   `[auction/delivery] outbox unavailable or not installed` หรือข้อผิดพลาดฐานข้อมูล
   HTTP 200 ของ worker ไม่ได้ยืนยันว่าทุกข้อความส่งสำเร็จ เพราะ outbox error ถูกบันทึกแยก
3. ตรวจ `auction_deliveries`: งานพร้อมส่งอยู่ใน `pending` และเมื่อสำเร็จเป็น `sent`
   งาน `awaiting_confirmation` รอผู้ชนะพิมพ์คีย์เวิร์ด ส่วน `requires_review` ต้องตรวจผลก่อนส่งซ้ำ

หากได้ `401` ให้ตรวจ header และ secret หากได้ redirect/หน้า HTML ให้ตรวจโดเมนและ
Deployment Protection หากได้ `503` ให้ตรวจฐานข้อมูลและ Function Logs บริการระบุว่า
timeout หลัง 30 วินาที หาก timeout ให้ตรวจประวัติและ log เพราะปลายทางอาจยังทำงานต่อ
ไม่ถือว่า timeout แปลว่างานไม่เริ่ม

Endpoint รองรับทั้ง GET/POST และตรวจ Bearer secret ก่อนทำงาน ใช้คิวและ lease ในฐานข้อมูล
ป้องกัน worker แย่งงาน และ claim outbox ก่อนส่งข้อความ การเรียก cron ไม่สร้าง order ใหม่
และไม่ข้ามการยืนยันผู้ชนะ

อ้างอิง: https://cron-job.org/en/ และ https://cron-job.org/en/faq/
บริการระบุว่าฟรี รองรับทุกนาที, custom headers และการทดสอบ job ทันที
