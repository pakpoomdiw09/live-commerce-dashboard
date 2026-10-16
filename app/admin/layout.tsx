import { requirePlatformOwner } from '@/lib/admin'
import { AdminShell } from '@/components/admin/AdminShell'

export const metadata = { title: 'ผู้ดูแลระบบ' }
export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformOwner()
  return <AdminShell>{children}</AdminShell>
}
