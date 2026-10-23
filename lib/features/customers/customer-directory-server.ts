import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CustomerDirectory,
  CustomerFilters,
} from '@/lib/features/customers/customer-directory'

/** Caller must authenticate, authorize this tenant and check customer_management first. */
export async function loadCustomerDirectory(
  db: SupabaseClient,
  tenantId: string,
  filters: CustomerFilters,
): Promise<CustomerDirectory> {
  const { data, error } = await db.rpc('customer_directory', {
    p_tenant: tenantId,
    p_page: filters.page,
    p_query: filters.q,
    p_status: filters.status,
    p_tag: filters.tag,
  })
  if (
    error ||
    !data ||
    !Array.isArray(data.rows) ||
    data.rows.length > 50 ||
    !Array.isArray(data.tags) ||
    !Number.isSafeInteger(data.total) ||
    data.total < 0 ||
    !Number.isFinite(data.totalPaid) ||
    !Number.isInteger(data.page) ||
    !Number.isInteger(data.pages) ||
    data.page < 1 ||
    data.pages < data.page ||
    data.pageSize !== 50
  ) {
    console.error('[customers/directory] aggregate unavailable', {
      code: error?.code ?? 'INVALID_RESULT',
    })
    throw new Error('โหลดรายชื่อลูกค้าไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล')
  }
  return data as CustomerDirectory
}
