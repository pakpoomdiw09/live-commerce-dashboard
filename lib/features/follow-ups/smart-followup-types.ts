export type WorkflowKind = 'payment' | 'interested' | 'after_sales'
export type SmartJobStatus =
  'pending' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'skipped' | 'requires_review'
export type WorkflowStep = { delay_minutes: number; text: string }
export type FollowUpWorkflow = {
  id: string
  tenant_id: string
  kind: WorkflowKind
  enabled: boolean
  use_ai: boolean
  stop_on_reply: boolean
  version: number
  steps: WorkflowStep[]
}
export type CommunicationPolicy = {
  tenant_id: string
  enabled: boolean
  timezone: string
  quiet_enabled: boolean
  quiet_start: number
  quiet_end: number
  max_per_customer: number
  max_per_order: number
}
export type SmartJob = {
  id: string
  tenant_id: string
  customer_id: string
  order_id: string | null
  kind: WorkflowKind
  step: number
  text: string
  run_at: string
  status: SmartJobStatus
  reason: string | null
  sent_at: string | null
  responded_at: string | null
  attempts: number
  dispatch_started_at: string | null
  created_at: string
  customers: {
    display_name: string | null
    platform_user_id: string
    assigned_user_id: string | null
    followup_opted_out: boolean
  } | null
  orders: { product_name: string; amount: number; status: string } | null
}
export type ExecutionLog = {
  id: string
  job_id: string
  status: string
  reason: string | null
  created_at: string
}
export type FollowUpBilling = {
  plan: 'free' | 'starter' | 'pro'
  planExpiresAt: string | null
  monthly: number
  allowance: number
  topup: number
  slipRemaining: number
}
export type SmartDashboard = {
  policy: CommunicationPolicy
  workflows: FollowUpWorkflow[]
  jobs: SmartJob[]
  logs: ExecutionLog[]
  overview: Record<string, number>
  billing: FollowUpBilling
  aiAllowed: boolean
  sendEnabled: boolean
  hasMore: boolean
}
export const WORKFLOW_LABELS: Record<WorkflowKind, string> = {
  payment: 'ติดตามค้างชำระ',
  interested: 'ติดตามลูกค้าสนใจสินค้า',
  after_sales: 'ติดตามหลังการขาย',
}
export const DEFAULT_STEPS: Record<WorkflowKind, WorkflowStep[]> = {
  payment: [
    {
      delay_minutes: 30,
      text: 'คุณ {ชื่อลูกค้า} ออเดอร์ {สินค้า} ยอด {ยอดเงิน} บาทยังรอการชำระนะคะ หากโอนแล้วส่งสลิปในแชทได้เลยค่ะ',
    },
    {
      delay_minutes: 180,
      text: 'สอบถามอีกครั้งค่ะ คุณ {ชื่อลูกค้า} ยังต้องการออเดอร์ {สินค้า} อยู่ไหมคะ หากต้องการความช่วยเหลือแจ้งได้เลยค่ะ',
    },
  ],
  interested: [
    {
      delay_minutes: 60,
      text: 'คุณ {ชื่อลูกค้า} ต้องการข้อมูลเพิ่มเติมเกี่ยวกับ {สินค้า} ไหมคะ แอดมินยินดีช่วยค่ะ',
    },
  ],
  after_sales: [
    {
      delay_minutes: 60,
      text: 'คุณ {ชื่อลูกค้า} ได้รับสินค้า {สินค้า} เรียบร้อยไหมคะ หากมีปัญหาแจ้งแอดมินได้เลยค่ะ',
    },
  ],
}
export const DEFAULT_POLICY = {
  enabled: false,
  timezone: 'Asia/Bangkok',
  quiet_enabled: false,
  quiet_start: 1320,
  quiet_end: 480,
  max_per_customer: 3,
  max_per_order: 3,
}
export const PRECHECK_LABELS: Record<string, string> = {
  precheck_passed: 'ตรวจเงื่อนไขผ่าน',
  precheck_blocked: 'ระงับก่อนส่ง',
  unpaid_confirmed: 'ยังไม่ชำระและไม่พบสลิปใหม่',
  eligibility_confirmed: 'ผ่านเงื่อนไขการติดตาม',
  not_due: 'ยังไม่ถึงเวลาติดตาม',
  send_disabled: 'พักการส่งจริงไว้',
  precheck_failed: 'ตรวจสถานะล่าสุดไม่ได้ จึงไม่ส่ง',
  claim_expired: 'หมดเวลาประมวลผล กรุณาตรวจสอบ',
  automation_stopped: 'ระบบหยุดฉุกเฉิน',
}
export const JOB_LABELS: Record<string, string> = {
  pending: 'รอติดตาม',
  processing: 'กำลังประมวลผล',
  sent: 'ส่งสำเร็จ',
  failed: 'ส่งไม่สำเร็จ',
  cancelled: 'หยุดอัตโนมัติ',
  skipped: 'ข้ามแล้ว',
  requires_review: 'รอแอดมิน',
}
export const REASON_LABELS: Record<string, string> = {
  prepare_failed: 'ตรวจเงื่อนไขก่อนส่งไม่สำเร็จ กรุณาตรวจสอบฐานข้อมูล',
  precheck_failed: 'ตรวจสถานะล่าสุดไม่ได้ จึงไม่ส่ง',
  result_persistence_failed: 'ได้รับผลส่งแล้ว แต่ยังยืนยันการบันทึกสถานะไม่ได้',
  delivery_error: 'รายละเอียดข้อผิดพลาดในการส่ง',
  paid: 'ชำระแล้ว',
  order_cancelled: 'ยกเลิกออเดอร์',
  opt_out: 'ลูกค้าไม่รับข้อความ',
  handover: 'แอดมินรับช่วง',
  customer_replied: 'ลูกค้าตอบกลับ',
  plan_required: 'แพ็กเกจหมดอายุหรือไม่รองรับ',
  quota_exhausted: 'เครดิตข้อความหมด',
  window_closed: 'เกินเวลาที่ Messenger อนุญาต',
  disabled: 'ปิดระบบติดตาม',
  workflow_changed: 'Workflow เปลี่ยนแปลง',
  quiet_hours: 'พักในเวลาห้ามรบกวน',
  rate_limit: 'ครบจำนวนข้อความที่กำหนด',
  invalid_reference: 'ข้อมูลอ้างอิงไม่ถูกต้อง',
  slip_received: 'ได้รับสลิป รอตรวจสอบ',
  delivery_unknown: 'ยังยืนยันผลการส่งไม่ได้',
  worker_restarted: 'Worker หยุดก่อนทราบผล',
  ai_draft: 'รอตรวจทานข้อความ AI',
  api_rejected: 'Messenger ปฏิเสธ',
  manual: 'ผู้ดูแลยกเลิก',
  new_order: 'ลูกค้ามีออเดอร์แล้ว',
  complaint: 'พบข้อร้องเรียน',
  contact_suspended: 'ระงับการติดต่อ',
  no_token: 'ยังไม่มี Token เพจ',
  order_unconfirmed: 'ยังไม่ได้ยืนยันออเดอร์',
}
export function renderSmartFollowUp(
  text: string,
  values: { name: string; total: number; product: string },
) {
  return text.replace(/\{(name|ชื่อลูกค้า|total|ยอดเงิน|product|สินค้า)\}/g, (_, key: string) =>
    key === 'name' || key === 'ชื่อลูกค้า'
      ? values.name
      : key === 'product' || key === 'สินค้า'
        ? values.product
        : values.total.toLocaleString('th-TH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
  )
}
