import { redirect } from 'next/navigation'
import { getActiveTenant, getTenants, getViewer, tenantPages, tenantPageConnections } from '@/lib/tenant'
import { TenantSettingsForm } from '@/components/settings/TenantSettingsForm'
import { InlineError } from '@/components/ErrorState'

export const metadata = { title: 'Facebook Page & Access Token' }

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ new?: string; page?: string }> }) {
  const [{ tenants, error }, active, viewer, { new: isNew, page }] = await Promise.all([getTenants(), getActiveTenant(), getViewer(), searchParams])

  if (error) {
    return (
      <div className="p-6">
        <InlineError title="โหลดข้อมูลร้านค้าไม่ได้ (ถ้ายังไม่ได้อัปเดตฐานข้อมูล ให้รัน supabase/platform.sql และ supabase/security.sql)" message={error} />
      </div>
    )
  }

  if (isNew === '1' || !active) redirect(page ? '/settings/new?page=' + encodeURIComponent(page) : '/settings/new')
  const [pages, connections] = await Promise.all([tenantPages(active), tenantPageConnections([active])])

  return (
    <TenantSettingsForm
      key={active.id}
      tenant={active}
      billing={null}
      slipCredits={{ quota: 0, used: 0 }}
      pages={pages}
      connectionStatus={connections.get(active.id)}
      section="facebook"
      isFirst={tenants.length === 0}
      role={viewer.role ?? 'staff'}
    />
  )
}
