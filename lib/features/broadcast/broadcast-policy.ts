/** Conservative policy: only evidenced, signed inbound messages open the standard window.
 * Other entry points and every outside-window route stay unavailable until independently verified.
 */
import {withinStandardMessageWindow,STANDARD_MESSAGE_WINDOW_MS} from '@/lib/features/inbox/standard-message-window'
export const BROADCAST_POLICY_VERSION = 'standard-inbound-24h-v1'
export const STANDARD_WINDOW_MS = STANDARD_MESSAGE_WINDOW_MS
export type BroadcastReason = 'eligible' | 'opted_out' | 'consent_unknown' | 'paused' | 'missing_interaction' | 'invalid_interaction' | 'outside_window' | 'page_unverified' | 'policy_unverified' | 'credits_exhausted' | 'unsupported_channel' | 'human_agent_forbidden' | 'already_processed'
export const broadcastReasonLabels: Record<BroadcastReason, string> = {
  eligible: 'ส่งได้ในรอบนี้', opted_out: 'ลูกค้ายกเลิกรับข้อความ', consent_unknown: 'ยังตรวจสอบการรับข้อความของลูกค้าไม่ได้', paused: 'แชทนี้พักการส่งข้อความอยู่',
  missing_interaction: 'ไม่มีลูกค้าที่เข้าเงื่อนไขในช่วงเวลานี้', invalid_interaction: 'ยังตรวจสอบเวลาที่ลูกค้าทักมาไม่ได้', outside_window: 'ลูกค้าไม่ได้ทักแชทใน 24 ชั่วโมงล่าสุด',
  page_unverified: 'กรุณาตรวจสอบการเชื่อมต่อเพจก่อนส่ง', policy_unverified: 'เซิร์ฟเวอร์ยังไม่เปิดส่งบรอดแคสต์', credits_exhausted: 'เครดิตข้อความไม่พอ',
  unsupported_channel: 'รายการนี้ยังส่งไม่ได้ กรุณาสร้างรายการใหม่', human_agent_forbidden: 'รายการนี้ต้องให้แอดมินดูแลในหน้าแชท',
  already_processed: 'ดำเนินการกับลูกค้าคนนี้แล้ว จะไม่ส่งซ้ำ',
}
export type BroadcastEvidence = { interacted_at: string; kind: string; page_id: string; event_id: string }
export function standardWindowReason(evidence: BroadcastEvidence | null | undefined, pageId: string | null, now = Date.now()): BroadcastReason {
  if (!evidence) return 'missing_interaction'
  const at = Date.parse(evidence.interacted_at)
  if (evidence.kind !== 'inbound_message' || evidence.page_id !== pageId || !evidence.event_id || !Number.isFinite(at) || at > now) return 'invalid_interaction'
  return withinStandardMessageWindow(evidence.interacted_at,now) ? 'eligible' : 'outside_window'
}
export function recipientReason(input: { evidence?: BroadcastEvidence | null; pageId: string | null; optedOut?: boolean | null; pageVerified: boolean; policyVerified: boolean; credits: number; channel?: string; tag?: string | null }, now = Date.now()): BroadcastReason {
  if (input.tag === 'HUMAN_AGENT') return 'human_agent_forbidden'
  if (input.channel && input.channel !== 'within_24h' || input.tag) return 'unsupported_channel'
  if (input.optedOut === true) return 'opted_out'
  if (input.optedOut !== false) return 'consent_unknown'
  // Inbox handoff/pause/closed states control automatic replies, not an owner's broadcast.
  // Consent and signed inbound evidence remain mandatory, independent of the bot switch.
  const window = standardWindowReason(input.evidence, input.pageId, now)
  if (window !== 'eligible') return window
  if (!input.pageVerified) return 'page_unverified'
  if (!input.policyVerified) return 'policy_unverified'
  if (input.credits < 1) return 'credits_exhausted'
  return 'eligible'
}
export const broadcastUiEnabled = () => process.env.BROADCAST_UI_ENABLED !== 'false'
export function broadcastReadiness(_now = Date.now()) {
  if(process.env.BROADCAST_STANDARD_SEND_ENABLED!=='true')return {ready:false,reason:'sending_disabled',message:'เซิร์ฟเวอร์ยังไม่เปิดส่งบรอดแคสต์ กรุณาตั้งค่า BROADCAST_STANDARD_SEND_ENABLED=true'}
  return {ready:true,reason:'ready',message:'พร้อมตรวจสิทธิ์เพจและผู้รับที่ทักภายใน 24 ชั่วโมง'}
}
export const broadcastPolicyVerified = (now = Date.now()) => broadcastReadiness(now).ready

/** Derive evidence only from a signed Page webhook's non-echo message, never receipt time. */
export function inboundBroadcastEvidence(event: { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: { mid?: string; is_echo?: boolean; text?: string; attachments?: unknown[] } }, pageId: string, now = Date.now()): BroadcastEvidence | null {
  const message = event.message, at = event.timestamp
  if (!message || message.is_echo || !message.mid || message.mid.length > 1000 || !event.sender?.id || event.sender.id === pageId || event.recipient?.id !== pageId) return null
  if (!message.text && !message.attachments?.length) return null
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at > now) return null
  return { interacted_at: new Date(at).toISOString(), kind: 'inbound_message', page_id: pageId, event_id: message.mid }
}
