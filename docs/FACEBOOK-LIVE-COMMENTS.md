# ตรวจและแก้ Facebook Live Comment Webhook

## ผลตรวจวันที่ 2 พฤศจิกายน 2026

ตรวจแบบอ่านอย่างเดียวจาก Supabase ที่ตั้งค่าในเครื่อง และ Meta App/เพจล่าสุดที่มี event ในฐานนั้น:

- ตรวจซ้ำหลังผู้ใช้รายงานช่วงทดสอบ 01:38–01:43 น.: พบ `kind = 'change'` **2 รายการ** เวลา 01:36:48 และ 01:37:43 น. วันที่ 2 พฤศจิกายน (เวลาไทย) ทั้งคู่เป็น Page ID `0` โดยมี `feed/item=status` และ `field=messages` ไม่ใช่คอมเมนต์จริงของเพจ ไม่พบ comment event ของเพจ `122099866472012045` ในฐานที่ตรวจ การข้าม `NOT_NEW_COMMENT` จึงถูกต้อง และไม่ควรแปลง test payload ให้เป็นคำสั่งซื้อ
- App subscription เปิดใช้งาน มี `feed` และเพจล่าสุดสมัคร `feed` กับแอปนี้แล้ว Callback ที่ Meta รายงานคือ `https://live-commerce-dashboard-faxh.vercel.app/api/webhook/facebook`
- โทเคนเพจล่าสุดเป็นชนิด `PAGE` ยังใช้ได้และตรงกับเพจ แต่ scopes ที่ตรวจพบไม่มี `pages_manage_engagement` และ `pages_read_user_content`
- Rule ที่บันทึกอยู่สำหรับเพจนี้เปิดใช้งาน ตั้ง keyword `as159` (Contains) ผูกสินค้า code `As159` สต็อก 10 และมี 2 variants เปิดทั้ง private/public reply แต่คำที่ผู้ใช้ทดสอบคือ `777` และ `กระเป๋า` จึงไม่ตรงกับ rule นี้แม้ได้รับ event แล้ว หากหน้าเว็บแสดง keyword ต่างจากนี้ ให้ตรวจว่า Vercel ใช้ Supabase project เดียวกับ `supabase_project_host` ในผลสคริปต์ และการตั้งค่าได้บันทึกแล้ว
- Rule ผูก video ID `1146979251099042` แต่ GET อ่านวิดีโอนี้ถูก Meta ปฏิเสธ HTTP 400/code 100/subcode 33 ขณะที่ GET `/{page_id}/live_videos` ส่ง `data: []` จึงยังยืนยันว่าเป็นไลฟ์ปัจจุบันของเพจไม่ได้ รหัสนี้อาจไม่ถูกต้องหรือ token ไม่มีสิทธิ์อ่าน ไม่สรุปว่าเป็นสาเหตุใดสาเหตุหนึ่งโดยไม่มีข้อมูลเพิ่ม
- ผู้ใช้ยืนยันว่าบัญชีทดสอบเป็นแอดมิน/ผู้พัฒนาแอป จึงไม่สรุปว่าเกิดจาก Development mode เพียงอย่างเดียว ตรวจด้วยว่าคอมเมนต์ในนามบัญชีบุคคล ไม่ใช่ในนามเพจเอง เพราะระบบต้องข้ามข้อความของเพจเพื่อป้องกันการตอบวน

ผลนี้จำกัดอยู่ที่ฐานข้อมูลและเพจล่าสุดที่ตรวจ ไม่ยืนยันว่า Vercel ทุก deployment ใช้ค่า environment ชุดเดียวกัน ไม่ได้ส่งคอมเมนต์/Inbox จริง เปลี่ยน subscription หรือแก้ข้อมูล production ในการตรวจครั้งนี้

รายการ `Page.SubscribedFields` ใน [SDK ทางการของ Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py) ระบุ `feed` และ `live_videos` แต่ไม่มี `live_comments` จึงคงการสมัครคอมเมนต์ผ่าน `feed` และไม่เพิ่มชื่อ field ที่ไม่อยู่ในรายการลง Page subscription ตัว parser ยังคงรองรับ payload ชื่อ `live_comments` เพื่อความเข้ากันได้ การ subscribe `live_videos` เป็นคนละ field และไม่ใช่การแทนการสมัครคอมเมนต์

โค้ดวนทุก `entry` และแปลง Page ID เป็น string ก่อน lookup `tenants.page_id` ไม่มีเงื่อนไขบังคับว่าต้องตรง `FB_PAGE_ID` เพียงเพจเดียว ค่า env นี้ใช้กับ fallback token เท่านั้น เพิ่มการปฏิเสธ numeric ID ที่เกินความแม่นยำของ JavaScript เพื่อไม่ให้เลือกเพจผิดเพราะตัวเลขถูกปัดเศษ

## โค้ดที่แก้

### สถาปัตยกรรมที่ตรวจจาก source

ระบบนี้รับคอมเมนต์ผ่าน **Webhook เท่านั้น** ไม่พบ worker ที่วน GET `/{video_id}/comments`, `EventSource` หรือ streaming listener ของ Facebook ในโค้ด production และไม่มีปุ่มเริ่ม Polling แยกต่างหาก

