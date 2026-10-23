import { getBilling } from '@/lib/features/billing/billing'
import { supabaseAdmin } from '@/lib/supabase/server'
import { loadFeatureAccess, LOCKED_ACCESS } from '@/lib/feature-access'
import { AppShell } from '@/components/shell/AppShell'
import { PageStatus } from '@/components/shell/PageStatus'
import { getActiveTenant, tenantPages } from '@/lib/tenant'
import { getActor, requireDashboardUser } from '@/lib/auth'
import { Suspense } from 'react'
import { BrandLoader } from '@/components/ui/BrandLoader'
import type { TenantRow } from '@/lib/types'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<BrandLoader className="min-h-screen" />}>
      <DashboardContent>{children}</DashboardContent>
    </Suspense>
  )
}

async function DashboardContent({ children }: { children: React.ReactNode }) {
  const user = await requireDashboardUser()
  const [active, actor] = await Promise.all([getActiveTenant(), getActor()])
  const db = supabaseAdmin()
  const [messageBilling, access, expiry] = await Promise.all([
    active ? getBilling(db, active.id).catch(() => null) : null,
    active ? loadFeatureAccess(db, active.id) : LOCKED_ACCESS,
    active ? db.from('tenants').select('plan_expires_at').eq('id', active.id).maybeSingle() : null,
  ])
  return (
    <AppShell
      access={access}
      messagesRemaining={messageBilling ? messageBilling.monthly + messageBilling.topup : null}
      accessExpiresAt={expiry?.data?.plan_expires_at ?? null}
      email={user.email ?? 'ผู้ใช้'}
      isPlatformAdmin={actor?.kind === 'user' && actor.isPlatformAdmin}
      page={
        <Suspense fallback={<TenantPageStatus active={active} />}>
          <ResolvedPageStatus active={active} />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  )
}

function TenantPageStatus({
  active,
  profile,
}: {
  active: TenantRow | null
  profile?: { id: string; name: string; picture: string | null }
}) {
  return (
    <PageStatus
      page={
        active && {
          tenantId: active.id,
          name: profile && profile.name !== `เพจ ${profile.id}` ? profile.name : active.name,
          picture: profile?.picture ?? null,
          pageLinked: !!active.page_id,
          autoReply: active.auto_reply_enabled,
          creditsLeft: Math.max(
            active.slip_quota + active.slip_quota_credits - active.slip_used,
            0,
          ),
        }
      }
    />
  )
}

async function ResolvedPageStatus({ active }: { active: TenantRow | null }) {
  // Decoration streams separately so Meta latency never blocks the shell.
  const [profile] = await tenantPages(active).catch((e) => {
    console.error('[layout] page profile failed', e)
    return []
  })
  return <TenantPageStatus active={active} profile={profile} />
}
