# ตรวจปัญหา 404

เส้นทาง Smart Follow-up ปัจจุบัน:

| URL | Method | ไฟล์ |
| --- | --- | --- |
| `/chatbot/follow-ups` | หน้าเว็บ | `app/(dashboard)/chatbot/follow-ups/page.tsx` |
| `/api/follow-ups` | GET, PATCH | `app/api/follow-ups/route.ts` |
| `/api/follow-ups/manual` | GET, POST | `app/api/follow-ups/manual/route.ts` |
| `/api/follow-ups/run` | POST | `app/api/follow-ups/run/route.ts` |
| `/api/follow-ups/jobs/<id>` | PATCH | `app/api/follow-ups/jobs/[id]/route.ts` |

`(dashboard)` เป็น Route Group ไม่อยู่ใน URL ส่วน `<id>` ต้องแทนด้วย ID จริง ไม่ใช่ข้อความ `[id]` และไฟล์ API ต้องชื่อ `route.ts`

รัน `node scripts/check-local-routes.cjs` เพื่อตรวจ URL ตายตัวใน fetch, Link และ router navigation เทียบกับไฟล์ Route และ public assets ตัวตรวจนี้ไม่ครอบคลุม URL ที่ประกอบด้วยตัวแปร, HTTP method, สิทธิ์ผู้ใช้ หรือการมีอยู่ของข้อมูลจริง

หากยังเกิด 404 ให้ดู Network ใน DevTools แล้วเก็บ Request URL, Method, Status และ Response:

- HTML หน้า 404: ตรวจ URL และว่าเซิร์ฟเวอร์รันจากโปรเจกต์/เวอร์ชันที่มีไฟล์ Route นี้จริง
- JSON แจ้งว่าไม่พบร้านหรือลูกค้า: Route ทำงานแล้ว แต่ API หา record ที่ผู้ใช้มีสิทธิ์เข้าถึงไม่ได้ ตรวจ tenantId/customerId และบัญชีที่ล็อกอิน
- 405: Method ไม่ตรงกับที่ Route รองรับ
- 503 หลังเพิ่มเข้าคิว: ตรวจ Terminal และการติดตั้ง `supabase/manual-follow-ups.sql` ซึ่งเป็นปัญหาคนละส่วนกับ Route 404

หลังเพิ่มไฟล์ Route หาก dev server ยังไม่เห็น ให้หยุดแล้วรัน `npm run dev` ใหม่ สำหรับ Production ต้อง build/deploy เวอร์ชันใหม่ (`npm run build` แล้วเริ่มเซิร์ฟเวอร์ตามระบบ deploy) โปรเจกต์แยก `.next-dev` สำหรับ development และ `.next` สำหรับ production อยู่แล้ว

หน้า `app/not-found.tsx` แสดงข้อความพร้อมลิงก์กลับภาพรวม/Inbox เมื่อ Next.js หาเพจไม่พบ การเพิ่มหน้านี้ช่วยให้ใช้งานต่อได้ แต่ไม่ได้ทำให้ Endpoint ที่ไม่มีอยู่กลายเป็น API สำเร็จ
