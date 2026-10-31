import { redirect } from 'next/navigation'
import { getActiveTenant, tenantPages } from '@/lib/tenant'
import { RuleEditor } from '@/components/comment-rules/RuleEditor'
import { supabaseServer } from '@/lib/supabase/server'
import { liveProducts } from '@/lib/features/comments/live-products'

export const metadata = { title: 'สร้างกฎตอบกลับคอมเมนต์' }

export default async function NewRulePage() {
  const tenant = await getActiveTenant()
  if (!tenant) redirect('/comment-replies')
  const [pages, catalog] = await Promise.all([
    tenantPages(tenant),
    liveProducts(await supabaseServer(), tenant.id),
  ])
  return (
    <RuleEditor
      pages={pages}
      tenantId={tenant.id}
      products={catalog.products}
      catalogError={catalog.error}
    />
  )
}
