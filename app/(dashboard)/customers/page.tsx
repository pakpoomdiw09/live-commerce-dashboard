import { hasFeature } from '@/lib/feature-access'
import { FeatureLocked } from '@/components/shared/FeatureLocked'
import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant } from '@/lib/tenant'
import { SetupNotice } from '@/components/shared/SetupNotice'
import { CUSTOMER_COLUMNS, type CustomerRow } from '@/lib/types'
import { CustomersTable, type CustomerListRow } from '@/components/customers/CustomersTable'
import { InlineError } from '@/components/shared/ErrorState'

export const metadata = { title: 'จัดการลูกค้า' }

export default async function CustomersPage() {
  const [db, tenant] = await Promise.all([supabaseServer(), getActiveTenant()])
  if (!tenant) return <SetupNotice kind="no-tenant" />
  if (!(await hasFeature(db, tenant.id, 'customer_management'))) return <FeatureLocked />
  let query = db
    .from('customers')
    // only accepted slips count towards the lifetime value
    .select(`${CUSTOMER_COLUMNS}, slips(amount)`)
    .eq('slips.status', 'valid')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(500)
  query = query.eq('tenant_id', tenant.id).eq('slips.tenant_id', tenant.id)
  const { data, error } = await query

  if (error) {
    return (
      <div className="p-6">
        <InlineError title="โหลดรายชื่อลูกค้าไม่ได้ (ถ้ายังไม่ได้อัปเดตฐานข้อมูล ให้รัน supabase/platform.sql)" message={error.message} />
      </div>
    )
  }

  const rows: CustomerListRow[] = ((data ?? []) as unknown as (CustomerRow & { slips: { amount: number | null }[] })[]).map(({ slips, ...c }) => ({
    ...c,
    paidTotal: slips.reduce((sum, s) => sum + Number(s.amount ?? 0), 0),
    paidCount: slips.length,
  }))

  return <CustomersTable rows={rows} tenantName={tenant?.name ?? null} />
}
