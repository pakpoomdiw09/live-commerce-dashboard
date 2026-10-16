# Smart Inbox Pro — ผลตรวจและวิธีเปิดใช้งาน

## ขอบเขต

ปรับหน้า `/inbox` เดิม ไม่สร้างโปรเจกต์ ไม่เปลี่ยนคีย์ ไม่ reset ฐานข้อมูล ไม่ deploy และไม่ส่ง Messenger จริง SQL ใหม่ยังไม่ได้ติดตั้งบน Supabase จริง

## สิ่งที่พบจากโค้ด

- การเลือกใช้ stable customer ID อยู่แล้ว และมี Inspector เพียงหนึ่ง instance ไม่พบคำสั่งสร้างหน้าต่างหรือ toast ใหม่ทุกครั้งที่คลิกรายชื่อ จึงยังระบุไม่ได้ว่าอาการในภาพเกิดจากอะไรโดยตรงโดยไม่มี reproduction ในบัญชีจริง
- `ConversationHistory` ตรวจ abort ใน catch แต่ไม่ตรวจหลัง `res.json()` เสร็จ Request เก่าจึงยังตั้งข้อมูลหลังเปลี่ยนลูกค้าได้
- `SlipDetailPanel` ไม่มี abort/ownership ของ request รายละเอียด ผลเก่าที่กลับช้าสามารถทับ state ใหม่ได้ (แม้มีการตรวจ detail ID ตอนแสดง ก็ยังทำให้รายละเอียดใหม่หาย/โหลดค้างได้)
- ปุ่ม `ConversationActions` และ `ReplyBox` ใช้ React state เป็น busy guard; หลายคลิกก่อน render ถัดไปยังเริ่มหลาย request ได้ ส่วน Backend มี version/lease และ durable client ID อยู่แล้ว จึงควรเสริม frontend latch ไม่ถอด backend guards
- รายการข้อความใช้ Map dedup ID อยู่แล้ว แต่ callback ของ Realtime ยังประมวลผล payload ซ้ำทุกครั้ง เพิ่ม bounded event dedup ซึ่งยังยอมให้ UPDATE ของ delivery status ผ่าน
- Realtime ของ Inbox และสถานะทีมเป็นคนละ channel มี cleanup เดิมอยู่ ไม่ถือว่ามีสอง channel แล้วเป็น bug การทดสอบ Strict Mode ยืนยันว่าเหลือสอง channel ที่มีหน้าที่ต่างกันหลัง cleanup
- Reconnect recovery สามารถเริ่ม loadThread ต่อหลัง effect cleanup ระหว่าง await ได้ เพิ่ม disposed/selection check อีกครั้ง

## สิ่งที่แก้

1. `LatestInboxRequest` ยกเลิก transport และ invalidate ผล request เก่า แม้ transport ไม่สนใจ abort
2. สลับลูกค้าแล้วตั้ง selected ref ทันที ล้างข้อความ/สลิป/โฟกัส และ key Thread/Inspector ตาม customer ID; เลือก ID เดิมซ้ำไม่เริ่มเลือกใหม่
3. Abort thread queries, history, slip detail, search และ state refresh พร้อมตรวจผลหลัง parse
4. ป้องกัน double-submit ด้วย ref latch สำหรับรับ/โอน/ปิดแชท ส่งข้อความ ร่าง AI และ pagination
5. แชร์ read-marker request ที่กำลังทำงานระหว่าง effect rerun; DB ยังใช้ monotonic read sequence เดิม
6. เพิ่ม native dialog คู่มือหนึ่ง instance และใช้ inline form สำหรับเหตุผลปิด ไม่มี modal stack ใหม่

## Workflow และ Database

ไฟล์ `supabase/smart-inbox-pro.sql` เป็น additive migration หลัง `smart-inbox.sql`:

```text
UNASSIGNED → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED
                   ↘ คืนคิว → UNASSIGNED
CLOSED → เปิดใหม่ → ASSIGNED หรือ UNASSIGNED
```

