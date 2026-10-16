import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant, getViewer } from '@/lib/tenant'
import { roleAtLeast } from '@/lib/auth'
import { getBilling } from '@/lib/billing'
import { BILLING_REQUEST_COLUMNS, type BillingRequestRow } from '@/lib/plans'
import { BillingClient } from '@/components/billing/BillingClient'
import { LiveRefresh } from '@/components/LiveRefresh'
import { SetupNotice } from '@/components/SetupNotice'

export const metadata = { title: 'แพ็กเกจและการเติมเงิน' }

export default async function BillingPage() {
  const [db, tenant, viewer] = await Promise.all([supabaseServer(), getActiveTenant(), getViewer()])
  if (!tenant) return <SetupNotice kind="no-tenant" />

  let billing
  try {
    billing = await getBilling(supabaseAdmin(), tenant.id, viewer.isPlatformAdmin)
  } catch (e) {
    return <SetupNotice kind="migration" message={`${e instanceof Error ? e.message : e} (รัน supabase/billing-slip-topups.sql แล้วรัน admin-feature-bypass.sql อีกครั้ง)`} />
  }
  const requests = await db.from('billing_requests').select(`${BILLING_REQUEST_COLUMNS}, proof_path, verification_status, verification_error`).eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(20)
  if (requests.error) return <SetupNotice kind="migration" message={requests.error.message} />

  return (
    <>
      <LiveRefresh channel="billing" tables={['billing_requests']} />
      <BillingClient
        tenantId={tenant.id}
        billing={billing}
        canBuy={roleAtLeast(viewer.role, 'owner')}
        paymentInfo={process.env.BILLING_PAYMENT_INFO?.trim() || null}
        requests={(requests.data ?? []) as BillingRequestRow[]}
      />
    </>
  )
}
