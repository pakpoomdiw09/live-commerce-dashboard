# Realtime และการรีเฟรชข้อมูลหน้าบ้าน

ตรวจจากโค้ดใน workspace ไม่ได้เชื่อม Supabase production หรือยืนยันสัดส่วน CPU ที่เกิดจากแต่ละหน้า การลด CPU จริงต้องเทียบ `realtime.list_changes` และ PostgREST หลัง deploy ภายใต้จำนวนผู้ใช้/ข้อความใกล้เคียงกัน

## จุดที่พบและปรับ

| จุด | ก่อนปรับ | หลังปรับ |
| --- | --- | --- |
| `useInboxState` | Channel เสริมฟัง `customers` ซ้ำกับ Inbox และฟัง `conversation_reads` โดยไม่มีตัวกรอง | ไม่มี channel ใช้ snapshot ทุก 120 วินาทีเมื่อมองเห็นหน้า เหตุการณ์จาก Inbox และการอ่านแชทรวมคำขออย่างน้อย 10 วินาที และมี backoff เมื่ออ่านล้มเหลว |
| `InboxClient` | ฟัง `customers` โดยไม่กรองร้าน และ polling สำรองทุก 30 วินาที | กรอง `tenant_id`; polling สำรองทุก 60 วินาทีเมื่อหลุด ส่วน channel ปกติตรวจ snapshot ทุก 120 วินาที |
| `AgentHandoverQueue` | เปิด channel `customers` เพิ่มอีกหนึ่งจุด | ไม่มี channel โหลดรายการทุก 120 วินาทีเมื่อมองเห็นหน้า รวมเหตุการณ์ focus/online อย่างน้อย 15 วินาที ปุ่มอัปเดตและการกระทำของผู้ใช้ยังทำงาน |
| `SmartFollowUpsClient` | ฟัง `follow_up_jobs`, `follow_up_workflows`, `follow_up_policies` | ไม่มี channel ใช้ refresh 120 วินาทีและรวมเหตุการณ์อย่างน้อย 30 วินาที |
| `ManualFollowUpDialog` | ฟัง `orders` ของลูกค้าและโหลดซ้ำเมื่อ subscribe สำเร็จ | โหลดเมื่อเลือกลูกค้า/ค้นหา และสำรองทุก 120 วินาทีเฉพาะขณะเปิด dialog และมองเห็นหน้า |
| `LiveRefresh` ในหน้าสรุป/ร้านค้า/บิล/บรอดแคสต์ | หลายหน้าไม่ระบุ tenant filter; เหตุการณ์อาจเรียก RSC refresh ทุก 5 วินาที | ทุกหน้ารายร้านระบุ filter และเว้น refresh อย่างน้อย 30 วินาที หน้ารวมที่ไม่มีร้านไม่เปิด subscription แบบไม่กรอง |
| `SlipsWorkspace` | ฟัง `slips` ทั้งตาราง; effect อ้างอิง object `tenant` | กรองร้านและอ้างอิง `tenantId` ที่คงที่ การส่ง object ใหม่ของร้านเดิมไม่เปิด channel ซ้ำ รวมการอ่านเครดิตอย่างน้อย 30 วินาที |
| ตัวกรอง `ChatList` | เหตุการณ์สลิปแต่ละช่วงอาจโหลด stars/payments หลัง 150 ms | เหตุการณ์เบื้องหลังเว้นอย่างน้อย 10 วินาที ส่วนการกดดาว/ติดตามของผู้ใช้ยังตอบสนองเร็ว |

Smart Follow-ups ปิดด้วย `SMART_FOLLOW_UP_ENABLED = false` อยู่ก่อนแล้ว หากไม่ได้เปิดฟีเจอร์ ไม่ควรนับ subscriptions ในคอมโพเนนต์ที่ไม่ได้ mount เป็นโหลดจริงของ production

## Cleanup และความถูกต้อง

พบ `removeChannel` ใน cleanup ของทุกจุดเดิม ไม่พบจุดที่ลืม cleanup โดยตรง แต่ยังมีความเสี่ยงจาก callbacks ที่มาหลัง cleanup และ channel ที่ค้างในแท็บซ่อน

เพิ่ม `subscribeWhileVisible` ให้ Inbox, หน้าสลิป และ `LiveRefresh` ปล่อย channel เมื่อแท็บซ่อน/ออกจากหน้า เปิดด้วยชื่อใหม่เมื่อกลับมา และกัน callbacks ของ instance เก่า เมื่อ reconnect จะอ่าน snapshot เพื่อเก็บรายการที่พลาดไป การอ่าน snapshot พื้นหลังของ Inbox ถูก abort เมื่อปล่อย channel

Inbox ยังต้องฟัง `customers` หนึ่งจุดเพื่ออัปเดตชื่อ สถานะ การรับช่วง และพบลูกค้าใหม่ ส่วน `messages` ยังใช้ RLS เนื่องจากตารางนี้ไม่มี `tenant_id` และ Inbox ต้องพบข้อความจากแชทใหม่ ไม่เพิ่ม tenant filter ที่ใช้กับ schema นี้ไม่ได้ ไม่เปลี่ยน RLS/publication หรือกระบวนการส่งข้อความ

Snapshot รายชื่อแชทรองรับ pagination โดยรักษารายการเก่าที่โหลดไว้ และนำลูกค้าที่ถูกลบ/ย้ายร้านออกเมื่อยืนยันจาก snapshot ได้

`useMessengerWindow` ที่ทำงานทุก 1 วินาทีเป็นนาฬิกา UI ไม่เรียกเครือข่าย `Conversation` โหลด workspace หลังมีข้อความเข้าเป็น debounce ตามเหตุการณ์ เพื่ออ่านหลักฐานเวลา Messenger จาก server ไม่ใช่ polling ทุก 1 วินาที ส่วน heartbeat ใน `webhook-worker` เป็นงาน server สำหรับรักษา lease ไม่ใช่ polling หน้าบ้าน

## การตรวจสอบ

ทดสอบด้วย mock React/Supabase และนาฬิกาจำลอง: เรียก refresh 100 ครั้งแล้วรวมคำขอได้, hidden-tab ไม่ยิงเครือข่าย, cleanup ล้าง timer/listener และ abort, ไม่เปิด channel เพิ่มจาก rerender/เปลี่ยนห้อง, reconnect เก็บข้อความที่พลาด, snapshot ไม่ย้อนทับข้อความที่เพิ่งรับ และตัวกรองร้านแยกข้อมูลถูกต้อง รวมถึง backoff เมื่อ API ล้มเหลว

ชุดหลัก: `test-realtime-visibility.cjs`, `test-realtime-lifecycle.cjs`, `test-inbox-realtime.cjs`, `test-inbox-render-lifecycle.cjs`, `test-inbox-assignment.cjs`, `test-background-refresh.cjs` พร้อม regression ของ Inbox, หน้าสรุป, agent handover และ follow-ups

หลัง deploy ให้เทียบจำนวน Realtime connections และ PostgREST ต่อ session ระหว่างเปิดหน้า ทิ้งไว้ ซ่อนแท็บ เปลี่ยนห้อง และปิดหน้า ไม่ต้องติดตั้ง SQL ใหม่สำหรับการเปลี่ยนแปลงนี้
