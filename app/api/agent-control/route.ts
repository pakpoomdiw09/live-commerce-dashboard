import { NextRequest, NextResponse } from 'next/server'
import {
  agentControlTenant,
  agentControlDashboard,
} from '@/lib/features/agents/agent-control-server'
import { inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import { containsSecret } from '@/lib/features/agents/agent-control-core'
import {
  compileShopRules,
  validateShopRules,
  STORE_RULES_MAX_LENGTH,
} from '@/lib/features/store-rules/shop-persona-settings'
import {
  parseStoreRules,
  validateStoreRules,
  StoreRulesValidationError,
} from '@/lib/features/store-rules/store-rule-items'
export async function GET(req: NextRequest) {
  try {
    const { db, tenantId, config, actor } = await agentControlTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
      false,
      true,
    )
    const { canAccessTenant } = await import('@/lib/auth')
    const dashboard = await agentControlDashboard(
      db,
      tenantId,
      config.flags.agent_analytics_enabled,
    )
    const rules = parseStoreRules(dashboard.shopInstructions)
    return NextResponse.json(
      {
        ...dashboard,
        storeRulesState: { ok: rules.ok, kind: rules.kind, issues: rules.issues },
        config,
        canManage: await canAccessTenant(actor, tenantId, 'owner'),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const { db, tenantId, actor } = await agentControlTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
      true,
    )
    const input = await req.json().catch(() => null)
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => !['instructions', 'shopRules', 'expectedInstructions', 'recover'].includes(key),
      )
    )
      throw new InboxError('ข้อมูลการบันทึกกฎไม่ถูกต้อง', 400, 'STORE_RULES_INVALID')
    if (input.instructions !== undefined) validateStoreRules(input.instructions)
    if (
      (input.expectedInstructions !== undefined &&
        typeof input.expectedInstructions !== 'string') ||
      (input.recover !== undefined && typeof input.recover !== 'boolean')
    )
      throw new InboxError('ข้อมูลยืนยันการแก้ไขกฎไม่ถูกต้อง', 400, 'STORE_RULES_INVALID')
    let instructions: unknown = input?.instructions
    if (input?.shopRules !== undefined) {
      try {
        instructions = compileShopRules(validateShopRules(input.shopRules))
      } catch (error) {
        throw new InboxError(error instanceof Error ? error.message : 'ข้อมูลกติการ้านไม่ถูกต้อง')
      }
    }
    if (
      typeof instructions !== 'string' ||
      instructions.length > STORE_RULES_MAX_LENGTH ||
      containsSecret(instructions)
    )
      throw new InboxError('กฎของร้านต้องไม่เกิน 50,000 ตัวอักษร และไม่มีข้อมูลลับ')
    validateStoreRules(instructions)
    const current = await db
      .from('bot_settings')
      .select('ai_instructions')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (current.error) throw current.error
    const raw = current.data?.ai_instructions ?? '',
      state = parseStoreRules(raw)
    if (!state.ok && !(input.recover === true && input.expectedInstructions === raw))
      return NextResponse.json(
        {
          error: 'ข้อมูลกฎเดิมมีปัญหา กรุณาสำรองข้อมูลและยืนยันการกู้คืนก่อนบันทึก',
          code: 'STORE_RULES_RECOVERY_REQUIRED',
          issues: state.issues,
        },
        { status: 409 },
      )
    if (input.recover === true && input.expectedInstructions === undefined)
      throw new InboxError('กรุณายืนยันข้อมูลเดิมก่อนกู้คืน', 400, 'STORE_RULES_INVALID')
    if (input.expectedInstructions !== undefined && input.expectedInstructions !== raw)
      throw new InboxError(
        'กฎของร้านมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่ก่อนบันทึก',
        409,
        'STORE_RULES_CONFLICT',
      )
    const result = await db.rpc('save_validated_store_rules', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_expected: raw,
      p_instructions: instructions,
    })
    if (result.error?.code === '40001')
      throw new InboxError(
        'กฎของร้านมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่ก่อนบันทึก',
        409,
        'STORE_RULES_CONFLICT',
      )
    if (result.error?.code === '22023')
      throw new InboxError(
        'ข้อมูลกฎไม่ผ่านการตรวจสอบ กรุณาตรวจรูปแบบและลองใหม่',
        400,
        'STORE_RULES_INVALID',
      )
    checkRpc(result.error)
    return NextResponse.json({ ok: true, instructions })
  } catch (error) {
    if (error instanceof StoreRulesValidationError)
      return NextResponse.json(
        { error: error.message, code: error.code, issues: error.issues },
        { status: error.status },
      )
    return inboxError(error)
  }
}
