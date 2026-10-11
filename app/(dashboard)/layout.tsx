import { AppShell } from '@/components/shell/AppShell'
import { CreditWidget } from '@/components/shell/CreditWidget'
import { TenantSwitcher } from '@/components/shell/TenantSwitcher'
import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant, getTenants, getViewer } from '@/lib/tenant'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [{ tenants }, active, viewer, { data }] = await Promise.all([getTenants(), getActiveTenant(), getViewer(), (await supabaseServer()).auth.getUser()])

  return (
    <AppShell
      email={data.user?.email ?? 'ผู้ใช้'}
      switcher={
        <TenantSwitcher
          tenants={tenants.map(({ id, name, bank_code, page_id }) => ({ id, name, bank_code, page_id }))}
          activeId={active?.id ?? null}
          canCreate={viewer.isPlatformAdmin}
        />
      }
      credits={active ? <CreditWidget key={active.id} tenantId={active.id} used={active.slip_used} quota={active.slip_quota} /> : null}
    >
      {children}
    </AppShell>
  )
}
