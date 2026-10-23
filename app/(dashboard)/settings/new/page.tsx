import { getActor } from '@/lib/auth'
import { connectedFacebookPage, getTenants, getViewer } from '@/lib/tenant'
import { TenantSettingsForm } from '@/components/settings/TenantSettingsForm'
import { InlineError } from '@/components/shared/ErrorState'

export const metadata = { title: 'สร้างร้านค้าใหม่' }

export default async function NewTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const [viewer, { tenants, error }, { page }] = await Promise.all([
    getViewer(),
    getTenants(),
    searchParams,
  ])
  if (!viewer.isPlatformAdmin || error) {
    return (
      <div className="p-6">
        <InlineError
          title="สร้างร้านค้าใหม่ไม่ได้"
          message={error ?? 'ติดต่อผู้ดูแลแพลตฟอร์มเพื่อสร้างร้านค้าหรือเพิ่มสิทธิ์สมาชิก'}
        />
      </div>
    )
  }
  const actor = page ? await getActor() : null
  const connected =
    actor?.kind === 'user' && page ? await connectedFacebookPage(actor.id, page) : null
  return (
    <TenantSettingsForm
      section="create"
      tenant={null}
      billing={null}
      slipCredits={{ quota: 0, used: 0 }}
      pages={[]}
      connected={connected}
      isFirst={tenants.length === 0}
      role="admin"
    />
  )
}
