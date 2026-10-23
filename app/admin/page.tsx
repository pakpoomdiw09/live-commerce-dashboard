import Link from 'next/link'
import { requirePlatformOwner, loadAdminOverview } from '@/lib/admin'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { Notice } from '@/components/ui/field'

export default async function AdminPage() {
  await requirePlatformOwner()
  let overview
  try {
    overview = await loadAdminOverview()
  } catch (error) {
    return (
      <Notice tone="error">{error instanceof Error ? error.message : 'อ่านภาพรวมไม่ได้'}</Notice>
    )
  }
  const number = (value: number) => value.toLocaleString('th-TH')
  return (
    <>
      <PageHeader title="ภาพรวมระบบ" description="ยอดรวมของทุกร้านค้าในเดือนปัจจุบันตามเวลาไทย" />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-500">ร้านค้าทั้งหมด</p>
          <p className="mt-3 text-3xl font-semibold">
            {number(overview.tenantCount)} <span className="text-sm font-normal">ร้าน</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            เปิดใช้งาน {number(overview.activeTenantCount)} ร้าน
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">รายได้รวมเดือนนี้</p>
          <p className="mt-3 text-3xl font-semibold">
            {number(overview.monthRevenue)} <span className="text-sm font-normal">บาท</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">คำสั่งซื้อที่อนุมัติและแพ็กเกจที่ชำระสำเร็จ</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">รออนุมัติการชำระเงิน</p>
          <p className="mt-3 text-3xl font-semibold">
            {number(overview.pendingCount)} <span className="text-sm font-normal">รายการ</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">ยอดรวม {number(overview.pendingAmount)} บาท</p>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="งานสำหรับผู้ดูแล"
          description="ตรวจสอบการชำระเงินและดูแลการใช้งานของร้านค้า"
        />
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {[
            [
              '/admin/approvals',
              'ตรวจคำสั่งซื้อรออนุมัติ',
              'ดูหลักฐานการโอนและเติมเครดิตให้ร้านค้า',
            ],
            ['/admin/provider', 'เช็กโควตาตรวจสลิป', 'ดูสิทธิ์ตรวจสลิปคงเหลือฝั่งผู้ให้บริการ'],
            ['/admin/tenants', 'จัดการร้านค้า', 'ปรับแพ็กเกจและสถานะการใช้งาน'],
          ].map(([href, title, detail]) => (
            <Link
              key={href}
              href={href}
              className="rounded-xl border border-slate-200 p-4 hover:border-orange-400"
            >
              <p className="font-medium">{title} →</p>
              <p className="mt-1 text-sm text-slate-500">{detail}</p>
            </Link>
          ))}
        </div>
      </Card>
    </>
  )
}
