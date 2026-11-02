import { notFound } from 'next/navigation'
import { loadShippingBatch, ShippingError } from '@/lib/features/shipping/shipping-server'
import { ShippingPrintView } from '@/components/shipping/ShippingPrintView'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'พิมพ์ใบปะหน้าพัสดุ | SnapBot' }
export default async function ShippingPrintPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  const batch = await loadShippingBatch((await params).batchId).catch((error) => {
    if (error instanceof ShippingError) return null
    throw error
  })
  if (!batch || !['thermal', 'a4'].includes(batch.format)) notFound()
  return <ShippingPrintView batch={batch} />
}
