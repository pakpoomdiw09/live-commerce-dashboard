# SnapBot — Audit และแผน refactor SaaS

วันที่ตรวจ: 16 ตุลาคม 2026 (เวลาไทย)

ขอบเขต: ตรวจ source ใน App Router, API, components, lib, migrations และชุดทดสอบที่เกี่ยวข้อง การตรวจนี้ไม่ได้ยืนยัน schema/grants ที่ติดตั้งบน Supabase จริง ไม่อ่านค่าคีย์จาก `.env.local` และไม่เรียก SlipOK, Gemini หรือ Messenger จริง

ผู้ใช้ระบุ Phase 1–5 แต่แจกแจงรายละเอียดถึง Phase 4 เอกสารนี้ใช้ Phase 5 สำหรับการทดสอบ การเปิดใช้งาน และ rollback

## สิ่งที่มีอยู่แล้ว

| ระบบ | หลักฐานใน source | ขอบเขตที่ยืนยันได้ |
|---|---|---|
| สลิป | `lib/features/slips/slipok.ts`, `lib/features/slips/process.ts` | ผลผ่านมาจาก SlipOK และตรวจบัญชีร้าน ไม่ใช้คำตอบโมเดลยืนยันเงิน |
| AI ภาพ | `lib/features/vision/vision-provider.ts`, `lib/features/vision/vision-types.ts`, `lib/features/vision/vision.ts` | ตรวจประเภทภาพและส่งต่อสลิปให้ verifier ไม่มีเส้นทางให้โมเดลตั้งสถานะ paid เอง |
| ป้องกันธุรกรรมซ้ำ | `supabase/schema.sql`, `payments.sql`, `payment-pro.sql` | unique index ของ valid slip และ permanent transfer ledger ข้ามช่องทาง ต้องติดตั้ง migrations จริง |
| ธนาคาร | `app/api/bank-accounts/route.ts`, `lib/features/slips/slip-bank-server.ts`, `supabase/slip-bank-controls.sql` | staff ได้เลขปิดบัง Owner/platform Admin แก้ผ่าน RPC พร้อม audit โดยไม่เก็บเลขเต็มใน audit |
| Inbox | `supabase/smart-inbox.sql`, `app/api/messages/send/route.ts` | version, assignment, delivery lease, durable client ID และผลส่ง unknown |
| Payment Pro | `supabase/payment-pro.sql` | ตรวจ receiver/amount/order snapshot/เวลา จับ ledger conflict และเปลี่ยน order/หยุด payment follow-up ภายใน transaction |
| Webhook | `app/api/webhook/facebook/route.ts` | มี signature/dedup และใช้โมดูลเดิม ไม่แก้ route หรือการตรวจลายเซ็นในงานนี้ |

## Phase 1 — Security & Banking

### แก้ในรอบนี้

- `lib/features/slips/process.ts`: valid ต้องมีเลขอ้างอิงที่ไม่ว่างและยอด finite > 0 แม้ไม่มี expected amount ป้องกัน NULL reference หลุด unique index
- `lib/features/slips/slipok.ts`: รับ transRef เฉพาะ string และ trim ก่อนใช้กับ ledger/index
- อัปเดต customer เฉพาะ tenant เดียวกันและสถานะ `new`/`pending_review` ไม่เขียนทับ `paid`/`approved`/`shipped` เมื่อส่งสลิปที่มีปัญหาภายหลัง
- `supabase/security.sql` และ `facebook-tenants.sql`: ตัดการ grant เลขบัญชีเต็มกลับให้สมาชิกทุกคนเมื่อรัน setup ซ้ำ เส้นทางอ่านเลขเต็มผ่าน API ที่ตรวจ Owner/platform Admin ยังคงเดิม
- เพิ่ม regression tests สำหรับเลขอ้างอิงหาย ยอดผิด และสถานะถอยหลัง

### ความเสี่ยงที่ยังต้องรวมเส้นทาง

