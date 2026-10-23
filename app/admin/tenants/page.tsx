import Link from 'next/link'
import { requirePlatformOwner } from '@/lib/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ManageTenants, type ManagedTenant } from '@/components/admin/ManageTenants'
import { PageHeader } from '@/components/ui/card'
import { Notice } from '@/components/ui/field'

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  await requirePlatformOwner()
  const params = await searchParams
  const page = Math.min(Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1), 100_000)
  const search = (params.q ?? '').trim().slice(0, 100)
  const size = 30
  let query = supabaseAdmin()
    .from('tenants')
    .select(
      'id, name, page_name, plan, plan_expires_at, is_active, broadcast_credits, broadcast_topup_credits, slip_quota, slip_quota_credits, slip_used',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id')
  if (search) query = query.ilike('name', `%${search.replace(/[\\%_]/g, '\\$&')}%`)
  const { data, error, count } = await query.range((page - 1) * size, page * size - 1)
  if (error)
    return (
      <Notice tone="error">
        อ่านร้านค้าไม่ได้ กรุณารัน platform-dashboard.sql และตรวจสอบการเชื่อมต่อ
      </Notice>
    )
  const href = (value: number) =>
    `/admin/tenants?${new URLSearchParams({ page: String(value), q: search })}`
  return (
    <>
      <PageHeader
        title="จัดการร้านค้า"
        description={`พบ ${count?.toLocaleString('th-TH') ?? 0} ร้านค้า · การปรับแพ็กเกจจะเก็บประวัติผู้ดำเนินการไว้`}
      />
      <form action="/admin/tenants" className="flex gap-2">
        <label htmlFor="tenant-search" className="sr-only">
          ค้นหาชื่อร้านค้า
        </label>
        <input
          id="tenant-search"
          name="q"
          defaultValue={search}
          maxLength={100}
          placeholder="ค้นหาชื่อร้านค้า"
          className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        />
        <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">ค้นหา</button>
      </form>
      <ManageTenants tenants={(data ?? []) as ManagedTenant[]} />
      <p className="text-xs text-slate-500">
        ยอดเครดิตแสดงตามข้อมูลที่บันทึกล่าสุด การเปิดหรือปิดร้านไม่เปลี่ยนยอดเครดิตสะสม
      </p>
      <div className="flex gap-4 text-sm">
        {page > 1 && <Link href={href(page - 1)}>← หน้าก่อน</Link>}
        {page * size < (count ?? 0) && <Link href={href(page + 1)}>หน้าถัดไป →</Link>}
      </div>
    </>
  )
}
