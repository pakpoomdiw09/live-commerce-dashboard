import 'server-only'
import type {SupabaseClient} from '@supabase/supabase-js'
import {inboxWindow} from './inbox-v2'
import {getPageTokenStatus} from './facebook'
import {InboxError} from './inbox-server'
/** Use signed inbound webhook evidence, never delivery receipts or an admin reply. */
export async function inboxInboundEvidence(db:SupabaseClient,tenantId:string,customerId:string,pageId:string) {
 const result=await db.from('broadcast_messaging_events').select('interacted_at').eq('tenant_id',tenantId).eq('customer_id',customerId).eq('page_id',pageId).eq('kind','inbound_message').order('interacted_at',{ascending:false}).limit(1).maybeSingle()
 if(result.error) throw result.error
 return result.data?.interacted_at??null
}
export async function assertInboxPolicy(db:SupabaseClient,tenantId:string,customerId:string,pageId:string,token:string) {
 const timestamp=await inboxInboundEvidence(db,tenantId,customerId,pageId)
 if(!inboxWindow(timestamp).allowed)throw new InboxError('รอลูกค้าทักมาใหม่ก่อนตอบกลับ',409,'MESSAGING_WINDOW_CLOSED')
 if(await getPageTokenStatus(token,pageId)!=='verified')throw new InboxError('ยังยืนยันสิทธิ์ส่งข้อความของเพจไม่ได้ ให้เจ้าของร้านตรวจการเชื่อมต่อเพจ',409,'PAGE_NOT_READY')
}
