# ผลตรวจ Live Auction จากฐานจริง วันที่ 3 พฤศจิกายน 2026

ตรวจแบบอ่านอย่างเดียวผ่าน `.env.local` ของ workspace: project
`ibswqmdybgdsnxyscwjc` และเพจ `122099866472012045` ไม่แก้ข้อมูล ไม่ claim คิว
และไม่ส่งข้อความไปยังลูกค้า ผลนี้เป็น snapshot ไม่ใช่สถานะติดตามสด

## ข้อเท็จจริงที่พบ

- Event ล่าสุดเวลา 20:17:45 น. ประเทศไทย เป็น `kind=change`, `page_id=0`,
  `field=website` ไม่มี `message/from/comment_id` ของคอมเมนต์
- ทั้งฐานมี change event 3 รายการ: website, messages และ feed/item=status
  ทั้งหมดมาจาก Page ID ทดสอบ `0` ไม่มี change event คอมเมนต์ของเพจจริง
- Event ของเพจจริงที่พบเป็น Messenger (`kind=message`) ไม่ใช่คอมเมนต์ไลฟ์
- `unfinished_events=[]` ทุก event ที่พบ completed, attempts=1, last_error=null
- `auction_bids` และ `auction_deliveries` ว่าง ไม่มีบิดหรือข้อความค้างให้ retry
- มี auctions active 3 รอบ ตรงกับ session ผ่าน tenant_id/page_id/live_post_id:
  `1`, `1591672446066517`, `2298945940961450` ราคาปัจจุบันทั้งหมดเป็น 0
  Sessions มี ended_at=null; schema นี้ไม่มี live_sessions.status
- รอบล่าสุดเปิดเวลา 20:38:35 น. หลัง event ล่าสุดที่ฐานนี้ได้รับ
- Meta ยืนยัน Page token valid และตรงเพจ แต่ไม่มี `pages_read_user_content`
  และ `pages_manage_engagement` ใน scopes ที่ได้รับจริง
- App callback ชี้ไป `https://live-commerce-dashboard-faxh.vercel.app/api/webhooks/facebook`
  และเพจ subscribe แอปนี้ที่ feed/messages/live_videos แล้ว
- Graph lookup ของทั้ง 3 live IDs ตอบ code=100/subcode=33; อาจเป็น object/ID
  ไม่ตรงหรือสิทธิ์ไม่พอ ยังสรุปว่าไลฟ์ถูกลบไม่ได้ `/live_videos` ตอบรายการว่าง
- อ่าน PostgREST OpenAPI พบ RPC claim/heartbeat/finish, process_live_auction_comment,
  configure_auction_session, confirm_live_auction_winner, live_auction_thai_dashboard
  และมีคอลัมน์ confirmation แล้ว Registry ที่ไม่มีชื่อ migration ไม่ได้พิสูจน์ว่า
  migration ขาด เพราะอาจติดตั้ง SQL แยกไฟล์มาก่อน

## ขั้นตอนแก้ที่ตรงกับข้อมูล

พบข้อผิดพลาดใน source ของ enqueue: webhook-envelope.ts สร้าง ordering key
`comments:<page_id>` แต่ facebook-webhook-queue.sql เดิมยอมรับแค่ตัวเลข
ทำให้คอมเมนต์จริงถูกปฏิเสธด้วย SQLSTATE 22023 และ transaction rollback
Messenger/test events บางชนิดจึงเข้าได้ ขณะที่ไม่มี receipt ของคอมเมนต์ที่ถูกปฏิเสธ
การไม่มีแถวจึงยังพิสูจน์ไม่ได้ว่า Meta ไม่เคยส่ง HTTP request มาเลย

ให้รัน `supabase/facebook-webhook-comment-ordering.sql` ใน Supabase SQL Editor
เพื่อแทนเฉพาะ enqueue ด้วยรุ่นที่รองรับ Page-wide comment key และคงสิทธิ์ service_role
ไฟล์นี้ไม่ claim/replay event, ไม่สร้างบิด และไม่ส่งข้อความ รวมไว้ใน generated schema แล้ว
ยังไม่ได้ apply patch ลงฐานจริง การอ่าน OpenAPI เห็นว่ามี RPC แต่ดู definition ภายในไม่ได้

ตรวจ definition ฐานจริงแบบอ่านอย่างเดียวได้ด้วย:

```sql
select pg_get_functiondef('public.enqueue_facebook_webhook(text,text,jsonb)'::regprocedure);
```

หลังรัน migration ให้ตรวจ Vercel Logs ของ ingress: ไม่ควรมี QUEUE_INSERT_FAILED/22023
จากคอมเมนต์ที่มีฟิลด์ครบ แล้วแก้ permissions/live scope ตามขั้นตอนต่อไปด้วย

1. เปิด Meta App ที่รับ callback นี้ ตรวจ permissions และ Facebook Login for Business
   configuration ให้ขอ pages_read_user_content/pages_manage_engagement ร่วมกับ
   pages_show_list/pages_read_engagement/pages_manage_metadata/pages_messaging
   โค้ด `lib/integrations/facebook/oauth.ts` ขอ permissions เหล่านี้อยู่แล้ว แต่ token
   ปัจจุบันยังไม่ได้รับครบ ถ้ามี FB_LOGIN_CONFIG_ID สิทธิ์มาจาก configuration ของ Meta
