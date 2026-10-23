import { TenantSettingsForm } from '@/components/settings/TenantSettingsForm'
import type { Billing } from '@/lib/features/billing/plans'
import type { TenantRole, TenantRow } from '@/lib/types'
export function SlipSettingsTab({
  tenant,
  billing,
  role,
}: {
  tenant: TenantRow
  billing: Billing
  role: TenantRole
}) {
  return (
    <div className="rounded-3xl border border-orange-100 bg-orange-50/20 p-3 md:p-6">
      <TenantSettingsForm
        key={tenant.id}
        embedded
        section="bank-slip"
        tenant={tenant}
        billing={billing}
        slipCredits={{
          quota: tenant.slip_quota + tenant.slip_quota_credits,
          used: tenant.slip_used,
        }}
        pages={[]}
        isFirst={false}
        role={role}
      />
    </div>
  )
}
