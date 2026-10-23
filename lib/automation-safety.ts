import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Enable only after automation-safety.sql is installed. No cache: every boundary rechecks. */
export const automationSafetyEnabled = () => process.env.SNAPBOT_SAFETY_ENABLED === 'true'

export async function automationStopped(db: SupabaseClient, tenantId: string): Promise<boolean> {
  if (process.env.AGENT_CONTROL_KILL_SWITCH === 'true') return true
  if (!automationSafetyEnabled()) return false
  const result = await db
    .from('tenant_automation_controls')
    .select('stopped')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  // A missing table, denied query or transport failure must never grant permission to send.
  if (result.error) throw new Error('AUTOMATION_SAFETY_UNAVAILABLE')
  return result.data?.stopped === true
}

export class AutomationStoppedError extends Error {
  readonly code = 'AUTOMATION_STOPPED'
  constructor() {
    super('ระบบตอบอัตโนมัติถูกหยุดฉุกเฉิน')
  }
}
export async function assertAutomationRunning(db: SupabaseClient, tenantId: string) {
  if (await automationStopped(db, tenantId)) throw new AutomationStoppedError()
}
