import { getBilling } from '@/lib/billing'
import { supabaseAdmin } from '@/lib/supabase/server'
import { loadFeatureAccess, LOCKED_ACCESS } from '@/lib/feature-access'
import { AppShell } from '@/components/shell/AppShell'
import { PageStatus } from '@/components/shell/PageStatus'
import { getActiveTenant, tenantPages } from '@/lib/tenant'
import { getActor, requireDashboardUser } from '@/lib/auth'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDashboardUser()
  const [active, actor] = await Promise.all([getActiveTenant(), getActor()])
  const db = supabaseAdmin()
  const messageBilling = active ? await getBilling(supabaseAdmin(), active.id).catch(() => null) : null
  const access = active ? await loadFeatureAccess(db, active.id) : LOCKED_ACCESS
  const expiry = active ? await db.from('tenants').select('plan_expires_at').eq('id', active.id).maybeSingle() : null
  // the Page picture is decoration: a missing service key or Graph outage must not break every screen
  const [profile] = await tenantPages(active).catch((e) => {
    console.error('[layout] page profile failed', e)
    return []
  })

  return (
    <AppShell
      access={access}
      messagesRemaining={messageBilling ? messageBilling.monthly + messageBilling.topup : null}
      accessExpiresAt={expiry?.data?.plan_expires_at ?? null}
      email={user.email ?? 'ผู้ใช้'}
      isPlatformAdmin={actor?.kind === 'user' && actor.isPlatformAdmin}
      page={
        <PageStatus
          page={
            active && {
              tenantId: active.id,
              // the shop name until a Page with a working token is linked
              name: profile && profile.name !== `เพจ ${profile.id}` ? profile.name : active.name,
              picture: profile?.picture ?? null,
              pageLinked: !!active.page_id,
              autoReply: active.auto_reply_enabled,
              creditsLeft: Math.max((active.slip_quota + active.slip_quota_credits) - active.slip_used, 0),
            }
          }
        />
      }
    >
      {children}
    </AppShell>
  )
}
