import { hasFeature } from '@/lib/feature-access'
import { FeatureLocked } from '@/components/shared/FeatureLocked'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant } from '@/lib/tenant'
import { SetupNotice } from '@/components/shared/SetupNotice'
import { CustomersTable } from '@/components/customers/CustomersTable'
import { InlineError } from '@/components/shared/ErrorState'
import { customerFilters } from '@/lib/features/customers/customer-directory'
import { loadCustomerDirectory } from '@/lib/features/customers/customer-directory-server'

export const metadata = { title: 'จัดการลูกค้า' }

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [db, tenant] = await Promise.all([supabaseServer(), getActiveTenant()])
  if (!tenant) return <SetupNotice kind="no-tenant" />
  if (!(await hasFeature(db, tenant.id, 'customer_management'))) return <FeatureLocked />
  try {
    const filters = customerFilters(await searchParams)
    const data = await loadCustomerDirectory(
      supabaseAdmin({ timeoutMs: 15000 }),
      tenant.id,
      filters,
    )
    return (
      <CustomersTable
        {...data}
        filters={{ ...filters, page: data.page }}
        tenantName={tenant.name}
      />
    )
  } catch (error) {
    return (
      <div className="p-6">
        <InlineError
          title="โหลดรายชื่อลูกค้าไม่สำเร็จ"
          message={error instanceof Error ? error.message : 'กรุณาลองใหม่'}
        />
      </div>
    )
  }
}
