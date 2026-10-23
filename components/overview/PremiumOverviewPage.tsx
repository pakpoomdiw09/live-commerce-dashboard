import { getActor, requireDashboardUser } from '@/lib/auth'
import { getActiveTenant, getTenants } from '@/lib/tenant'
import { SetupNotice } from '@/components/shared/SetupNotice'
import { loadPremiumOverview } from '@/lib/features/overview/premium-overview-server'
import {
  overviewFilters,
  type PremiumOverviewData,
} from '@/lib/features/overview/premium-overview-core'
import { PremiumOverview } from '@/components/overview/PremiumOverview'
import { InlineError } from '@/components/shared/ErrorState'
import { logOverviewError } from '@/lib/features/overview/overview-diagnostics'

/** Keep the Premium layout without reporting a failed read as real zero statistics. */
function unavailableOverview(
  shop: PremiumOverviewData['shop'],
  input: { range?: string; page?: string; q?: string },
): PremiumOverviewData {
  let filters
  try {
    filters = overviewFilters(input)
  } catch {
    filters = overviewFilters({})
  }
  return {
    shop,
    filters,
    updatedAt: filters.to,
    access: { slips: false, customers: false, ai: false },
    metrics: {
      reconciledRevenue: null,
      messages: null,
      incomingMessages: null,
      uniqueCustomers: null,
      approved: null,
      totalSlips: null,
      pending: null,
      slipCredits: null,
      verifiedSlipAmount: null,
    },
    previous: null,
    results: null,
    customerGenders: null,
    series: [],
    bucket: filters.from ? 'day' : 'month',
    activity: null,
    hourActivity: null,
    slips: [],
    slipMatches: 0,
    chats: [],
    chatMatches: 0,
    ai: null,
    health: [],
  }
}

export async function PremiumOverviewPage({
  filters,
}: {
  filters: { range?: string; page?: string; q?: string }
}) {
  const user = await requireDashboardUser()
  const shops = await getTenants()
  if (shops.error)
    return (
      <div className="p-6">
        <InlineError title="โหลดข้อมูลร้านค้าไม่ได้" message={shops.error} />
      </div>
    )
  const tenant = await getActiveTenant()
  if (!tenant) return <SetupNotice kind="no-tenant" />

  const metadataImage = user.user_metadata?.avatar_url ?? user.user_metadata?.picture
  const profileImageUrl =
    typeof metadataImage === 'string' && metadataImage.startsWith('https://') ? metadataImage : null
  let data: PremiumOverviewData
  let loadError = false
  try {
    data = await loadPremiumOverview(await getActor(), tenant.id, filters, {
      autoVerifyEnabled: tenant.auto_verify_enabled,
      bankConfigured: !!tenant.bank_code && !!tenant.account_name,
      pageConfigured: !!tenant.page_id && tenant.page_token_set,
    })
    if (
      !data?.shop ||
      !data.metrics ||
      !data.filters ||
      !data.access ||
      !Array.isArray(data.health) ||
      !Array.isArray(data.slips) ||
      !Array.isArray(data.chats) ||
      (data.activity !== null && !Array.isArray(data.activity)) ||
      (data.hourActivity !== null && !Array.isArray(data.hourActivity)) ||
      !['uniqueCustomers', 'incomingMessages', 'pending'].every((key) => {
        const value = data.metrics[key as keyof PremiumOverviewData['metrics']]
        return value === null || (typeof value === 'number' && Number.isFinite(value))
      })
    )
      throw new Error('INCOMPLETE_OVERVIEW')
  } catch (error) {
    logOverviewError('page.loadPremiumOverview', error, { tenantId: tenant.id })
    loadError = true
    data = unavailableOverview({ id: tenant.id, name: tenant.name }, filters)
  }

  const partialNotice = data.health.find(
    (item) => item.name === 'ฐานข้อมูลร้านค้า' && item.status === 'setup',
  )?.detail
  return (
    <>
      {loadError ? (
        <div
          role="alert"
          className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:mx-8"
        >
          โหลดข้อมูลภาพรวมไม่สำเร็จ สถิติที่แสดงเป็น — ยังไม่ใช่ยอดจริง
          กรุณากดอัปเดตข้อมูลเพื่อลองใหม่
        </div>
      ) : partialNotice ? (
        <p role="status" className="mx-4 mt-3 text-xs text-slate-500 md:mx-8">
          {partialNotice}
        </p>
      ) : (
        false
      )}
      <PremiumOverview
        key={`${tenant.id}:${data.filters.range}:${data.filters.page}:${data.filters.q}`}
        data={data}
        shopCount={shops.tenants.length}
        userName={user.email ?? 'สมาชิก SnapBot'}
        profileImageUrl={profileImageUrl}
      />
    </>
  )
}
