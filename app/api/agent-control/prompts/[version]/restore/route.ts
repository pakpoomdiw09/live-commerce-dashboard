import { NextRequest, NextResponse } from 'next/server'
import { agentControlTenant } from '@/lib/features/agents/agent-control-server'
import { inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import {
  validateStoreRules,
  StoreRulesValidationError,
} from '@/lib/features/store-rules/store-rule-items'
export async function POST(req: NextRequest, { params }: { params: Promise<{ version: string }> }) {
  try {
    const { db, tenantId, actor } = await agentControlTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
      true,
    )
    const version = Number((await params).version)
    if (!Number.isSafeInteger(version) || version < 1) throw new InboxError('เวอร์ชันไม่ถูกต้อง')
    const snapshot = await db
      .from('agent_prompt_versions')
      .select('instructions')
      .eq('tenant_id', tenantId)
      .eq('version', version)
      .maybeSingle()
    if (snapshot.error) throw snapshot.error
    if (!snapshot.data) throw new InboxError('ไม่พบเวอร์ชัน', 404)
    validateStoreRules(snapshot.data.instructions)
    const restored = await db.rpc('restore_agent_prompt', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_version: version,
    })
    checkRpc(restored.error)
    if (restored.data !== true) throw new InboxError('ไม่พบเวอร์ชัน', 404)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof StoreRulesValidationError)
      return NextResponse.json(
        { error: error.message, code: error.code, issues: error.issues },
        { status: error.status },
      )
    return inboxError(error)
  }
}
