import { getActor, requireDashboardUser, canAccessTenant } from '@/lib/auth'
import { getActiveTenant } from '@/lib/tenant'
import { broadcastUiEnabled } from '@/lib/features/broadcast/broadcast-policy'
import { broadcastScope, broadcastPageStatus } from '@/lib/features/broadcast/broadcast-service'
import { BROADCAST_COLUMNS, type BroadcastRow } from '@/lib/features/agents/chatbot'
import { getBilling } from '@/lib/features/billing/billing'
import { fetchAll } from '@/lib/features/broadcast/broadcast'
import { BroadcastWorkspace } from '@/components/broadcast/BroadcastWorkspace'
import LegacyBroadcastPage from '@/components/broadcast/LegacyBroadcastPage'
import { SetupNotice } from '@/components/shared/SetupNotice'
import { InlineError } from '@/components/shared/ErrorState'

export const metadata = { title: 'บรอดแคสต์' }
export default async function BroadcastPage() {
  await requireDashboardUser()
  if (!broadcastUiEnabled()) return <LegacyBroadcastPage />
  const actor = await getActor(),
    tenant = await getActiveTenant()
  if (!tenant) return <SetupNotice kind="no-tenant" />
  try {
    const scope = await broadcastScope(actor, tenant.id)
    const [status, broadcasts, tagRows, billing, canSend] = await Promise.all([
      broadcastPageStatus(scope),
      scope.db
        .from('broadcasts')
        .select(BROADCAST_COLUMNS)
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(50),
      fetchAll<{ tags: string[] }>((from, to) =>
        scope.db
          .from('customers')
          .select('tags')
          .eq('tenant_id', tenant.id)
          .eq('platform', 'facebook')
          .order('id')
          .range(from, to),
      ).catch(() => []),
      getBilling(scope.db, tenant.id, scope.actor.isPlatformAdmin).catch(() => null),
      canAccessTenant(scope.actor, tenant.id, 'owner'),
    ])
    const tags = [...new Set(tagRows.flatMap((row) => row.tags ?? []))].sort((a, b) =>
      a.localeCompare(b, 'th'),
    )
    return (
      <BroadcastWorkspace
        key={tenant.id}
        tenantId={tenant.id}
        pageName={tenant.page_name ?? tenant.name}
        pageStatus={status}
        canSend={canSend}
        tags={tags}
        billing={billing}
        broadcasts={(broadcasts.data ?? []) as BroadcastRow[]}
        historyUnavailable={!!broadcasts.error}
      />
    )
  } catch (error) {
    return (
      <div className="p-6">
        <InlineError
          title="โหลดบรอดแคสต์ไม่ได้"
          message={error instanceof Error ? error.message : 'กรุณาลองใหม่'}
        />
      </div>
    )
  }
}
