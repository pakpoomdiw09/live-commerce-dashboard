import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant, tenantFilter } from '@/lib/tenant'
import { SLIP_COLUMNS } from '@/lib/types'
import { SlipsWorkspace, type SlipListRow } from '@/components/slips/SlipsWorkspace'
import { InlineError } from '@/components/ErrorState'

export const metadata = { title: 'ตรวจสอบสลิป' }

export default async function SlipsPage() {
  const [db, tenant] = await Promise.all([supabaseServer(), getActiveTenant()])
  let query = db.from('slips').select(`${SLIP_COLUMNS}, customers(display_name)`).order('created_at', { ascending: false }).limit(200)
  if (tenant) query = query.or(tenantFilter(tenant.id))
  const { data, error } = await query

  if (error) {
    return (
      <div className="p-6">
        <InlineError title="โหลดประวัติสลิปไม่ได้ (ถ้ายังไม่ได้อัปเดตฐานข้อมูล ให้รัน supabase/platform.sql)" message={error.message} />
      </div>
    )
  }

  return (
    <SlipsWorkspace
      key={tenant?.id ?? 'all'}
      initial={(data ?? []) as unknown as SlipListRow[]}
      tenant={tenant && { id: tenant.id, name: tenant.name, expectedAmount: tenant.expected_amount }}
    />
  )
}
