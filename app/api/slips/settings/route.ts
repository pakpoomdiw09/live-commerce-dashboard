import { NextResponse, type NextRequest } from 'next/server'
import { slipBankTenant } from '@/lib/features/slips/slip-bank-server'
import { InboxError, inboxError } from '@/lib/features/inbox/inbox-server'
import {
  DEFAULT_SLIP_CONFIRMATION_TEMPLATE,
  normalizeSlipConfirmationTemplate,
} from '@/lib/features/slips/slip-confirmation-template'
import {
  isMissingSlipSettings,
  readSlipConfirmationTemplate,
} from '@/lib/features/slips/slip-confirmation-settings'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

function settingsError(error: unknown) {
  if (isMissingSlipSettings(error as { code?: string }))
    return NextResponse.json(
      { error: 'กรุณาติดตั้ง supabase/slip-confirmation-template.sql ก่อนบันทึกข้อความ' },
      { status: 503, headers },
    )
  return inboxError(error)
}

export async function GET(req: NextRequest) {
  try {
    const { db, tenantId, owner } = await slipBankTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
    )
    const template = await readSlipConfirmationTemplate(db, tenantId)
    return NextResponse.json(
      {
        slip_confirmation_template: template ?? DEFAULT_SLIP_CONFIRMATION_TEMPLATE,
        canManage: owner,
      },
      { headers },
    )
  } catch (error) {
    return settingsError(error)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { db, tenantId } = await slipBankTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
      true,
    )
    if (
      req.headers.get('sec-fetch-site') === 'cross-site' ||
      (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin)
    )
      throw new InboxError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น', 403)
    let input: unknown
    try {
      const raw = await req.text()
      if (raw.length > 16000) throw new Error('too large')
      input = JSON.parse(raw)
    } catch {
      throw new InboxError('ข้อมูลข้อความไม่ถูกต้อง')
    }
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => key !== 'slip_confirmation_template') ||
      !Object.hasOwn(input, 'slip_confirmation_template')
    )
      throw new InboxError('กรุณาระบุเฉพาะ slip_confirmation_template')
    let template: string | null
    try {
      template = normalizeSlipConfirmationTemplate(
        (input as { slip_confirmation_template: unknown }).slip_confirmation_template,
      )
    } catch (error) {
      throw new InboxError(error instanceof Error ? error.message : 'ข้อความไม่ถูกต้อง')
    }
    const saved = await db.from('slip_settings').upsert(
      {
        tenant_id: tenantId,
        slip_confirmation_template: template,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    )
    if (saved.error) throw saved.error
    return NextResponse.json(
      { slip_confirmation_template: template ?? DEFAULT_SLIP_CONFIRMATION_TEMPLATE },
      { headers },
    )
  } catch (error) {
    return settingsError(error)
  }
}
