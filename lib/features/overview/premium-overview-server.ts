import 'server-only'
import type { Actor } from '@/lib/auth'
import { canAccessTenant } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { InboxError } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'
import {
  overviewFilters,
  premiumOverviewEnabled,
  type PremiumOverviewData,
} from '@/lib/features/overview/premium-overview-core'
import { overviewFromTables } from '@/lib/features/overview/overview-tables'

export async function loadPremiumOverview(
  actor: Actor | null,
  tenantId: string,
  input: { range?: string | null; page?: string | null; q?: string | null },
  setup?: { autoVerifyEnabled: boolean; bankConfigured: boolean; pageConfigured: boolean },
): Promise<PremiumOverviewData> {
  if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
  if (!UUID.test(tenantId) || !(await canAccessTenant(actor, tenantId)))
    throw new InboxError('ไม่พบร้านค้า', 404)
  if (!premiumOverviewEnabled())
    throw new InboxError('ยังไม่เปิดใช้ภาพรวมรูปแบบนี้', 403, 'FEATURE_DISABLED')
  let filters
  try {
    filters = overviewFilters(input)
  } catch {
    throw new InboxError('ช่วงเวลา หน้า หรือคำค้นไม่ถูกต้อง', 400, 'INVALID_FILTER')
  }
  if (!setup) {
    const tenant = await supabaseAdmin()
      .from('tenants')
      .select('auto_verify_enabled,bank_code,account_name,page_id,page_token_set')
      .eq('id', tenantId)
      .maybeSingle()
    if (tenant.error || !tenant.data)
      throw new InboxError('อ่านการตั้งค่าร้านค้าไม่ได้', 503, 'OVERVIEW_UNAVAILABLE')
    setup = {
      autoVerifyEnabled: tenant.data.auto_verify_enabled,
      bankConfigured: !!tenant.data.bank_code && !!tenant.data.account_name,
      pageConfigured: !!tenant.data.page_id && tenant.data.page_token_set,
    }
  }
  const { summary, notices } = await overviewFromTables(supabaseAdmin(), tenantId, filters)
  if (summary.shop.id !== tenantId)
    throw new InboxError('ข้อมูลร้านค้าไม่ตรงกัน', 503, 'OVERVIEW_UNAVAILABLE')
  const aiSettings = await supabaseAdmin()
    .from('agent_control_settings')
    .select('flags')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const aiConfigured =
    !aiSettings.error && aiSettings.data?.flags?.agent_orchestrator_enabled === true
  const databaseConfigured = notices.length === 0
  const slipConfigured = setup.autoVerifyEnabled && setup.bankConfigured
  return {
    ...summary,
    filters,
    health: [
      {
        name: 'ระบบตรวจสอบสลิป',
        status: slipConfigured ? 'active' : 'setup',
        detail: slipConfigured
          ? 'ตั้งค่าบัญชีรับเงินและเปิดตรวจสลิปอัตโนมัติแล้ว'
          : 'ตั้งค่าบัญชีรับเงินและเปิดการตรวจสลิปอัตโนมัติเพื่อเริ่มใช้งาน',
        setupHref: '/settings/bank-slip',
      },
      {
        name: 'ผู้ช่วย AI',
        status: aiConfigured ? 'active' : 'setup',
        detail: aiSettings.error
          ? 'ยังตรวจสอบการตั้งค่าผู้ช่วย AI ไม่ได้'
          : aiConfigured
            ? 'เปิดใช้งานผู้ช่วย AI แล้ว'
            : 'ตั้งค่าและเปิดใช้งานผู้ช่วย AI เพื่อเริ่มตอบลูกค้า',
        setupHref: '/chatbot/conversations',
      },
      {
        name: 'การเชื่อมต่อเพจ',
        status: setup.pageConfigured ? 'active' : 'setup',
        detail: setup.pageConfigured
          ? 'เชื่อมต่อเพจและบันทึกข้อมูลการเข้าใช้งานแล้ว'
          : 'เลือกเพจและเชื่อมต่อบัญชีเพื่อเริ่มใช้งาน',
        setupHref: setup.pageConfigured ? '/settings' : '/select-page',
      },
      {
        name: 'ฐานข้อมูลร้านค้า',
        status: databaseConfigured ? 'active' : 'setup',
        detail: databaseConfigured
          ? 'อ่านข้อมูลร้านค้าได้แล้ว'
          : 'ข้อมูลบางส่วนยังไม่พร้อม กรุณาตรวจสอบการตั้งค่าร้านค้า',
        setupHref: '/settings',
      },
      {
        name: 'ระบบเครดิต',
        status: summary.metrics.slipCredits !== null ? 'active' : 'setup',
        detail:
          summary.metrics.slipCredits !== null
            ? 'อ่านยอดเครดิตตรวจสลิปได้แล้ว'
            : 'ตรวจสอบสิทธิ์และยอดเครดิตของร้านค้า',
        setupHref: '/billing',
      },
      {
        name: 'ระบบส่งข้อความ',
        status: setup.pageConfigured ? 'active' : 'setup',
        detail: setup.pageConfigured
          ? 'เพจพร้อมสำหรับการส่งและรับข้อความ'
          : 'เชื่อมต่อเพจก่อนเริ่มรับและส่งข้อความ',
        setupHref: setup.pageConfigured ? '/settings' : '/select-page',
      },
    ],
  }
}
