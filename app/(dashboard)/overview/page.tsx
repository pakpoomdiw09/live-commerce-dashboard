import { requireDashboardUser } from '@/lib/auth'
import { PremiumOverviewPage } from '@/components/overview/PremiumOverviewPage'

export const metadata = { title: 'แดชบอร์ดสรุปยอด' }
export const maxDuration = 60

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; page?: string; q?: string; view?: string }>
}) {
  await requireDashboardUser()
  const filters = await searchParams
  return <PremiumOverviewPage filters={filters} />
}
