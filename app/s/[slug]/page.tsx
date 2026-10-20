import { notFound } from 'next/navigation'
import { publicStore } from '@/lib/features/commerce/commerce-server'
import { CommerceStorefront } from '@/components/shop/CommerceStorefront'
export const dynamic = 'force-dynamic'
export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const data = await publicStore(slug); if (!data) notFound(); return <CommerceStorefront key={slug} data={data}/> }
