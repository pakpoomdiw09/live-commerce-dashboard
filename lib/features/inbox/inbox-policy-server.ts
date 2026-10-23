import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { messengerWindow } from '@/lib/features/inbox/inbox-v2'
import type { MessagingType } from '@/lib/integrations/facebook/client'
import { getPageTokenStatus } from '@/lib/integrations/facebook/client'
import { InboxError } from '@/lib/features/inbox/inbox-server'
/** Use signed inbound webhook evidence, never delivery receipts or an admin reply. */
export async function inboxInboundEvidence(
  db: SupabaseClient,
  tenantId: string,
  customerId: string,
  pageId: string,
) {
  const result = await db
    .from('broadcast_messaging_events')
    .select('interacted_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('page_id', pageId)
    .eq('kind', 'inbound_message')
    .order('interacted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data?.interacted_at ?? null
}
export function humanAgentApproved() {
  return process.env.FB_HUMAN_AGENT_APPROVED === 'true'
}

export async function assertInboxPolicy(
  db: SupabaseClient,
  tenantId: string,
  customerId: string,
  pageId: string,
  token: string,
  humanAgent = false,
): Promise<MessagingType> {
  const timestamp = await inboxInboundEvidence(db, tenantId, customerId, pageId)
  const window = messengerWindow(timestamp)
  if (!window.allowed && (!humanAgent || !window.humanAllowed))
    throw new InboxError('หมดเวลาตอบกลับ รอลูกค้าส่งข้อความมาใหม่', 409, 'MESSAGING_WINDOW_CLOSED')
  if (!window.allowed && !humanAgentApproved())
    throw new InboxError(
      'แอปยังไม่ได้เปิดสิทธิ์ให้แอดมินตอบภายใน 7 วัน กรุณาติดต่อผู้ดูแลระบบ',
      409,
      'HUMAN_AGENT_UNAVAILABLE',
    )
  if ((await getPageTokenStatus(token, pageId)) !== 'verified')
    throw new InboxError(
      'ยังยืนยันสิทธิ์ส่งข้อความของเพจไม่ได้ ให้เจ้าของร้านตรวจการเชื่อมต่อเพจ',
      409,
      'PAGE_NOT_READY',
    )
  return window.allowed ? 'RESPONSE' : { tag: 'HUMAN_AGENT' }
}
