import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant, getViewer } from '@/lib/tenant'
import { roleAtLeast } from '@/lib/auth'
import { getBilling } from '@/lib/billing'
import { BROADCAST_COLUMNS, MESSAGING_WINDOW_MS, type BroadcastRow } from '@/lib/chatbot'
import { BroadcastClient } from '@/components/broadcast/BroadcastClient'
import { LiveRefresh } from '@/components/LiveRefresh'
import { SetupNotice } from '@/components/SetupNotice'

export const metadata = { title: 'ส่งข้อความหาลูกค้าทั้งหมด' }

export default async function BroadcastPage() {
  const [db, tenant, viewer] = await Promise.all([supabaseServer(), getActiveTenant(), getViewer()])
  if (!tenant) return <SetupNotice kind="no-tenant" />

  const windowStart = new Date(Date.now() - MESSAGING_WINDOW_MS).toISOString()
  const [broadcasts, tags, customers, reachable] = await Promise.all([
    db.from('broadcasts').select(BROADCAST_COLUMNS).eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50),
    db.from('customers').select('tags').eq('tenant_id', tenant.id).neq('tags', '{}').limit(5000),
    db.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
    db.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('last_message_at', windowStart),
  ])
  if (broadcasts.error) return <SetupNotice kind="migration" message={broadcasts.error.message} />
  let billing
  try {
    billing = await getBilling(supabaseAdmin(), tenant.id, viewer.isPlatformAdmin)
  } catch (e) {
    return <SetupNotice kind="migration" message={`${e instanceof Error ? e.message : e} (รัน supabase/billing.sql)`} />
  }

  const tagCounts = new Map<string, number>()
  for (const row of tags.data ?? []) for (const t of row.tags as string[]) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)

  return (
    <>
      <LiveRefresh channel="broadcasts" tables={['broadcasts']} />
      <BroadcastClient
        tenantId={tenant.id}
        pageName={tenant.page_name ?? tenant.name}
        canSend={roleAtLeast(viewer.role, 'owner')}
        pageLinked={!!tenant.page_id}
        tags={[...tagCounts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))}
        customerCount={customers.count ?? 0}
        reachableCount={reachable.count ?? 0}
        billing={billing}
        broadcasts={(broadcasts.data ?? []) as BroadcastRow[]}
      />
    </>
  )
}