- เก็บ lifecycle ใน `customers.inbox_stage` แยกจาก legacy `conversation_status=open/closed` เพื่อคง callers เดิม
- เพิ่ม `closed_at`, `closed_by`, `close_reason`; เหตุผลและ request ID เก็บใน conversation events ด้วย จึงยังมีประวัติเมื่อเปิดใหม่
- Trigger sync lifecycle เมื่อ legacy ownership, handoff หรือ webhook เปลี่ยนแชท และเปลี่ยนเป็น IN_PROGRESS เมื่อแอดมินส่ง/ลูกค้าตอบกลับงานที่แก้ไขแล้ว
- `manage_inbox_pro` ล็อก customer ตรวจสมาชิก/แพ็กเกจ/ผู้รับผิดชอบ/version/lease เรียก legacy RPC สำหรับคำสั่งเดิม และบันทึก receipt ใน transaction เดียว
- Idempotency scope เป็น `(tenant, actor, requestId)` คีย์เดิมและ payload เดิมคืนผลเดิมโดยไม่เพิ่ม audit/version; ใช้คีย์เดิมกับ payload อื่นถูกปฏิเสธ
- ปิดซ้ำด้วยคีย์ใหม่ถูกปฏิเสธเมื่อปิดอยู่; แอดมินอื่นรับงานที่มีคนรับแล้วไม่ได้; exact replay ของคำสั่งที่สำเร็จไม่ต้องแข่ง version ใหม่
- จำกัดคำสั่งที่สำเร็จ 30 รายการ/นาที/ผู้ดูแล/ร้าน; lock actor ทำให้หลายบทสนทนาไม่ข้ามเพดานเดียวกัน คำขอที่ถูก auth/validation ปฏิเสธไม่อยู่ในเพดานนี้ หากต้องกัน volumetric attacks ใช้ ingress rate limit เพิ่มต่างหาก
- เปิดใหม่/คืนคิวไม่เปิด AI เอง การรับ/โอนใช้ bot_enabled=false และกลไก follow-up pause เดิม ไม่แก้ SlipOK
- Functions สำหรับ mutation/report เป็น service-only ตาราง receipts ไม่เปิดให้ browser อ่านหรือเขียน

## API

| Endpoint | การเปลี่ยน |
|---|---|
| GET `/api/inbox/state` | เพิ่ม capability `proEnabled`; เลือก lifecycle/closure metadata เฉพาะตอน flag เปิด |
| PATCH `/api/inbox/conversations/:id` | เมื่อ Pro เปิด รับ requestId, reason และ release/start/resolve; ตรวจ Origin/Sec-Fetch-Site; ส่งเข้า atomic Pro RPC |
| GET `/api/inbox/conversations/:id` | เพิ่มเหตุผลใน audit และประวัติ follow-up ตาม package access; tenant/customer filters ทุก query |
| GET `/api/inbox/pro` | รายงานจริงทั้ง tenant ผ่าน RPC หลัง authorization; flag ปิดไม่อ่านตารางใหม่ |

Client เก็บ payload/key เดิมขณะผล request ไม่แน่นอนเพื่อ retry เดิม; 4xx ที่ยืนยันว่าปฏิเสธปล่อยคีย์ สำหรับการโหลดหน้าใหม่ต้องดูสถานะ/audit ก่อนทำรายการซ้ำ เพราะ ref ไม่คงข้าม reload

## UI และรายงาน

9 ส่วนในหน้าเดิม: ภาพรวม, ทั้งหมด, รอรับ, ของฉัน, งานทีม, AI, ลูกค้า/ประวัติ, รายงาน, ความปลอดภัย ใช้สีและ components เดิม แท็บเลื่อนแนวนอนและคอลัมน์ปรับตามขนาดจอ

จำนวนรวม/รอรับ/กำลังดูแล/แก้ไขเสร็จ/ปิดแล้ว/บอทดูแลมาจากฐานข้อมูลทั้งร้าน ไม่ใช้จำนวน 150 แชทที่โหลดในรายการแทนยอดทั้งหมด งานเกินกำหนดใช้ 15 นาทีในรุ่นนี้ ยังไม่มี settings กำหนด SLA เอง

ค่าเฉลี่ยการตอบวัดจากข้อความลูกค้าแต่ละข้อความใน 30 วันถึงคำตอบ agent ที่มีสถานะ sent/delivered/read ครั้งถัดไป ไม่รวมบอทหรือข้อความ unknown และยังไม่ใช่ metric first response ต่อ session หากลูกค้าส่งหลายข้อความก่อนคำตอบเดียว จะมีหลาย sample ตามคำอธิบายหน้า UI

ผลงานทีมใช้ audit claim/close ใน 30 วัน จึงนับงานที่เปิดใหม่และปิดซ้ำเป็นคนละรอบที่มี audit จริง ไม่ได้อ้างว่าเป็นจำนวนลูกค้าที่ไม่ซ้ำ

รายชื่อลูกค้าและตัวกรองยังมี pagination/search ตามระบบเดิม ส่วน “งานทีม” แสดงผลงานรวมและใช้การเลือกแชท/มอบหมายเหนือ Thread; ยังไม่มี calendar หรือตัวจัดการทีมที่สร้างบัญชีผู้ใช้จากหน้านี้

Customer panel มีข้อมูล แท็ก บันทึก ออเดอร์ สลิป การติดตาม และ audit ตามสิทธิ์ รายละเอียดคำสั่งติดตามบางประเภท/การตั้งค่าเสียงแจ้งเตือนที่ไม่มีระบบรองรับ ระบุว่ายังไม่เปิดใช้งาน ไม่ใส่ข้อมูลตัวอย่างใน Production

## เปิดใช้งาน

