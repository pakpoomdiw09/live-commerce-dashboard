import { supabaseAdmin } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/feature-access'
import { FeatureLocked } from '@/components/shared/FeatureLocked'
import { getActiveTenant, getViewer } from '@/lib/tenant'
import { getBilling } from '@/lib/features/billing/billing'
import { SetupNotice } from '@/components/shared/SetupNotice'
import { loadSlipHistory, type SlipHistoryRow } from '@/lib/features/slips/history'
import { SlipsDashboard } from '@/components/slips/SlipsDashboard'
import { InlineError } from '@/components/shared/ErrorState'
import { paymentProConfig, paymentProUiEnabled } from '@/lib/features/payments/payment-pro-flags'
import { requireDashboardUser } from '@/lib/auth'
import type { PaymentChannelTab } from '@/components/slips/PaymentChannelsGuide'

export const metadata = { title: 'ระบบตรวจสลิป' }

export default async function SlipsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  await requireDashboardUser()
  const [tenant, viewer] = await Promise.all([getActiveTenant(), getViewer()])
  if (!tenant) return <SetupNotice kind="no-tenant" />
  if (!viewer.role) return <FeatureLocked />
  const db = supabaseAdmin()
  if (!(await hasFeature(db, tenant.id, 'slip_auto_pilot'))) return <FeatureLocked />
  let billing
  try {
    billing = await getBilling(supabaseAdmin(), tenant.id, viewer.isPlatformAdmin)
  } catch (error) {
    return (
      <div className="p-6">
        <InlineError
          title="โหลดแพ็กเกจไม่ได้"
          message={error instanceof Error ? error.message : 'กรุณาลองอีกครั้ง'}
        />
      </div>
    )
  }
  let data: SlipHistoryRow[]
  try {
    data = await loadSlipHistory(db, tenant.id, tenant.page_id, 200)
  } catch (error) {
    return (
      <div className="p-6">
        <InlineError
          title="โหลดประวัติสลิปไม่ได้ (ถ้ายังไม่ได้อัปเดตฐานข้อมูล ให้รัน supabase/platform.sql)"
          message={error instanceof Error ? error.message : 'โหลดประวัติสลิปไม่สำเร็จ'}
        />
      </div>
    )
  }
  let proEnabled = false
  try {
    proEnabled =
      paymentProUiEnabled() &&
      (await paymentProConfig(supabaseAdmin(), tenant.id))?.advancedDashboard === true
  } catch {
    return (
      <div className="p-6">
        <InlineError
          title="Payment Pro ไม่พร้อมใช้งาน"
          message="ตรวจสอบ payment-pro.sql หรือปิด PAYMENT_PRO_ENABLED เพื่อกลับไปใช้ระบบเดิม"
        />
      </div>
    )
  }

  return (
    <SlipsDashboard
      key={`${tenant.id}:${tenant.page_id ?? ''}`}
      initial={data}
      billing={billing}
      role={viewer.role ?? 'staff'}
      activeTab={
        process.env.PAYMENT_CHANNELS_ENABLED === 'true'
          ? ['qr', 'banks', 'history', 'automation', 'security', 'advanced'].includes(tab ?? '')
            ? (tab as PaymentChannelTab)
            : tab === 'settings'
              ? 'advanced'
              : 'banks'
          : tab === 'overview' || tab === 'history'
            ? 'overview'
            : 'settings'
      }
      tenant={tenant}
      proEnabled={proEnabled}
      receivingEnabled={process.env.PAYMENT_CHANNELS_ENABLED === 'true'}
      designerEnabled={process.env.QR_PAYMENT_DESIGNER_ENABLED === 'true'}
    />
  )
}
