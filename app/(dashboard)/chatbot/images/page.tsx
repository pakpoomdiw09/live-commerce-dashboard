import { hasFeature } from '@/lib/feature-access'
import { FeatureLocked } from '@/components/shared/FeatureLocked'
import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant, getViewer } from '@/lib/tenant'
import { roleAtLeast } from '@/lib/auth'
import { IMAGE_RULE_COLUMNS, type ImageResponseRule } from '@/lib/features/vision/image-rules'
import { ImageRulesClient } from '@/components/chatbot/ImageRulesClient'
import { SetupNotice } from '@/components/shared/SetupNotice'
import { InlineError } from '@/components/shared/ErrorState'
import { VisionCenter } from '@/components/chatbot/VisionCenter'

export const metadata = { title: 'ผู้ช่วยตอบรูปภาพ' }

export default async function Page() {
  const [db, tenant, viewer] = await Promise.all([supabaseServer(), getActiveTenant(), getViewer()])
  if (!tenant) return <SetupNotice kind="no-tenant" />
  if (!(await hasFeature(db, tenant.id, 'image_assistant'))) return <FeatureLocked />
  const { data, error } = await db
    .from('image_response_rules')
    .select(IMAGE_RULE_COLUMNS)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(1000)
  if (error)
    return (
      <div className="p-6">
        <InlineError
          title="โหลดกฎตอบรูปภาพไม่ได้"
          message="กรุณารัน supabase/image-response-rules.sql และ supabase/ai-vision.sql ใน Supabase SQL Editor แล้วโหลดหน้านี้ใหม่"
        />
      </div>
    )
  return (
    <VisionCenter
      key={tenant.id}
      tenantId={tenant.id}
      canManage={roleAtLeast(viewer.role, 'owner')}
    >
      <ImageRulesClient
        tenantId={tenant.id}
        tenantName={tenant.name}
        initialRules={(data ?? []) as ImageResponseRule[]}
        canManage={roleAtLeast(viewer.role, 'owner')}
      />
    </VisionCenter>
  )
}