- Legacy verifier บันทึก verdict และอัปเดต order คนละคำสั่ง มี partial failure window; Payment Pro มี transaction ที่เข้มงวดกว่าอยู่แล้ว ควรทยอยย้าย entry points มาสู่ `processPaymentPro` หลังทดสอบ staging ห้ามสร้าง verifier คู่ขนานอีกชุด
- `markOrdersPaid` เดิมรับ order IDs จาก caller ควรย้ายให้ RPC derive รายการจาก tenant/customer และตรวจยอดใหม่ภายใต้ lock ทุกครั้ง
- เก็บ Ref1 เป็นข้อมูลประกอบจากผู้ให้บริการได้ แต่ห้ามใช้ Ref1 เดี่ยวเป็น unique transaction key เพราะอาจเป็น reference ของรายการ/ร้านที่ใช้ซ้ำได้ ใช้ transRef ที่ยืนยันโดย provider และ permanent ledger เป็นหลัก
- `raw` มีข้อมูลผู้ส่ง/ผู้รับ ต้องตรวจ grants, retention และการ redaction ของทุก endpoint ที่คืนหลักฐาน ไม่คืน provider payload ให้ staff โดยไม่จำเป็น
- แก้ dev log ใน legacy verifier ให้เหลือ verdict/จำนวนบัญชี/ผลเทียบ หยุดพิมพ์ข้อมูลบัญชีและ raw receiver โดยไม่เปลี่ยน adapter
- ต้องตรวจ privileges บนฐานจริงอีกครั้ง โดยเฉพาะ setup เก่าที่เคยให้ table-level SELECT; revoke เฉพาะ column ไม่หักล้าง table grant ตาม [Supabase Column Level Security](https://supabase.com/docs/guides/database/postgres/column-level-security)

## Phase 2 — AI Agent & Human Handoff

### แก้ในรอบนี้ (เปิดด้วย `SNAPBOT_SAFETY_ENABLED=true`)

- `supabase/automation-safety.sql`: เพิ่มตาราง stop ราย tenant, audit และ service-only RPC ตรวจ Owner/platform Admin ซ้ำใน DB ไม่มีการแก้ API key หรือ Auth
- `app/api/automation-safety/route.ts`: GET ตรวจสมาชิก, PATCH ตรวจ Owner/platform Admin; ไม่รับ actor/tenant จาก body ไม่ผูก emergency stop กับสิทธิ์ซื้อ AI เพื่อให้หยุดได้แม้แพ็กเกจหมด
- `lib/automation-safety.ts`: อ่านสถานะใหม่ทุก boundary ไม่ cache; ถ้า query ล้มเหลวให้หยุดงานด้วย error ไม่มี fallback เป็นอนุญาตส่ง
- `AutomationEmergencyStop.tsx`: ปุ่ม “หยุดฉุกเฉิน” ใน Control Center และหน้า legacy; หาก flag ไม่เปิด แสดงว่ายังไม่เปิดใช้งาน การเปิดกลับต้องยืนยัน
- `lib/features/agents/ai-agent.ts`: ตรวจ tenant stop ก่อนเรียกโมเดล ก่อน retry และหลังได้คำตอบ
- `lib/features/follow-ups/followup-ai.ts` และ `lib/features/vision/vision.ts`: เพิ่ม global/tenant stop ที่ provider boundary และตรวจหลังผลลัพธ์ ไม่ให้ผล AI ที่เสร็จช้าเปิดระบบกลับเอง
- `lib/features/slips/notify.ts`: ตรวจ stop ก่อน automatic bot message แต่ละส่วน ไม่รวม Broadcast ที่ผู้ใช้สั่งและปุ่มยืนยันสลิปที่แอดมินสั่งเอง
- `lib/features/follow-ups/follow-ups.ts`: งานที่หยุดก่อน prepare ไป `requires_review`; หากหยุดหลัง reserve แต่ก่อนส่ง ให้ settle แบบ failed เพื่อคืนเครดิตตาม RPC เดิม
- `claim_and_start_inbox_reply`: รับช่วง ownership และขอ delivery lease ใน transaction เดียวก่อนส่งข้อความจาก Inbox ป้องกันการแย่งงาน admin อื่น ไม่ข้าม version หรือ lease เดิม
- Inbox ใช้ server capability `autoClaimOnReply` เพื่อเปิดพิมพ์แชทที่ยังไม่มีคนรับเมื่อ flag เปิด ไม่อ้างสิทธิ์จาก client อย่างเดียว

### ข้อจำกัดที่ต้องรู้

- สวิตช์ไม่สามารถเรียกคืน HTTP request ที่เริ่มส่งไปยัง provider แล้ว และไม่ยกเลิกข้อความที่ Facebook รับไปแล้ว มีช่วงเวลาระหว่าง check และ network call; UI/คู่มือไม่ควรอ้างว่าย้อนยกเลิกได้
- งานที่ถูก hold จะไม่ส่งย้อนหลังอัตโนมัติหลัง resume ต้องตรวจงานรอแยกต่างหาก
- สวิตช์ฉุกเฉินรายร้านหยุด AI/ข้อความบอทและ follow-up ครอบคลุมข้อความจากภาพ ไม่หยุด SlipOK verification, การชำระเงิน หรือ human outbound
- Global `AGENT_CONTROL_KILL_SWITCH` เดิมยังคงความหมายหยุด AI provider โดยไม่ทำลาย keyword flow เดิมเมื่อ safety flag ปิด
- Deployment แบบหลาย instance ต้องเปิด flag และใช้ฐานเดียวกันทุก worker ก่อนแสดงฟีเจอร์เป็นพร้อมใช้งาน

## Single Source of Truth

`lib/domain-state.ts` เป็นสัญญาสถานะกลางและ adapter:

| Domain | สถานะกลาง | legacy compatibility |
|---|---|---|
| Payment | SUCCESS / FAILED / PENDING_ADMIN / DUPLICATE | valid / fake / error, mismatch, pending / duplicate |
| Conversation | AI_ACTIVE / HUMAN_TAKEN_OVER / PAUSED / WAITING_APPROVAL | AI_ACTIVE / ADMIN_ACTIVE / PAUSED / WAITING_ADMIN |
| Order | PENDING_PAYMENT / PAID / SHIPPED / CANCELLED | new, pending_review, pending_payment / paid, approved / shipped / cancelled |

`lib/types.ts` และ SlipVerdict ใช้ legacy type จากแหล่งเดียวกัน ส่วน `agent-control-core.ts` แปลงผ่าน canonical conversation adapter โดยคง identifiers ภายนอกเดิม สถานะไม่รู้จักต้อง review ไม่ถือว่าผ่าน

ยังไม่ได้เปลี่ยน enum/check constraints ของฐานจริงทั้งหมดให้เป็น uppercase เดียวกัน เพราะจะทำให้ clients/RPC เดิมเสียหาย การรวมทุกโมดูลต้องใช้ expand → dual-read adapters → backfill ที่ตรวจได้ → contract ใน release แยก ไม่ควร bulk replace string ทั้ง repo

สถานะ workflow ของ provider (`VERIFYING`, `REVIEW_REQUIRED`) และสถานะส่งข้อความ (`sent`, `unknown`) เป็นคนละ domain กับสถานะการชำระเงิน ห้ามรวมให้เหลือ enum เดียวจนสูญเสียความหมาย

## Phase 3 — Smart Business Automation

ใช้ `apply_payment_pro` เป็น settlement transaction ที่มีอยู่แล้ว ไม่ย้ายการตัดเครดิตไป client:

1. ล็อก tenant/customer/attempt/order แล้วตรวจ feature, บัญชี, ยอดและ snapshot ใหม่
2. claim transRef ใน permanent ledger
3. ตั้ง slip ผ่าน, order paid, customer paid และยกเลิก payment follow-up ใน transaction เดียว
4. การส่ง confirmation ใช้ durable idempotency ของ notify; เครดิต provider/message ใช้ RPC backend เดิม

งานถัดไปที่ต้องทำก่อนประกาศว่าครบ checklist:

- เพิ่ม transactional outbox สำหรับ payment settled: unique `(event_id, channel)`; worker ตรวจ messaging window, permission, stop, credit และ receipt ก่อนปิดงาน
- ส่งไม่ทราบผลต้อง `unknown/review` ห้าม resend อัตโนมัติ และต้องมี reconciliation กรณี DB save ล้มหลัง provider สำเร็จ
- `lib/message-quota.ts` ปัจจุบัน refund เมื่อ callback error ทุกชนิด ต้องแยก explicit rejection กับ network timeout ก่อนปรับ ledger accounting โดยเพิ่ม tests ก่อนเปลี่ยนพฤติกรรม
- ยังไม่มี LINE notification integration ที่พร้อมใช้งาน ห้ามใช้ LINE Notify ซึ่ง [ยุติบริการ 31 มีนาคม 2025](https://notify-bot.line.me/) ให้ทำ adapter LINE Messaging API หลังตั้งค่าช่องทางและสิทธิ์จริง
- การย้าย legacy settlement เข้า Payment Pro และ outbox เป็นงาน migration แยก ยังไม่ได้เปิดใช้กับเงินหรือข้อมูลจริงในรอบนี้

## Phase 4 — Action Center / UI

แก้ในรอบนี้:

- `ActionRequired.tsx` แสดงบน overview ทั้งสองแบบเมื่อ safety flag เปิด: สลิปมีปัญหาที่ยังไม่อนุมัติ, แชทรอแอดมินรับ, เครดิตสลิป, การเชื่อมต่อเพจที่บันทึกไว้ ใช้ session/RLS และ tenant filter หากอ่านไม่ได้แสดงว่าอ่านไม่ได้ ไม่แสดงศูนย์ปลอม
- ไม่เรียก Meta API สดเพื่อแต่งสถานะว่าเชื่อมต่อสำเร็จ มี token บันทึกไว้แสดงเพียงบันทึกการเชื่อมต่อแล้ว
- `SlipsWorkspace.tsx` เพิ่ม card view บนมือถือ ใช้ข้อมูล/รายละเอียดสลิปชุดเดิม ตาราง desktop ยังคงเดิม
- `BankAccountsManager.tsx` มี card layout อยู่แล้ว ไม่สร้างหน้าธนาคารซ้ำ
- `components/ui/feedback.tsx` มี LoadingSpinner, ErrorMessage, EmptyState, SuccessToast พร้อม accessible roles; emergency panel ใช้ loading/error และ mobile slips ใช้ empty state

งาน refactor UI ที่ยังไม่ครบทั้งโปรเจกต์:

- ย้ายข้อความ UI ที่ยังเป็นอังกฤษใน PremiumOverview, PaymentProDashboard, image/follow-up pages และ error messages ของ API มาเป็นภาษาไทย โดยคง brand/API/internal identifiers
- เปลี่ยน inline loading/error/success ให้ใช้ component กลางทีละหน้า; SuccessToast ถูกเตรียมไว้ ยังไม่ได้ migrate ทุกหน้า
- `emptyPremiumOverview` ใน development ยังสร้าง dataset ศูนย์เมื่อ RPC ไม่พร้อม ควรเปลี่ยนเป็น availability model แบบ unknown แยกจาก zero และทบทวน tests เดิมก่อนเปลี่ยน
- ตรวจทุก breakpoint ใน browser จริง รวม keyboard focus, native dialog และ screen reader ยังไม่ได้ทำ end-to-end UI บนบัญชีจริงในรอบนี้

## โครงสร้างเป้าหมาย (ทยอยย้าย ไม่ย้ายไฟล์ทั้งหมดพร้อมกัน)

```text
lib/domain-state.ts                  # contracts / compatibility adapters
lib/automation-safety.ts             # tenant stop policy
lib/payments/                       # provider adapter → verification → settlement
lib/conversations/                  # ownership / lease / delivery
lib/automation/                     # outbox / workers / reconciliation
components/ui/feedback.tsx           # reusable Thai feedback
app/api/...                         # authenticate → validate → invoke service only
supabase/...                        # additive migrations / service-only atomic RPC
```

ไม่ย้าย route paths, Env names, DB columns หรือ Supabase Auth ใน refactor รอบแรก เก็บ wrapper เดิมจนทุก caller ถูกย้ายและ regression tests ผ่าน

## Phase 5 — เปิดใช้งานและ rollback

1. ทดสอบและสำรอง schema/grants ของ staging ก่อน ตรวจว่า `security.sql`, `smart-inbox.sql`, `bank-accounts.sql`, `slip-bank-controls.sql` และ Payment Pro dependencies ที่ร้านใช้อยู่ติดตั้งแล้ว
2. ใช้ `security.sql`/`facebook-tenants.sql` เวอร์ชันใหม่ตามลำดับ setup แล้วใช้ `slip-bank-controls.sql` หลัง security เพื่อไม่คืนสิทธิ์บัญชีเดิม ตรวจ Owner/staff จริงด้วย SQL role
3. รัน `supabase/automation-safety.sql` ผ่าน migration runner ที่มีสิทธิ์ โดยยังไม่เปิด flag; migration เป็น additive และรันซ้ำได้
4. Deploy app/workers แล้วเปิด `SNAPBOT_SAFETY_ENABLED=true` ใน staging ทุก instance ทดสอบหยุด/resume/permission/ส่งไม่ทราบผลด้วย provider stub
5. ตรวจ SQL และ API regression, type check, lint, build แล้วจึงทยอยเปิด production ตามร้าน/instance deployment policy ไม่ส่งข้อความจริงระหว่าง automated tests

Rollback UI/policy รุ่นใหม่: ใช้ขั้นตอนใน `supabase/automation-safety-rollback.md` ไม่ drop ตาราง audit และไม่แก้ API keys หรือ identifiers เดิม

**ข้อสำคัญ:** การปิด flag จะทำให้ tenant stop รุ่นใหม่นี้ไม่ถูกตรวจ หากมีร้านที่ stopped=true ห้ามปิด flag เพื่อ rollback โดยปล่อย legacy automation ทำงานต่อ ต้องคงการหยุดไว้ที่ tenant auto_reply / follow-up / vision switches ก่อน

## รายการไฟล์

ไฟล์ core ที่เปลี่ยน: `lib/features/slips/process.ts`, `lib/features/slips/slipok.ts`, `lib/features/agents/ai-agent.ts`, `lib/features/follow-ups/followup-ai.ts`, `lib/features/vision/vision.ts`, `lib/features/slips/notify.ts`, `lib/features/follow-ups/follow-ups.ts`, `lib/features/agents/agent-control-core.ts`, `lib/types.ts`, `lib/features/inbox/inbox-types.ts`, `app/api/messages/send/route.ts`, `app/api/inbox/state/route.ts` และ grant ใน `supabase/security.sql`, `supabase/facebook-tenants.sql`

ไฟล์ core ใหม่: `lib/domain-state.ts`, `lib/automation-safety.ts`, `app/api/automation-safety/route.ts`, `supabase/automation-safety.sql`

ไฟล์ UI ใหม่/เปลี่ยน: `AutomationEmergencyStop.tsx`, `AgentControlCenter.tsx`, `ConversationsClient.tsx`, `Conversation.tsx`, `ReplyBox.tsx`, `ActionRequired.tsx`, overview page ทั้งสองแบบ, `SlipsWorkspace.tsx`, `components/ui/feedback.tsx`

Test/support: `scripts/test-automation-safety.cjs`, `scripts/test-automation-safety-sql.cjs`, regression tests ที่เกี่ยวข้อง, dev dependency `@electric-sql/pglite`, `.gitignore` สำหรับ npm cache ชั่วคราว และเอกสารนี้

## ผลตรวจสอบรอบนี้

- `npx.cmd tsc --noEmit`: ผ่าน
- `npm.cmd run build`: ผ่าน รวม lint/type validation และการสร้าง production routes
- Lint ไม่มี error; build ล่าสุดมี warning เดิมในไฟล์อื่น 9 รายการ หลังถอด dev log ที่ไม่จำเป็นออก
- ชุด regression รวม 21 ไฟล์ผ่าน 142 test entries จากนั้นเพิ่มกรณี auto-claim API และรันไฟล์ Inbox ซ้ำผ่านครบ 11 กรณี รวม 143 test entries ที่ตรวจผ่านในรอบนี้ (SQL suites บางไฟล์นับเป็นหนึ่ง entry แต่ภายในตรวจหลาย scenario)
- PostgreSQL จำลองตรวจ repeatable migrations, owner/staff/foreign isolation, atomic ownership/lease, duplicate transfer, Payment Pro settlement, credit/refund, follow-up cancellation และ service-only grants ผ่าน
- ยังไม่ได้ apply SQL กับ Supabase จริง เปิด environment flag จริง ตรวจ browser ด้วย session จริง หรือส่งเงินจริง/ข้อความจริง
