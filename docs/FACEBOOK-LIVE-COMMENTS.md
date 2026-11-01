# ตรวจและแก้ Facebook Live Comment Webhook

## ผลตรวจวันที่ 2 พฤศจิกายน 2026

ตรวจแบบอ่านอย่างเดียวจาก Supabase ที่ตั้งค่าในเครื่อง และ Meta App/เพจล่าสุดที่มี event ในฐานนั้น:

- จำนวน `facebook_webhook_events.kind = 'change'` เป็น **0** และ payload ล่าสุด 50 รายการมีเฉพาะ `entry.messaging` ไม่มี `entry.changes` จึงยังไม่มีหลักฐานว่าคอมเมนต์ไลฟ์ส่งเข้าคิวนี้ การแก้ matcher อย่างเดียวไม่ทำให้ event ที่ยังไม่มาถึงเกิดขึ้นได้
- App subscription เปิดใช้งาน มี `feed` และเพจล่าสุดสมัคร `feed` กับแอปนี้แล้ว Callback ที่ Meta รายงานคือ `https://live-commerce-dashboard-faxh.vercel.app/api/webhook/facebook`
- โทเคนเพจล่าสุดเป็นชนิด `PAGE` ยังใช้ได้และตรงกับเพจ แต่ scopes ที่ตรวจพบไม่มี `pages_manage_engagement` และ `pages_read_user_content`
- ผู้ใช้ยืนยันว่าบัญชีทดสอบเป็นแอดมิน/ผู้พัฒนาแอป จึงไม่สรุปว่าเกิดจาก Development mode เพียงอย่างเดียว ตรวจด้วยว่าคอมเมนต์ในนามบัญชีบุคคล ไม่ใช่ในนามเพจเอง เพราะระบบต้องข้ามข้อความของเพจเพื่อป้องกันการตอบวน

ผลนี้จำกัดอยู่ที่ฐานข้อมูลและเพจล่าสุดที่ตรวจ ไม่ยืนยันว่า Vercel ทุก deployment ใช้ค่า environment ชุดเดียวกัน ไม่ได้ส่งคอมเมนต์/Inbox จริง เปลี่ยน subscription หรือแก้ข้อมูล production ในการตรวจครั้งนี้

## โค้ดที่แก้

| ไฟล์                                                          | การทำงาน                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/integrations/facebook/webhook-envelope.ts`               | Normalize `feed` และ `live_comments` ก่อนสร้าง idempotency key และเข้าคิว รองรับ `comment_id`, `comment.id`, live `id`, `sender_id`, nested `from`, `video_id` และ `live_video_id` เก็บ comment ID เต็มไว้สำหรับตอบกลับ ไม่แปลงการแก้ไข/ลบให้เป็นคอมเมนต์ใหม่ |
| `lib/features/comments/live-comment-routing.ts`               | เลือก post/video ID ที่ตรงกับขอบเขตของ rule จริง                                                                                                                                                                                                              |
| `lib/integrations/facebook/webhook-handler.ts`                | ส่ง ID ที่จับคู่ได้เข้า `place_cf_order` แทน post ID คนละค่ากับ video ID ตรวจ Page/tenant เดิม และ log เหตุผลที่ข้าม                                                                                                                                          |
| `lib/integrations/facebook/client.ts`                         | อ่าน Live Video ID โดยตรงหรือผ่าน attachments ของโพสต์ ส่ง private/public reply ด้วย comment ID และเก็บ HTTP status, Meta error code/subcode, type และ trace ID โดยปิดบัง credentials และข้อความที่ส่ง                                                        |
| `lib/features/commerce/live-cf-comment.ts`                    | พยายามส่งแต่ละช่องทางแยกกัน รอผลทั้งสองและโยน error กลับคิวหากล้มเหลว ไม่ส่งบิลเมื่ออ่านยอดรวมไม่ได้หรือไม่มี signed payment link                                                                                                                             |
| `lib/features/commerce/orders.ts`                             | เก็บ RPC error code สำหรับวิเคราะห์ปัญหาฐานข้อมูล                                                                                                                                                                                                             |
| `lib/integrations/facebook/oauth.ts`                          | เพิ่ม scopes ที่เกี่ยวกับการอ่าน/จัดการคอมเมนต์และสมัครเพจในการเชื่อมต่อครั้งถัดไป                                                                                                                                                                            |
| `lib/integrations/facebook/diagnostics.ts`, `webhook-http.ts` | Log JSON payload หลังตรวจ HMAC สำเร็จเท่านั้น ปิดบัง token/secret/ข้อมูลบัญชีตามชื่อฟิลด์ ไม่เปลี่ยน bytes ที่ใช้ตรวจลายเซ็น                                                                                                                                  |
| `scripts/diagnose-facebook-webhook.cjs`                       | เพิ่มสรุปชนิด payload, จำนวน change events และตัวเลือก `--meta` สำหรับอ่าน subscription/ชนิดและ scopes ของ token โดยไม่ส่งข้อความ                                                                                                                             |

ตัวจับคู่ Live ยังคงใช้ `liveRuleCode`/`live-cf-codes` ตัวเดียวกับหน้าทดลอง: Contains รองรับตัวพิมพ์เล็กใหญ่ การเว้นวรรคระหว่างตัวอักษรกับตัวเลข และข้อความนำหน้า เช่น keyword `fc159` ตรงกับ `CF fc159`, `รับ fc159`, `FC159` และ `เอา fc 159?` ส่วน Exact ต้องตรงกับ keyword ทั้งข้อความตามเดิม ไม่บังคับให้ลูกค้าพิมพ์ CF/FC

## เส้นทางส่งข้อความ

Live bill เริ่มด้วย:

```http
POST /{comment_id}/private_replies
Content-Type: application/json

