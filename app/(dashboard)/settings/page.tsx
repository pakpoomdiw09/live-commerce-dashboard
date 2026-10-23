import { redirect } from 'next/navigation'
import {
  getActiveTenant,
  getTenants,
  getViewer,
  tenantPages,
  tenantPageConnections,
} from '@/lib/tenant'
import { SettingsDashboard } from '@/components/settings/SettingsDashboard'
import { InlineError } from '@/components/shared/ErrorState'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isSupportedBank } from '@/lib/features/banking/banks'

export const metadata = { title: 'ตั้งค่า' }

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; page?: string; tab?: string }>
}) {
  const [{ tenants, error }, active, viewer, { new: isNew, page, tab }] = await Promise.all([
    getTenants(),
    getActiveTenant(),
    getViewer(),
    searchParams,
  ])

  if (error) {
    return (
      <div className="p-6">
        <InlineError
          title="โหลดข้อมูลร้านค้าไม่ได้ (ถ้ายังไม่ได้อัปเดตฐานข้อมูล ให้รัน supabase/platform.sql และ supabase/security.sql)"
          message={error}
        />
      </div>
    )
  }

  if (isNew === '1' || !active)
    redirect(page ? '/settings/new?page=' + encodeURIComponent(page) : '/settings/new')
  const db = supabaseAdmin()
  const [pages, connections, billingResult, featureResult, bankAccounts] = await Promise.all([
    tenantPages(active).catch((profileError) => {
      console.error('[settings] Facebook Page profile lookup failed', profileError)
      return []
    }),
    tenantPageConnections([active]),
    db
      .from('tenants')
      .select(
        'plan, plan_expires_at, broadcast_allowance, broadcast_credits, broadcast_topup_credits, slip_quota, slip_used',
      )
      .eq('id', active.id)
      .maybeSingle(),
    db.rpc('has_tenant_feature', { p_tenant: active.id, p_feature: 'slip_auto_pilot' }),
    db.from('bank_accounts').select('bank_code').eq('tenant_id', active.id).eq('is_active', true),
  ])

  if (billingResult.error) {
    console.error('[settings] billing status lookup failed', {
      tenantId: active.id,
      code: billingResult.error.code,
    })
  }
  if (bankAccounts.error) {
    console.error('[settings] active bank account lookup failed', {
      tenantId: active.id,
      code: bankAccounts.error.code,
    })
  }
  if (featureResult.error) {
    console.error('[settings] slip feature entitlement lookup failed', {
      tenantId: active.id,
      code: featureResult.error.code,
    })
  }

  const billingRow = billingResult.data
  const slipAccess =
    featureResult.data === true &&
    active.slip_quota + active.slip_quota_credits > active.slip_used &&
    !bankAccounts.error &&
    !!bankAccounts.data?.length &&
    bankAccounts.data.every((account) => isSupportedBank(account.bank_code))
  const billing = billingRow
    ? {
        plan: billingRow.plan,
        planExpiresAt: billingRow.plan_expires_at,
        allowance: billingRow.broadcast_allowance,
        monthly: billingRow.broadcast_credits,
        topup: billingRow.broadcast_topup_credits,
        slipRemaining: Math.max(
          billingRow.slip_quota + active.slip_quota_credits - billingRow.slip_used,
          0,
        ),
        slipQuotaCredits: active.slip_quota_credits,
      }
    : null

  return (
    <SettingsDashboard
      key={active.id}
      tenant={active}
      pages={pages}
      role={viewer.role ?? 'staff'}
      isFirst={tenants.length === 0}
      connectionStatus={connections.get(active.id) ?? 'unverified'}
      billing={billing}
      slipCredits={{ quota: active.slip_quota + active.slip_quota_credits, used: active.slip_used }}
      slipAccess={slipAccess}
      slipStatusKnown={!billingResult.error && !featureResult.error && !bankAccounts.error}
      initialTab={tab}
    />
  )
}
