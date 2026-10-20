import Link from 'next/link'
import { requirePlatformOwner } from '@/lib/admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { BILLING_REQUEST_COLUMNS, type BillingRequestRow } from '@/lib/features/billing/plans'
import { PendingApprovals, type AdminPendingRequest } from '@/components/admin/PendingApprovals'
import { PageHeader } from '@/components/ui/card'
import { Notice } from '@/components/ui/field'

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requirePlatformOwner()
  const params = await searchParams
  const page = Math.min(Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1), 100_000)
  const size = 30
  const { data, error, count } = await supabaseAdmin().from('billing_requests')
    .select(`${BILLING_REQUEST_COLUMNS}, proof_path, verification_status, verification_error, tenants(name)`, { count: 'exact' })
    .eq('status', 'pending').order('created_at').order('id').range((page - 1) * size, page * size - 1)
  if (error) return <Notice tone="error">อ่านคำสั่งซื้อไม่ได้ กรุณารัน platform-dashboard.sql และตรวจสอบการเชื่อมต่อ</Notice>
  const requests: AdminPendingRequest[] = (data ?? []).map(({ tenants, proof_path, ...request }) => ({
    ...(request as BillingRequestRow), tenantName: (tenants as unknown as { name: string } | null)?.name ?? 'ร้านค้าที่ไม่พบชื่อ', hasProof: !!proof_path,
  }))
  return <><PageHeader title="อนุมัติการชำระเงิน" description={`คำสั่งซื้อแพ็กเกจและเติมเครดิตรออนุมัติ ${count?.toLocaleString('th-TH') ?? 0} รายการ`} /><PendingApprovals requests={requests} /><div className="flex gap-4 text-sm">{page > 1 && <Link href={`/admin/approvals?page=${page - 1}`}>← หน้าก่อน</Link>}{page * size < (count ?? 0) && <Link href={`/admin/approvals?page=${page + 1}`}>หน้าถัดไป →</Link>}</div></>
}