{"message":"รายละเอียดสินค้า ยอดเงิน และ signed payment link"}
```

ใช้เวอร์ชันจาก `FB_GRAPH_VERSION` (ค่าเริ่มต้นในโปรเจกต์ `v24.0`) ไม่ลดเวอร์ชันทั้งระบบเป็น `v19.0` หาก Meta ปฏิเสธชัดเจนว่า edge `private_replies` ไม่มีอยู่ ด้วย HTTP 400/code 100 เท่านั้น จึงลองเส้นทางที่ผูกกับคอมเมนต์:

```http
POST /{page_id}/messages
Content-Type: application/json

{"recipient":{"comment_id":"COMMENT_ID"},"message":{"text":"รายละเอียดบิล"}}
```

Live bill ไม่ใช้ `recipient.id` หรือ `/me/messages` ส่งเข้าบัญชีบุคคลที่ยังไม่เคยทักเพจ ไม่ fallback เมื่อ timeout, network failure, permissions error หรือ rate limit เพราะอาจทำให้ส่งซ้ำ เมื่อผลการส่งไม่แน่นอน checkpoint ของ worker ยังคงป้องกันการส่งซ้ำอัตโนมัติและอาจต้องตรวจสอบด้วยผู้ดูแล

Public reply ใช้ `POST /{comment_id}/comments` พร้อม `{ "message": "..." }` หากช่องทางหนึ่งล้มเหลว อีกช่องทางยังถูกพยายามส่ง แต่คิวจะไม่รายงานว่าสำเร็จทั้งหมด

## ขั้นตอนใช้งานหลัง deploy

1. ตรวจว่า production ใช้ App ID/App Secret, Supabase project และ callback เดียวกับแอปที่กำลังทดสอบ ลายเซ็นที่ไม่ผ่านจะได้ HTTP 401 และไม่เข้าคิว
2. เชื่อมต่อเพจใหม่เพื่อให้ token มีสิทธิ์ที่ได้รับอนุญาตครบ โดยเฉพาะ `pages_manage_engagement` สำหรับตอบใต้คอมเมนต์ และ `pages_read_user_content` สำหรับข้อมูลที่ผู้ใช้สร้าง พร้อม `pages_read_engagement`, `pages_manage_metadata`, `pages_messaging`, `pages_show_list` การเพิ่ม scope ใน source ไม่เพิ่มสิทธิ์ให้ token เก่า
3. หากใช้ `FB_LOGIN_CONFIG_ID` ให้เพิ่มสิทธิ์ใน Facebook Login for Business configuration ด้วย เพราะ flow นี้ใช้ permissions จาก configuration ไม่ใช่พารามิเตอร์ `scope` หาก Meta ยังไม่อนุญาตสิทธิ์ ต้องจัดการสิทธิ์นั้นใน Meta App ก่อนขอใหม่
4. เลือกไลฟ์และเปิด rule ของเพจให้ถูก ตั้ง Contains กับ keyword สินค้า เปิดตัวเลือกตอบคอมเมนต์และส่ง Inbox ตามต้องการ ทดสอบด้วยคอมเมนต์ **ใหม่** จากบัญชีบุคคลแอดมินแอป ไม่ใช้ event เดิมซ้ำเพื่อบังคับสร้างบิล
5. ดู Meta delivery/debug และ Vercel Logs ตามลำดับด้านล่าง หากไม่มี ingress log เลย ให้ตรวจ callback/deployment/Meta delivery ก่อน matcher หากมี ingress แต่เข้าคิวไม่ได้ให้ดู `QUEUE_INSERT_FAILED` หาก Meta ส่ง payload มาโดยไม่มีผู้เขียน ระบบจะ log `NO_COMMENT_AUTHOR` และไม่สร้างตัวตนลูกค้าขึ้นเอง

| Log                          | สิ่งที่ตรวจได้                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[facebook-webhook/raw]`     | โครงสร้าง payload ที่ผ่าน signature แล้ว เช่น `changes`, `field`, `item`, `verb`, `comment_id`, `post_id`, `video_id`                                                      |
| `[facebook-webhook/ingress]` | จำนวน event, enqueue, accepted/duplicate, receipt                                                                                                                          |
| `[live-cf/comment]`          | `NOT_NEW_COMMENT`, `PAGE_OWN_COMMENT`, `MISSING_COMMENT_ID`, `NO_TENANT`, `DUPLICATE_COMMENT`, `NO_COMMENT_AUTHOR`, `NO_MATCHING_LIVE_KEYWORD`, `NO_MATCHING_LIVE_SESSION` |
| `[live-cf/order]`            | rule/post ที่ส่งให้ฐานข้อมูล สถานะ created/sold_out/no_match หรือ RPC error code                                                                                           |
| `[facebook/send]`            | HTTP status, errorCode, errorSubcode และ responseData/trace ของ Meta โดยปิดบังความลับ                                                                                      |
| `[live-cf/reply]`            | ช่องทาง private/public ที่ล้มเหลวและ error code                                                                                                                            |

