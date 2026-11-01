import { notFound } from 'next/navigation'
import { publicStore } from '@/lib/features/commerce/commerce-server'
import { CommerceStorefront } from '@/components/shop/CommerceStorefront'
export const dynamic = 'force-dynamic'
export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ product?: string; variant?: string }>
}) {
  const { slug } = await params
  const { product, variant } = await searchParams
  const data = await publicStore(slug)
  if (!data) notFound()
  return (
    <CommerceStorefront
      key={`${slug}:${product}:${variant}`}
      data={data}
      initialProductId={product}
      initialVariantId={variant}
    />
  )
}
