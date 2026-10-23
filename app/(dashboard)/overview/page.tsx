import { requireDashboardUser } from '@/lib/auth'
import { premiumOverviewEnabled } from '@/lib/features/overview/premium-overview-core'
import { PremiumOverviewPage } from '@/components/overview/PremiumOverviewPage'
import { BasicOverviewPage } from '@/components/overview/BasicOverviewPage'

export const metadata = { title: 'แดชบอร์ดสรุปยอด' }

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; page?: string; q?: string; view?: string }>
}) {
  await requireDashboardUser()
  const filters = await searchParams
  return premiumOverviewEnabled() && filters.view !== 'basic' ? (
    <PremiumOverviewPage filters={filters} />
  ) : (
    <BasicOverviewPage />
  )
}
