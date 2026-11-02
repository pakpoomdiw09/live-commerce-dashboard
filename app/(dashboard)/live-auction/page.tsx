import { notFound } from 'next/navigation'
import { getActiveTenant, tenantPages } from '@/lib/tenant'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { LiveSessionDashboard } from '@/components/live-cf/LiveSessionDashboard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ไลฟ์สดการประมูลครบวงจร | SnapBot' }
export default async function LiveAuctionPage() {
  if (!isFeatureEnabled('live_cf')) notFound()
  const tenant = await getActiveTenant()
  if (!tenant) notFound()
  const [pages, banks] = await Promise.all([
    tenantPages(tenant),
    supabaseAdmin()
      .from('bank_accounts')
      .select('id,bank_code,account_number')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('is_primary', { ascending: false }),
  ])
  if (banks.error) throw new Error('โหลดบัญชีรับเงินไม่สำเร็จ')
  return (
    <div className="min-w-0 shrink-0 p-4 md:p-8">
      <LiveSessionDashboard
        key={tenant.id}
        tenantId={tenant.id}
        auction={{ pages, bankAccounts: banks.data ?? [], shopName: tenant.name }}
      />
    </div>
  )
}
