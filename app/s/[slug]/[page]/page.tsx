import { notFound } from 'next/navigation'
import { publicStore } from '@/lib/features/commerce/commerce-server'
import { CommerceStorefront } from '@/components/shop/CommerceStorefront'
export const dynamic = 'force-dynamic'
export default async function SalesPage({
  params,
}: {
  params: Promise<{ slug: string; page: string }>
}) {
  const { slug, page } = await params
  const data = await publicStore(slug, page)
  if (!data) notFound()
  return <CommerceStorefront key={`${slug}:${page}`} data={data} />
}
