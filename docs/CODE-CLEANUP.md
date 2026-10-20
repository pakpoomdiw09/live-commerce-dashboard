# ผลการตรวจและเก็บกวาดโค้ด

ตรวจไฟล์ใน `app`, `components`, `lib`, `scripts`, `tests`, `docs` และ `supabase` รวม 614 รายการในรอบแรก รวมถึง source 470 ไฟล์ ตรวจ TypeScript import graph, dynamic import, Next.js route entry points และการอ้างไฟล์โดยชุดทดสอบ ก่อนลบไฟล์ที่ไม่มีผู้เรียกใช้ ไม่อ่านหรือแก้ค่า `.env.local`

## ไฟล์ที่ลบ

| กลุ่ม | ไฟล์ |
| --- | --- |
| UI ที่ไม่มีผู้เรียกใช้ | `components/chatbot/AgentMiniSandbox.tsx`, `components/chatbot/AutomationEmergencyStop.tsx`, `components/ComingSoon.tsx`, `components/inbox/AutoPilotToggle.tsx`, `components/shell/CreditWidget.tsx` |
| สำเนา Inbox รุ่นเก่าที่ไม่มี route เรียกใช้ | `components/inbox/ChatListLegacy.tsx`, `components/inbox/ConversationHistoryLegacy.tsx`, `components/inbox/InboxProCenterLegacy.tsx`, `components/inbox/InspectorLegacy.tsx` |
| helper ที่ไม่มีผู้เรียกใช้ | `lib/broadcast-events.ts`, `lib/inbox-channels.ts` |

ลบ 11 source files หลังตรวจทั้ง import และการอ้างชื่อใน workspace เอกสารเก่าบางฉบับยังกล่าวถึงหน้าจอรุ่นก่อนในฐานะบันทึกประวัติ ส่วน API หยุดระบบอัตโนมัติ การบังคับใช้ Safety Mode และเส้นทาง Next.js ยังคงอยู่ตามเดิม

ลบเฉพาะ log ว่าง 5 ไฟล์ใน `.tmp` หลังตรวจขนาดและตำแหน่งจริง:

- `broadcast-types-final.log`
- `broadcast-types.log`
- `commerce-types-final.log`
- `commerce-types.log`
- `upload-security-final-types.log`

ไม่พบไฟล์ว่างในกลุ่ม source/เอกสารที่ตรวจ เก็บ log ที่มีข้อมูล ผลการทดสอบ รูปประกอบ และ SQL migration ไว้

## การปรับโครงสร้าง

- รวมการตรวจ magic bytes ของ JPEG/PNG/WebP จาก Payment, Vision และ Upload เป็น `lib/image-signature.ts` แต่ละระบบยังคงข้อจำกัดขนาด การถอดรหัส และรูปแบบข้อผิดพลาดของตัวเอง
- รวมโค้ดโหลด TypeScript สำหรับ test helpers เป็น `scripts/helpers/load-typescript.cjs` ยังคงตรวจ dependency แบบระบุชัดและใช้ VM แยกสำหรับการทดสอบ
- ย้าย `aggregateOverviewSlips` ซึ่งใช้เฉพาะเป็นตัวอ้างอิงใน test ไป `scripts/fixtures/overview-slips.ts` บริการ Overview จึงเหลือเฉพาะการอ่านข้อมูล production จาก SQL
- ลบ import ที่ไม่ได้ใช้ใน Handover, Follow-up และ Tenant ส่วนตัวแปรที่ไม่ได้ใช้ใน ChatListLegacy หายไปพร้อมไฟล์ที่เลิกใช้
- ลบ `eslint-disable` ที่ไม่มีผล 5 จุด แก้ชื่อไอคอน `Image` เป็น `ImageIcon` เพื่อไม่ให้ถูกตรวจผิดเป็นแท็กรูปภาพที่ขาด alt
- ตั้งชื่อค่าจำกัดของ upload แทนตัวเลขซ้ำ ขยายส่วนคืนช่องทำงานและ constructor ให้อ่านตรงไปตรงมา ลดคอมเมนต์ที่บรรยายโค้ดซ้ำ แต่เก็บเหตุผลเรื่อง idempotency, lease, เครดิต และการรักษาข้อมูลเก่าไว้
- แก้การทดสอบ log ที่ค้นหายอดเงิน `390` ใน JSON ทั้งก้อน เพราะ UUID สุ่มอาจมีเลขชุดเดียวกัน เปลี่ยนเป็นตรวจว่าฟิลด์ข้อมูลการเงินไม่อยู่ใน metadata

## ส่วนที่เก็บไว้โดยตั้งใจ

- `/api/webhook/facebook` และ `/api/webhooks/facebook` เป็น route alias ที่เรียก shared handler เดียวกัน ต้องเก็บทั้งสอง URL เพื่อรองรับ webhook ที่ลงทะเบียนไว้
- ไม่เปลี่ยนตัวเลือกแพ็กเกจ Safety Mode ลำดับคีย์เวิร์ด/AI เงื่อนไข 24 ชั่วโมง การตรวจสลิป หรือสัญญาข้อมูลของ API
- ไม่รวม helper ตรวจข้อมูลทั้งหมดเป็น utility ก้อนเดียว เพราะแต่ละโดเมนมีนโยบายและ error response ต่างกัน รวมเฉพาะการตรวจลายเซ็นภาพที่ใช้เกณฑ์เดียวกัน

## ผลการตรวจสอบ

- Import graph หลังเก็บกวาด: source 462 ไฟล์ ไม่พบโมดูลกำพร้าใน `components` และ `lib` ตาม entry points ที่ตรวจ
- Regression 175 กรณีผ่าน ครอบคลุม webhook queue, retry/idempotency, ข้อมูลหลายร้าน, SQL aggregation, store rules, logging, upload, payment และ Vision
- Overview reference และ avatar regression เพิ่มอีก 5 กรณีผ่าน
- TypeScript ผ่านเมื่อเปิด `noUnusedLocals`, `noUnusedParameters` และ `allowImportingTsExtensions` สำหรับชุดทดสอบที่ import `.ts` โดยตรง
- `npm run build` ผ่านครบถึงขั้นสร้าง route และ production bundle
- ESLint ไม่มี error เหลือ warning เดิม 12 จุด: การใช้ `<img>` 11 จุด และ dependency ของ effect ใน `PaymentModal` 1 จุด ไม่เปลี่ยนวงจรสร้างรายการชำระเงินเพียงเพื่อปิด warning
- คำสั่ง `npm test` ไม่เริ่มทดสอบในเครื่องนี้ เนื่องจากตัวรัน `tsx` เรียก `uv_os_get_passwd` แล้วได้รับ `ENOMEM` ต้องตรวจคำสั่งนี้ในสภาพแวดล้อมที่ตัวรันเริ่มทำงานได้ ไม่ถือว่าการทดสอบทั้งโปรเจกต์ผ่านทั้งหมด

การทดสอบใช้ข้อมูลจำลองหรือ PostgreSQL/WASM แยกจากฐานข้อมูลจริง ไม่มีการส่งข้อความ เรียก AI จริง หรือเปลี่ยนเครดิต