1. สำรอง schema และทดสอบ migration บน staging ที่มี `smart-inbox.sql` และ dependencies เดิมก่อน
2. รัน `supabase/smart-inbox-pro.sql` ด้วย migration/admin role (service_role ปกติไม่ใช่เจ้าของตารางจึงไม่ใช้ทำ DDL)
3. ตั้ง `SMART_INBOX_PRO_ENABLED=true` ทุก instance แล้ว restart/deploy ตามกระบวนการของทีม ไม่มีการเปิด environment จริงในงานนี้
4. Safety รายร้านจากงานก่อนหน้าใช้ flag/migration แยก ไม่ได้เปิดโดย Pro flag นี้

## Rollback

- ตั้ง `SMART_INBOX_PRO_ENABLED=false` แล้ว restart ทุก instance จะกลับใช้ legacy mutation RPC/UI ไม่มี queries ของคอลัมน์ Pro ใน state API
- เก็บคอลัมน์ lifecycle, closure history, receipts และ audit ไว้ ไม่ drop/reset ข้อมูล
- Trigger ที่เพิ่มยัง sync lifecycle ตาม legacy writes และไม่เปลี่ยนความหมาย bot_enabled/conversation_status เดิม จึงเก็บไว้ได้เมื่อปิด flag
- ไม่ย้อน bug fixes เรื่อง stale response/double-submit และไม่เปิดบอทให้แชทที่ admin ดูแลอัตโนมัติ
- ไม่เปลี่ยน/ปิด `SNAPBOT_SAFETY_ENABLED` เพื่อ rollback Pro เพราะเป็นคนละ feature

## ไฟล์ที่เปลี่ยน

- State/realtime: `lib/inbox-request.ts`, `lib/inbox-types.ts`, `components/inbox/InboxClient.tsx`, `useInboxState.ts`, `ReadMarker.tsx`, `ChatList.tsx`
- Thread/actions: `Conversation.tsx`, `ConversationActions.tsx`, `ReplyBox.tsx`, `ConversationHistory.tsx`, `AutoPilotToggle.tsx`, `components/slips/SlipDetailPanel.tsx`
- UI ใหม่: `components/inbox/InboxProCenter.tsx`
- API: `app/api/inbox/state/route.ts`, `app/api/inbox/conversations/[id]/route.ts`, `app/api/inbox/pro/route.ts`, `lib/inbox-server.ts`
- SQL: `supabase/smart-inbox-pro.sql`
- Tests: `scripts/test-smart-inbox-pro-sql.cjs`, `test-smart-inbox-pro-api.cjs`, `test-inbox-request.cjs`, `test-inbox-realtime.cjs`, `check-smart-inbox-browser.cjs`, `inbox-browser-loader.cjs`, `scripts/fixtures/inbox-pro/*`

## Browser evidence

`node scripts/check-smart-inbox-browser.cjs` ใช้ Chrome headless กับ React Strict Mode และ components จริง แต่แทน Supabase/API ด้วย fixtures ออฟไลน์ ไม่โหลด `.env` ไม่เชื่อมบัญชีจริง ไม่ส่ง Messenger

ตรวจ repeated selection 3 ครั้ง, A→B→C, stale responses แม้ mock transport ไม่สนใจ abort, Realtime replay/reconnect, channel cleanup, triple claim/close/reopen, คู่มือหนึ่ง dialog และไม่มี horizontal overflow ที่ 375/768/1440 px ภาพหน้าจออยู่ใน `docs/screenshots/inbox-pro-*.png` และเป็นภาพข้อมูลทดสอบออฟไลน์

ยังไม่ได้ตรวจ production session, สิทธิ์ที่ติดตั้งจริงบน Supabase หรือการเชื่อมต่อ Meta จริง ต้องทำ staging acceptance ก่อนเปิดใช้กับข้อมูลจริง

## ผลทดสอบรอบนี้

- TypeScript `tsc --noEmit` ผ่าน
- Lint ไม่มี error มี warning เดิมนอกส่วนที่แก้ 9 รายการ
- Regression ที่เลือก 25 ไฟล์ผ่าน 153 test entries ครอบคลุม Inbox/AI/SlipOK/Payment Pro/ธนาคาร/follow-up/safety และ SQL จำลอง หลังเพิ่มกรณี replay หลัง migration รันซ้ำและปรับรายงาน ได้รัน SQL/API/Realtime ที่เกี่ยวข้องซ้ำผ่าน
- Chrome ใช้ components จริง + React Strict Mode ผ่านการเลือก B ซ้ำสามครั้งโดยอ่าน thread เพิ่มครั้งเดียว, สลับ A→B→C โดยปล่อยให้ requests ซ้อนกัน, event replay, reconnect, กดรับ/ปิด/เปิดซ้ำสามครั้งแต่ละคำสั่งส่ง PATCH ครั้งเดียว, notice เดียว, Thread/Inspector/guide อย่างละ instance และจอ 375/768/1440px ไม่ล้นแนวนอน
- ภาพ PNG เป็นหลักฐานของ fixture ออฟไลน์ ไม่ใช่ภาพ session Production
- Production build ผ่านการ compile, lint/type validation และสร้าง routes โดยไม่มีการ deploy