1. `chooseLive(video)` ใน `LiveCfSetup.tsx` ใส่ `video.id` ใน state `livePostId` การเลือกไลฟ์อย่างเดียวยังไม่บันทึกฐานข้อมูล
2. ปุ่ม “เริ่มเปิดระบบดูดออเดอร์” POST `/api/live-cf/setup` ส่ง `livePostId: parsedLiveId`, `codes` และ `isActive: true`
3. API บันทึก `comment_rules.live_post_id` พร้อมเปิด rule จากนั้นรอ Meta POST เข้ามาที่ webhook ไม่มีการเริ่ม GET comments หรือ worker listener ใหม่
4. Webhook ตรวจ signature → enqueue → `after()` เรียก `runFacebookWebhookWorker` → matcher ตรวจ Page/post/video scope → สร้างออเดอร์ → private/public reply
5. `setInterval` ใน `webhook-worker.ts` เป็น heartbeat ของ lease คิว ไม่ใช่ Polling คอมเมนต์ Facebook
6. มี route `/api/cron/facebook-webhooks` สำหรับประมวลผลคิวค้าง แต่ `vercel.json` ปัจจุบันไม่มี `crons` จึงยังไม่มีหลักฐานจาก repository ว่า Vercel ตั้งเวลาเรียก route นี้ อาจมี scheduler ภายนอกซึ่งตรวจจาก source นี้ไม่ได้ ทั้ง `after()` และ cron ไม่สามารถดึงคอมเมนต์ที่ Meta ยังไม่ส่งมา

HTTP 200 จาก `/api/facebook/live-videos` หมายถึง API อ่านรายการสำเร็จ โดยอาจเป็น `videos: []` หรือวิดีโอสำรองที่ `fallback: true, isLive: false` ได้ ตรวจ `liveCount`, `videoCount`, `fallback` และรายการ ID ใน log `[facebook/live-videos] result` เพื่อยืนยันว่าพบ LIVE จริง ส่วน `[live-cf/setup] saved` ยืนยัน rule/video ID ที่บันทึกแล้ว พร้อม `reception: webhook, pollingStarted: false` ไม่รวม token หรือ ingest URL ใน log

ตรวจซ้ำในฐานที่เชื่อมจาก workspace พบว่า rule เดิมเปลี่ยน `live_post_id` เป็น `1858415725351897` แล้ว แสดงว่ามีการบันทึก scope ใหม่เข้าฐาน ส่วน keywords ยังเป็น `as159` Token ยังมี `pages_read_engagement` และ `pages_manage_metadata` แต่ขาด `pages_read_user_content`/`pages_manage_engagement` โดย `feed` สมัครทั้งระดับ app และเพจแล้ว `live_videos` เป็นชื่อ webhook field ใน SDK ไม่ใช่ชื่อ OAuth permission จึงไม่ควรเพิ่มลง OAuth scopes

การอ่าน ID ใหม่ด้วย Graph ยังถูกปฏิเสธ code 100/subcode 33 และรายการ `/{page_id}/live_videos` จาก token ใน workspace ยังว่าง ข้อสังเกตนี้ไม่หักล้าง log 200 ของ deployment เพราะต้องเทียบ body, token, Supabase project และเวลาทดสอบให้ตรงกันก่อน

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
node scripts/diagnose-facebook-webhook.cjs --meta --page-id 122099866472012045
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

Log ที่เพิ่มในการตรวจรอบนี้:

- `[facebook-webhook/request] received`: เห็นทันทีว่า request ถึง handler แม้ body หรือ signature ไม่ผ่าน ไม่พิมพ์ headers หรือ unsigned body
- `[facebook-webhook/raw]`: JSON แบบ 2-space indentation หลังตรวจ signature แล้ว ปิดบัง token/secret ตามเดิม
- `[facebook-webhook/page] resolved`: Page ID, tenant, การตรงกับ `FB_PAGE_ID` และเหตุผล `PLACEHOLDER_PAGE_ID`/`PAGE_NOT_LINKED` โดยไม่ใช้ env เป็นตัวบล็อกหลายร้าน
- `[live-cf/match] evaluated`, `[live-cf/session] evaluated`: โหมดจับคู่ ผลแต่ละ rule, keyword count, matched code, product/variant ID, post IDs ที่พบ และผลเลือก session
- `[live-cf/order] RPC started/result/failed`: เห็นว่าส่งรหัสใดเข้า RPC และได้ created/sold_out/require_variant/no_match หรือ DB error code
- `[live-cf/reply] started/succeeded/failed/skipped`: แยก public/private และแสดงเหตุผลกรณีปิดการตอบหรือประกอบบิลไม่สำเร็จ
- `[facebook/send]`: เก็บ response ของ Meta ที่ปิดบังความลับ พร้อม operation และ reason แยก token, rate limit, explicit app-role restriction, messaging window และ permission/policy โดยไม่สรุปว่า code 10 ทุกครั้งคือ Development mode

เพิ่ม scopes ทั้ง `lib/integrations/facebook/oauth.ts` และ `lib/oauth.ts` เพื่อรองรับ direct Page OAuth และ Supabase OAuth สคริปต์ auth-flow เดิมอ้างถึง `components/LoginForm.tsx` ซึ่งไม่มีแล้ว จึงปรับให้ทดสอบปุ่มเชื่อมต่อเพจปัจจุบัน `components/select-page/ConnectFacebookButton.tsx` พร้อมตรวจ scopes และ callback