Raw payload log ที่ผู้ใช้ขออาจมีข้อความและชื่อบุคคล แม้ปิดบัง credentials แล้ว การเข้าถึงและระยะเวลาเก็บ log ควรเป็นไปตามการจัดการข้อมูลลูกค้าของร้านค้า

ตรวจซ้ำแบบอ่านอย่างเดียว:

```powershell
node scripts/diagnose-facebook-webhook.cjs
node scripts/diagnose-facebook-webhook.cjs --meta
```

## การทดสอบ

เพิ่ม `tests/features/commerce/live-webhook.test.ts` ทดสอบ normalize/deduplicate, ลายเซ็นก่อน log/เข้าคิว, matcher ผ่าน handler, post/video ID ต่างกัน, author/session ไม่ตรง, edit/remove, endpoint และ payload ของการตอบกลับ, error diagnostics และ fallback เฉพาะกรณีที่ปลอดภัย เพิ่มกรณีแต่ละช่องทางล้มเหลว/ไม่มี signed link/อ่านยอดไม่ได้ใน `live-cf-comment.test.ts`

```powershell
npm test
node --test scripts/test-facebook-send-diagnostics.cjs
node --test scripts/test-facebook-auth-flow.cjs
npx tsc --noEmit
npm run build
```

Tests จำลองการส่ง Graph API เท่านั้น ไม่ถือเป็นหลักฐานว่า production ได้รับคอมเมนต์หรือส่งบิลจริงแล้ว รอบนี้ไม่ต้องเพิ่ม SQL migration

เพิ่ม scopes ทั้ง `lib/integrations/facebook/oauth.ts` และ `lib/oauth.ts` เพื่อรองรับ direct Page OAuth และ Supabase OAuth สคริปต์ auth-flow เดิมอ้างถึง `components/LoginForm.tsx` ซึ่งไม่มีแล้ว จึงปรับให้ทดสอบปุ่มเชื่อมต่อเพจปัจจุบัน `components/select-page/ConnectFacebookButton.tsx` พร้อมตรวจ scopes และ callback
