import { requirePlatformOwner } from '@/lib/admin'
import { getProviderQuota } from '@/lib/provider-quota'
import { ProviderBalance } from '@/components/admin/ProviderBalance'
import { PageHeader } from '@/components/ui/card'

export default async function ProviderPage() {
  await requirePlatformOwner()
  const quota = await getProviderQuota()
  return (
    <>
      <PageHeader title="โทเค็นระบบ" description="ตรวจสอบโควตาตรวจสลิปของบัญชี Provider" />
      <ProviderBalance initial={quota} />
    </>
  )
}
