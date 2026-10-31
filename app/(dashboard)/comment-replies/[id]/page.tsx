import { notFound } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant, tenantPages } from '@/lib/tenant'
import { RULE_COLUMNS, type CommentRule } from '@/lib/features/comments/comment-rules'
import { RuleEditor } from '@/components/comment-rules/RuleEditor'
import { liveProducts } from '@/lib/features/comments/live-products'

export const metadata = { title: 'แก้ไขกฎตอบกลับคอมเมนต์' }

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [db, tenant] = await Promise.all([supabaseServer(), getActiveTenant()])
  if (!tenant) notFound()
  // RLS hides rules of other tenants; the tenant_id filter keeps a platform admin inside the active shop
  const [{ data: rule }, pages, catalog] = await Promise.all([
    db
      .from('comment_rules')
      .select(RULE_COLUMNS)
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    tenantPages(tenant),
    liveProducts(db, tenant.id),
  ])
  if (!rule) notFound()
  return (
    <RuleEditor
      rule={rule as CommentRule}
      pages={pages}
      tenantId={tenant.id}
      products={catalog.products}
      catalogError={catalog.error}
    />
  )
}
