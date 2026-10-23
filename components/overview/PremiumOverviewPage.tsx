import { getActor, requireDashboardUser } from '@/lib/auth'
import { getActiveTenant, getTenants } from '@/lib/tenant'
import { SetupNotice } from '@/components/shared/SetupNotice'
import { loadPremiumOverview } from '@/lib/features/overview/premium-overview-server'
import { PremiumOverview } from '@/components/overview/PremiumOverview'
import { InlineError } from '@/components/shared/ErrorState'
import Link from 'next/link'
import { BasicOverviewPage } from '@/components/overview/BasicOverviewPage'
export async function PremiumOverviewPage({
  filters,
}: {
  filters: { range?: string; page?: string; q?: string }
}) {
  const user = await requireDashboardUser()
  const { error: tenantError } = await getTenants()
  if (tenantError)
    return (
      <div className="p-6">
        <InlineError title="โหลดข้อมูลร้านค้าไม่ได้" message={tenantError} />
      </div>
    )
  const tenant = await getActiveTenant()
  if (!tenant) return <SetupNotice kind="no-tenant" />
  try {
    const metadataImage = user.user_metadata?.avatar_url ?? user.user_metadata?.picture
    const profileImageUrl =
      typeof metadataImage === 'string' && metadataImage.startsWith('https://')
        ? metadataImage
        : null
    const [data, shops] = await Promise.all([
      loadPremiumOverview(await getActor(), tenant.id, filters, {
        autoVerifyEnabled: tenant.auto_verify_enabled,
        bankConfigured: !!tenant.bank_code && !!tenant.account_name,
        pageConfigured: !!tenant.page_id && tenant.page_token_set,
      }),
      getTenants(),
    ])
    return (
      <PremiumOverview
        key={`${tenant.id}:${data.filters.range}:${data.filters.page}:${data.filters.q}`}
        data={data}
        shopCount={shops.tenants.length}
        userName={user.email ?? 'สมาชิก SnapBot'}
        profileImageUrl={profileImageUrl}
      />
    )
  } catch (error) {
    return (
      <>
        <div className="space-y-4 p-6">
          <InlineError
            title="ภาพรวมขั้นสูงไม่พร้อมใช้งาน กำลังแสดงข้อมูลสรุปพื้นฐาน"
            message={error instanceof Error ? error.message : 'กรุณาลองใหม่'}
          />
          <Link href="/overview?view=basic" className="text-orange-700 underline">
            เปิดภาพรวมพื้นฐาน
          </Link>
        </div>
        <BasicOverviewPage />
      </>
    )
  }
}
