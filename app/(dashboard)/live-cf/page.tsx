import { notFound } from 'next/navigation'
import { LiveCfSetup } from '@/components/live-cf/LiveCfSetup'
import { LiveCfWorkspace } from '@/components/live-cf/LiveCfWorkspace'
import { getActiveTenant, tenantPages } from '@/lib/tenant'
import { supabaseAdmin } from '@/lib/supabase/server'
import { liveProducts } from '@/lib/features/comments/live-products'
import { LIVE_CF_RULE_COLUMNS, type CommentRule } from '@/lib/features/comments/comment-rules'
import { isFeatureEnabled } from '@/lib/feature-flags'

export const metadata = { title: 'ระบบไลฟ์สด CF และประมูล | SnapBot' }
export const dynamic = 'force-dynamic'

export default async function LiveCfPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>
}) {
  if (!isFeatureEnabled('live_cf')) notFound()
  const tenant = await getActiveTenant()
  if (!tenant) notFound()
  const mode = (await searchParams).mode === 'auction' ? 'auction' : 'cf'
  const db = supabaseAdmin()
  const [pages, catalog, rule, accounts] = await Promise.all([
    tenantPages(tenant),
    liveProducts(db, tenant.id),
    db
      .from('comment_rules')
      .select(LIVE_CF_RULE_COLUMNS)
      .eq('tenant_id', tenant.id)
      .eq('mode', 'live_cf')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('bank_accounts')
      .select('id,bank_code,account_name,account_number,is_primary')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('is_primary', { ascending: false }),
  ])
  const setupError = rule.error?.message ?? accounts.error?.message ?? catalog.error
  return (
    <LiveCfWorkspace
      key={tenant.id}
      tenantId={tenant.id}
      bankAccounts={accounts.data ?? []}
      initialMode={mode}
    >
      <LiveCfSetup
        key={tenant.id}
        tenantId={tenant.id}
        pages={pages}
        products={catalog.products}
        bankAccounts={accounts.data ?? []}
        initialRule={(rule.data as CommentRule | null) ?? null}
        setupError={setupError}
        salesPageUrl={catalog.salesPageUrl}
      />
    </LiveCfWorkspace>
  )
}