2. เชื่อมต่อ Facebook ใหม่เพื่อรับ token ที่ได้รับอนุญาตจริง การเพิ่มชื่อ scope ในโค้ด
   หรือ UPDATE ฐานข้อมูลไม่สามารถให้สิทธิ์แก่ token เดิม ตรวจ App Mode/ระดับการอนุมัติ
   สำหรับบัญชีที่จะใช้ทดสอบด้วย ข้อมูลปัจจุบันยังยืนยันไม่ได้ว่าแอปอยู่ Development Mode
3. ตรวจว่ากำลังใช้ไลฟ์ของเพจนี้และ live/video ID ที่เข้าถึงได้จริง อย่าใช้ `1` เป็น
   placeholder ของไลฟ์จริง เลือก/เปิดรอบผ่าน UI เพื่อให้ tenant และธนาคารถูก scope
4. เปิดรอบก่อน ให้บัญชีลูกค้าที่ไม่ใช่ Page/host พิมพ์ keyword ของรอบหรือราคา
   ตรวจว่ามี event ของเพจจริง field=feed/live_comments, item=comment,
   verb=add และ message/from.id/comment_id/post_id หรือ video_id
5. หลังบิดเข้าแล้ว เพจ/host ปิดรอบ แล้วให้ผู้ชนะพิมพ์คีย์เวิร์ดอีกครั้ง
   ระหว่าง bidding workflow นี้ตั้งใจไม่ส่งข้อความ; Public/Private ส่งหลังผู้ชนะยืนยัน
6. External cron เรียก `/api/cron/facebook-webhooks` ทุกนาทีพร้อม Bearer CRON_SECRET
   ตาม `facebook-webhook-cron-setup.md` แต่ cron สร้าง comment event ที่ Meta ไม่ได้ส่งมาไม่ได้

ไม่ควร reset completed events, เปลี่ยน Page ID ทดสอบเป็นเพจจริง หรือ INSERT บิดเทียม
ฐานนี้ไม่มีคิวค้างที่ต้องใช้ UPDATE กู้คืน และไม่มี SQL ใดเพิ่ม OAuth permissions ได้

## ตรวจซ้ำโดยไม่ส่งข้อความ

```powershell
node scripts/diagnose-facebook-webhook.cjs --page-id 122099866472012045 --meta
```

หากข้อมูลบน Supabase UI ใหม่กว่าที่รายงานนี้ ให้ตรวจ project host ให้ตรงกับ
`.env.local` และ environment ของ deployment ที่รับ callback

SQL ต่อไปนี้อ่านอย่างเดียว ใช้ใน Supabase SQL Editor:

```sql
-- แยก event ทดสอบ, Messenger และคอมเมนต์
select page_id, kind, status, payload->>'field' as field,
       payload->'value'->>'item' as item,
       payload->'value'->>'verb' as verb, count(*)
from public.facebook_webhook_events
group by 1,2,3,4,5,6 order by 1,2,3;

-- คอมเมนต์ที่เข้า worker พร้อม payload receipt ต้นทาง
select e.id, e.created_at, e.page_id, e.status, e.attempts, e.last_error,
       e.payload->>'field' as field,
       e.payload->'value'->>'comment_id' as comment_id,
       e.payload->'value'->'from'->>'id' as author_id,
       e.payload->'value'->>'post_id' as post_id,
       e.payload->'value'->>'message' as message,
       p.id as receipt_id, p.received_at
from public.facebook_webhook_events e
join public.facebook_webhook_payloads p on p.id=e.payload_id
order by e.sequence desc limit 30;

-- ความสัมพันธ์รอบกับ session เป็น composite key ไม่ใช่ auctions.session_id
select a.id as auction_id,a.status,a.current_price,a.live_post_id,
       s.id as session_id,s.ended_at,
       t.id as tenant_id,t.is_active
from public.auctions a
left join public.live_sessions s on s.tenant_id=a.tenant_id
 and s.page_id=a.page_id and s.live_post_id=a.live_post_id
left join public.tenants t on t.id=a.tenant_id and t.page_id=a.page_id
order by a.created_at desc limit 20;

select id,page_id,status,attempts,last_error,available_at,lease_until
from public.facebook_webhook_events where status<>'completed'
order by sequence limit 30;
```

## เส้นทางโค้ดที่ตรวจ

- webhook-envelope.ts: normalize feed/live_comments ก่อน enqueue; ไม่แปลง post/status
  เป็น comment เพื่อป้องกันสร้างบิดจาก event ผิดชนิด
- webhook-handler.ts: รับเฉพาะคอมเมนต์เพิ่มใหม่ และ resolve tenant จาก Page ID
- webhook-worker.ts: claim → heartbeat → handler → finish; มี retry/lease/checkpoint
- auction-server.ts: match tenant/Page/live → parser → process_live_auction_comment RPC
  SQL เป็นผู้ insert auction_bids ไม่ใช่ worker insert โดยตรง
- client.ts: public POST comment_id/comments; private recipient.comment_id และ Page token
  ยังไม่มีการส่งจริงในฐานนี้เพราะไม่มีบิด/ผู้ชนะ/outbox

เพิ่ม log `[auction/comment] skipped` สำหรับ COMMENT_FIELDS_MISSING,
COMMENT_POST_ID_MISSING, AUCTION_SCHEMA_MISSING, NO_MATCHING_AUCTION,
NO_MATCHING_AUCTION_KEYWORD เพื่อวินิจฉัยรอบถัดไปโดยไม่พิมพ์ token/ข้อความลูกค้า
