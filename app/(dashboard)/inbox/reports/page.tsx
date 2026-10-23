import { requireDashboardUser } from '@/lib/auth'
import { getActiveTenant } from '@/lib/tenant'
import { supabaseServer } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/feature-access'
import { FeatureLocked } from '@/components/shared/FeatureLocked'
import { SetupNotice } from '@/components/shared/SetupNotice'
import { InboxReports } from '@/components/inbox/InboxReports'
export const metadata = { title: 'ภาพรวมและรายงานทีมแชท' }
export default async function ReportsPage() {
  await requireDashboardUser()
  const tenant = await getActiveTenant()
  if (!tenant) return <SetupNotice kind="no-tenant" />
  if (!(await hasFeature(await supabaseServer(), tenant.id, 'customer_management')))
    return <FeatureLocked />
  return <InboxReports key={tenant.id} tenantId={tenant.id} />
}
