import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export function isMissingSlipSettings(error: { code?: string } | null) {
  return ['42P01', 'PGRST205'].includes(error?.code ?? '')
}

export async function readSlipConfirmationTemplate(db: SupabaseClient, tenantId: string) {
  const result = await db
    .from('slip_settings')
    .select('slip_confirmation_template')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (result.error) throw result.error
  return (result.data?.slip_confirmation_template as string | null | undefined) ?? null
}

/** Resolve scope from the persisted customer, never from a PSID or a client-supplied tenant. */
export async function customerSlipConfirmationTemplate(db: SupabaseClient, customerId: string) {
  const scope = await db.from('customers').select('tenant_id').eq('id', customerId).maybeSingle()
  if (scope.error || !scope.data?.tenant_id) throw new Error('SLIP_CONFIRMATION_TENANT_UNAVAILABLE')
  try {
    return await readSlipConfirmationTemplate(db, scope.data.tenant_id)
  } catch (error) {
    // Rolling deployment: existing confirmations must continue until the new table is installed.
    if (isMissingSlipSettings(error as { code?: string })) {
      console.warn('[slip/confirmation] settings migration missing; using default template')
      return null
    }
    throw new Error('SLIP_CONFIRMATION_TEMPLATE_LOOKUP_FAILED')
  }
}
