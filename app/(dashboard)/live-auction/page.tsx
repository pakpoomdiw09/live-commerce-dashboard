import { notFound } from 'next/navigation'
import { getActiveTenant, tenantPages } from '@/lib/tenant'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { LiveSessionDashboard } from '@/components/live-cf/LiveSessionDashboard'
import { PageBanner } from '@/components/ui/page-banner'

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
    <div className="min-w-0 shrink-0 space-y-5 p-4 md:p-8">
      <PageBanner className="bg-gradient-to-r from-orange-500 to-amber-500">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <span aria-hidden="true">🔨</span>
          ระบบประมูลไลฟ์สดอัตโนมัติ (Live Auction Automation)
        </h1>
        <p className="mt-2 text-sm text-white/90">
          ตั้งค่ารอบและคำดัก ดูยอดลูกค้า ตรวจสลิป และจัดการการจัดส่งของแต่ละไลฟ์ได้ในหน้าเดียว
        </p>
      </PageBanner>
      <LiveSessionDashboard
        key={tenant.id}
        tenantId={tenant.id}
        auction={{ pages, bankAccounts: banks.data ?? [], shopName: tenant.name }}
      />
    </div>
  )
}
