export type AgentOverviewJob = { id: string; customer_id: string; route: string | null; status: string; created_at: string; updated_at: string }
export type AgentOverviewRange = 7 | 30 | 90
export const CAPABILITY_KEYS = ['answers', 'products', 'slips', 'handoff', 'intent', 'followup'] as const
export type AgentCapability = typeof CAPABILITY_KEYS[number]
export type AgentCapabilitySettings = Record<AgentCapability, boolean>
export type CapabilityEntitlement = { allowed: boolean; code: 'FEATURE_LOCKED' | 'AI_QUOTA_EXHAUSTED' | 'SLIP_QUOTA_EXHAUSTED' | null; message: string }
export function agentCapabilityEntitlements(access: { ai: boolean; slips: boolean; followup: boolean }, aiRemaining: number, slipRemaining: number): Record<AgentCapability, CapabilityEntitlement> {
  return Object.fromEntries(CAPABILITY_KEYS.map(key => {
    const supported = access.ai && (key !== 'slips' || access.slips) && (key !== 'followup' || access.followup)
    const entitlement: CapabilityEntitlement = !supported ? { allowed: false, code: 'FEATURE_LOCKED', message: 'กรุณาชำระแพ็กเกจ Starter หรือ Pro ที่รองรับความสามารถนี้ หรืออายุแพ็กเกจอาจสิ้นสุดแล้ว' }
      : aiRemaining <= 0 ? { allowed: false, code: 'AI_QUOTA_EXHAUSTED', message: 'โควตาผู้ช่วย AI หมดหรือยังไม่ได้กำหนด กรุณาตรวจสอบแพ็กเกจและเพิ่มโควตาก่อนเปิดใช้งาน' }
      : key === 'slips' && slipRemaining <= 0 ? { allowed: false, code: 'SLIP_QUOTA_EXHAUSTED', message: 'เครดิตตรวจสลิปหมด กรุณาเติมเครดิตก่อนเปิดใช้งาน' }
      : { allowed: true, code: null, message: '' }
    return [key, entitlement]
  })) as Record<AgentCapability, CapabilityEntitlement>
}

export function summarizeAgentJobs(jobs: AgentOverviewJob[], days: AgentOverviewRange, now = new Date()) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const end = now.getTime(), start = Date.parse(`${today}T00:00:00+07:00`) - (days - 1) * 86400000
  const valid = jobs.filter(job => Number.isFinite(Date.parse(job.created_at)) && Date.parse(job.created_at) <= end)
  const current = valid.filter(job => Date.parse(job.created_at) >= start)
  const sent = valid.filter(job => job.route === 'AI' && job.status === 'sent')
  const successful = current.filter(job => job.route === 'AI' && job.status === 'sent')
  const finished = current.filter(job => job.route === 'AI' && ['sent', 'failed', 'review'].includes(job.status))
  const elapsed = successful.map(job => Date.parse(job.updated_at) - Date.parse(job.created_at)).filter(ms => Number.isFinite(ms) && ms >= 0)
  const daily = new Map<string, { messages: number; customers: Set<string> }>()
  for (const job of successful) {
    const day = new Date(job.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
    const row = daily.get(day) ?? { messages: 0, customers: new Set<string>() }
    row.messages++; row.customers.add(job.customer_id); daily.set(day, row)
  }
  const points = Array.from({ length: days }, (_, index) => {
    const day = new Date(start + index * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
    const row = daily.get(day)
    return { day, messages: row?.messages ?? 0, customers: row?.customers.size ?? 0 }
  })
  return {
    repliesToday: daily.get(today)?.messages ?? 0,
    customersTotal: new Set(sent.map(job => job.customer_id)).size,
    handoffs: current.filter(job => job.route === 'ADMIN').length,
    averageSeconds: elapsed.length ? elapsed.reduce((a, b) => a + b, 0) / elapsed.length / 1000 : null,
    successRate: finished.length ? successful.length / finished.length * 100 : null,
    points,
  }
}

export type AgentOverviewData = ReturnType<typeof summarizeAgentJobs> & {
  updatedAt: string; canManage: boolean; masterEnabled: boolean; ready: boolean; readiness: string[];
  page: { name: string | null; configured: boolean };
  capabilities: AgentCapabilitySettings; available: AgentCapabilitySettings;
  entitlements: Record<AgentCapability, CapabilityEntitlement>;
  quota: { plan: string; used: number; limit: number; remaining: number; month: string };
  recent: (AgentOverviewJob & { customer: string | null })[];
  notices: string[];
}
