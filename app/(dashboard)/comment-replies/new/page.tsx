import { redirect } from 'next/navigation'
import { getActiveTenant, tenantPages } from '@/lib/tenant'
import { RuleEditor } from '@/components/comment-rules/RuleEditor'

export const metadata = { title: 'สร้างกฎตอบกลับคอมเมนต์' }

export default async function NewRulePage() {
  const tenant = await getActiveTenant()
  if (!tenant) redirect('/comment-replies')
  return <RuleEditor pages={await tenantPages(tenant)} tenantId={tenant.id} />
}
