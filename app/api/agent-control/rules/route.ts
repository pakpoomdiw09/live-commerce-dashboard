import { NextRequest, NextResponse } from 'next/server'
import { agentControlTenant } from '@/lib/features/agents/agent-control-server'
import { InboxError, inboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import { containsSecret } from '@/lib/features/agents/agent-control-core'
import { STORE_RULES_MAX_LENGTH } from '@/lib/features/store-rules/shop-persona-settings'
import {
  validateStoreRules,
  StoreRulesValidationError,
  serializeStoreRuleItems,
  validRuleCategory,
} from '@/lib/features/store-rules/store-rule-items'

async function mutate(req: NextRequest, action: 'add' | 'edit' | 'delete') {
  try {
    const { db, tenantId, actor } = await agentControlTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
      true,
    )
    const input = await req.json().catch(() => null)
    if (
      typeof input?.id !== 'string' ||
      !input.id.trim() ||
      input.id.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(input.id)
    )
      throw new InboxError('รหัสกฎไม่ถูกต้อง', 400, 'STORE_RULES_INVALID')
    if (
      Object.keys(input).some(
        (key) =>
          ![
            'id',
            'body',
            'category',
            'enabled',
            'previousBody',
            'previousCategory',
            'previousEnabled',
          ].includes(key),
      )
    )
      throw new InboxError('ข้อมูลกฎมีช่องข้อมูลที่ระบบไม่รองรับ', 400, 'STORE_RULES_INVALID')
    if (
      (action === 'add' || input.body !== undefined) &&
      (typeof input.body !== 'string' ||
        !input.body.trim() ||
        input.body.length > STORE_RULES_MAX_LENGTH ||
        containsSecret(input.body))
    )
      throw new InboxError(
        'กรุณาใส่ข้อความกฎที่ถูกต้อง และไม่มีข้อมูลลับ',
        400,
        'STORE_RULES_INVALID',
      )
    if (
      (input.previousBody !== undefined &&
        (typeof input.previousBody !== 'string' ||
          input.previousBody.length > STORE_RULES_MAX_LENGTH)) ||
      (input.previousCategory !== undefined && !validRuleCategory(input.previousCategory)) ||
      (input.previousEnabled !== undefined && typeof input.previousEnabled !== 'boolean')
    )
      throw new InboxError('ข้อมูลกฎเดิมสำหรับยืนยันการแก้ไขไม่ถูกต้อง', 400, 'STORE_RULES_INVALID')
    if (
      (input.category !== undefined && !validRuleCategory(input.category)) ||
      (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    )
      throw new InboxError('หมวดหมู่หรือสถานะกฎไม่ถูกต้อง')
    if (
      action === 'edit' &&
      input.body === undefined &&
      input.category === undefined &&
      input.enabled === undefined
    )
      throw new InboxError('ไม่มีข้อมูลกฎที่ต้องการแก้ไข')
    const current = await db
      .from('bot_settings')
      .select('ai_instructions')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (current.error) throw current.error
    const raw = current.data?.ai_instructions ?? '',
      state = validateStoreRules(raw),
      items = state.items.map((item) => ({ ...item })),
      index = items.findIndex((item) => item.id === input.id)
    if (action === 'add') {
      if (index >= 0) {
        if (
          items[index].body !== input.body.trim() ||
          (items[index].category ?? 'general') !== (input.category ?? 'general') ||
          (items[index].enabled !== false) !== (input.enabled ?? true)
        )
          throw new InboxError('รหัสกฎซ้ำ กรุณาโหลดข้อมูลใหม่', 409)
        return NextResponse.json({ instructions: raw })
      }
      if (items.length >= 200) throw new InboxError('เพิ่มกฎได้สูงสุด 200 ข้อ')
      items.push({
        id: input.id,
        body: input.body.trim(),
        category: input.category ?? 'general',
        enabled: input.enabled ?? true,
      })
    } else {
      if (index < 0) throw new InboxError('ไม่พบกฎนี้ กรุณาโหลดข้อมูลใหม่', 409)
      if (typeof input.previousBody !== 'string' || items[index].body !== input.previousBody)
        throw new InboxError('กฎนี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก', 409)
      if (
        ((input.previousCategory !== undefined || input.category !== undefined) &&
          input.previousCategory !== (items[index].category ?? 'general')) ||
        ((input.previousEnabled !== undefined || input.enabled !== undefined) &&
          input.previousEnabled !== (items[index].enabled !== false))
      )
        throw new InboxError('หมวดหมู่หรือสถานะกฎมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่', 409)
      if (action === 'delete') items.splice(index, 1)
      else
        items[index] = {
          ...items[index],
          ...(input.body !== undefined ? { body: input.body.trim() } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        }
    }
    const instructions = serializeStoreRuleItems(items)
    validateStoreRules(instructions)
    if (instructions.length > STORE_RULES_MAX_LENGTH)
      throw new InboxError('กฎทั้งหมดรวมข้อมูลจัดเก็บต้องไม่เกิน 50,000 ตัวอักษร')
    const saved = await db.rpc('save_store_rule_items', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_expected: raw,
      p_instructions: instructions,
    })
    if (saved.error?.code === '40001')
      throw new InboxError('กฎของร้านมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง', 409)
    if (saved.error?.code === '22023')
      throw new InboxError(
        'ข้อมูลกฎไม่ผ่านการตรวจสอบ กรุณาตรวจรูปแบบและลองใหม่',
        400,
        'STORE_RULES_INVALID',
      )
    checkRpc(saved.error)
    return NextResponse.json({ instructions })
  } catch (error) {
    if (error instanceof StoreRulesValidationError)
      return NextResponse.json(
        { error: error.message, code: error.code, issues: error.issues },
        { status: error.status },
      )
    return inboxError(error)
  }
}
export const POST = (req: NextRequest) => mutate(req, 'add')
export const PATCH = (req: NextRequest) => mutate(req, 'edit')
export const DELETE = (req: NextRequest) => mutate(req, 'delete')
