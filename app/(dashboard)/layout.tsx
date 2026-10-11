import { AppShell } from '@/components/shell/AppShell'
import { CreditWidget } from '@/components/shell/CreditWidget'
import { PageStatus } from '@/components/shell/PageStatus'
import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant, tenantPages } from '@/lib/tenant'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [active, { data }] = await Promise.all([getActiveTenant(), (await supabaseServer()).auth.getUser()])
  // the Page picture is decoration: a missing service key or Graph outage must not break every screen
  const [profile] = await tenantPages(active).catch((e) => {
    console.error('[layout] page profile failed', e)
    return []
  })

  return (
    <AppShell
      email={data.user?.email ?? 'ผู้ใช้'}
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
              creditsLeft: Math.max(active.slip_quota - active.slip_used, 0),
            }
          }
        />
      }
      credits={active ? <CreditWidget key={active.id} tenantId={active.id} used={active.slip_used} quota={active.slip_quota} /> : null}
    >
      {children}
    </AppShell>
  )
}
