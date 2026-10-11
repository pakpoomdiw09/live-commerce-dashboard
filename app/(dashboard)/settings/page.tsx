import { getActiveTenant, getTenants, getViewer, tenantPages } from '@/lib/tenant'
import { TenantSettingsForm } from '@/components/settings/TenantSettingsForm'
import { InlineError } from '@/components/ErrorState'

export const metadata = { title: 'ตั้งค่าร้านค้า & บัญชีธนาคาร' }

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const [{ tenants, error }, active, viewer, { new: isNew }] = await Promise.all([getTenants(), getActiveTenant(), getViewer(), searchParams])

  if (error) {
    return (
      <div className="p-6">
        <InlineError title="โหลดข้อมูลร้านค้าไม่ได้ (ถ้ายังไม่ได้อัปเดตฐานข้อมูล ให้รัน supabase/platform.sql และ supabase/security.sql)" message={error} />
      </div>
    )
  }

  const creating = isNew === '1' || !active
  if (creating && !viewer.isPlatformAdmin) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <InlineError
          title={active ? 'เพิ่มร้านค้าใหม่ได้เฉพาะผู้ดูแลแพลตฟอร์ม' : 'บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าร้านค้าใด'}
          message="ติดต่อผู้ดูแลแพลตฟอร์มเพื่อสร้างร้านค้า หรือเพิ่มบัญชีของคุณเป็นสมาชิกร้าน"
        />
      </div>
    )
  }

  return (
    <TenantSettingsForm
      key={creating ? 'new' : active!.id}
      tenant={creating ? null : active}
      pages={creating ? [] : await tenantPages(active)}
      isFirst={tenants.length === 0}
      role={creating ? 'admin' : (viewer.role ?? 'staff')}
    />
  )
}
