import { notFound } from 'next/navigation'
import { getActiveTenant } from '@/lib/tenant'
import { ShippingDashboard } from '@/components/shipping/ShippingDashboard'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'ระบบจัดส่งพัสดุ | SnapBot' }
export default async function ShippingPage() {
  const tenant = await getActiveTenant()
  if (!tenant) notFound()
  return <ShippingDashboard key={tenant.id} tenantId={tenant.id} shopName={tenant.name} />
}
