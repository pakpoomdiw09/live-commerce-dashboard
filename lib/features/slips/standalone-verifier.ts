import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireFeature } from '@/lib/feature-access'
import {
  slipVerificationProvider,
  usesCentralZwizQuota,
  verifyWithSlipOK,
} from '@/lib/features/slips/slipok'
import { downloadVisionImage, validateVisionFile } from '@/lib/features/vision/vision-image'
import {
  standaloneDuplicate,
  standaloneFailure,
  validateStandaloneSlip,
  type StandaloneSlipResult,
} from '@/lib/features/slips/standalone-slip'

export type StandaloneSlipInput = {
  tenantId: string
  slipImageUrl?: string
  file?: File
  expectedReceivingAccount?: string
  maxAgeHours?: number
  customerId?: string
  messageId?: string
}

/** Verify a standalone proof without touching orders, stock or customer payment status. */
export async function processStandaloneSlip(
  db: SupabaseClient,
  input: StandaloneSlipInput,
): Promise<StandaloneSlipResult> {
  let charged = false
  let providerReturned = false
  const refund = async () => {
    try {
      const result = await db.rpc('refund_slip_credit', { p_tenant: input.tenantId })
      if (result.error) throw result.error
    } catch (error) {
      console.error('[standalone-slip] credit refund failed', {
        code: (error as { code?: string })?.code,
      })
    }
  }
  try {
    const maxAgeHours = input.maxAgeHours ?? 24
    if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 24)
      return standaloneFailure(
        'invalid_configuration',
        'กำหนดอายุสลิปได้มากกว่า 0 และไม่เกิน 24 ชั่วโมง',
      )
    if (!!input.file === !!input.slipImageUrl)
      return standaloneFailure('invalid_image', 'กรุณาส่งรูปสลิปหนึ่งรูปเพื่อตรวจสอบ')
    if (
      input.expectedReceivingAccount !== undefined &&
      !/^\d{3,15}$/.test(input.expectedReceivingAccount.replace(/[\s-]/g, ''))
    )
      return standaloneFailure('invalid_configuration', 'เลขบัญชีรับเงินสำหรับตรวจสลิปไม่ถูกต้อง')
    try {
      await requireFeature(db, input.tenantId, 'slip_auto_pilot')
      console.info('[HAS_SLIP_ACCESS]', {
        tenantId: input.tenantId,
        feature: 'slip_auto_pilot',
        allowed: true,
      })
    } catch (error) {
      console.error('[HAS_SLIP_ACCESS]', {
        tenantId: input.tenantId,
        feature: 'slip_auto_pilot',
        allowed: false,
        code: (error as { code?: string } | null)?.code ?? 'FEATURE_LOOKUP_FAILED',
      })
      return standaloneFailure(
        'feature_locked',
        'ร้านค้ายังไม่ได้เปิดสิทธิ์ตรวจสอบสลิปอัตโนมัติ',
      )
    }
    const tenant = await db
      .from('tenants')
      .select('id,account_number,bank_code')
      .eq('id', input.tenantId)
      .eq('is_active', true)
      .maybeSingle()
    if (tenant.error) throw tenant.error
    if (!tenant.data)
      return standaloneFailure('inactive_tenant', 'ร้านค้านี้ยังไม่เปิดใช้งานการตรวจสลิป')
    const accounts = await db
      .from('bank_accounts')
      .select('bank_code,account_number,is_active')
      .eq('tenant_id', input.tenantId)
    if (accounts.error) throw accounts.error
    const receivingAccounts = (accounts.data ?? []).filter((account) => account.is_active)
    if (accounts.data?.length && !receivingAccounts.length && !input.expectedReceivingAccount)
      return standaloneFailure(
        'inactive_receivers',
        'ร้านค้ายังไม่ได้เปิดใช้งานบัญชีรับเงิน กรุณารอแอดมินตรวจสอบ',
      )
    if (!accounts.data?.length && tenant.data.account_number && tenant.data.bank_code)
      receivingAccounts.push({
        bank_code: tenant.data.bank_code,
        account_number: tenant.data.account_number,
        is_active: true,
      })
    let file: File
    let imageHost: string | null = null
    if (input.slipImageUrl) {
      try {
        imageHost = new URL(input.slipImageUrl).host
      } catch {
        imageHost = 'invalid_url'
      }
    }
    try {
      console.info('[DOWNLOAD_IMAGE]', {
        stage: 'started',
        host: input.file ? null : imageHost,
        source: input.file ? 'upload' : 'messenger_cdn',
      })
      file = input.file ?? (await downloadVisionImage(input.slipImageUrl!))
      await validateVisionFile(file)
      console.info('[DOWNLOAD_IMAGE]', {
        stage: 'completed',
        host: input.file ? null : imageHost,
        bytes: file.size,
        contentType: file.type,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const errorCode = /^[A-Z0-9_]{1,80}$/.test(message)
        ? message
        : 'DOWNLOAD_OR_VALIDATION_FAILED'
      console.error('[DOWNLOAD_IMAGE]', {
        stage: 'failed',
        host: input.file ? null : imageHost,
        code: errorCode,
      })
      return standaloneFailure(
        'invalid_image',
        'ดาวน์โหลดหรืออ่านรูปสลิปไม่ได้ กรุณาส่งรูป JPG, PNG หรือ WebP ที่ชัดเจนอีกครั้ง',
      )
    }
    const imageHash = createHash('sha256')
      .update(Buffer.from(await file.arrayBuffer()))
      .digest('hex')
    // Check migration availability and avoid charging for the same accepted photo again.
    const previous = await db
      .from('standalone_slips')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('image_sha256', imageHash)
      .limit(1)
      .maybeSingle()
    if (previous.error)
      return standaloneFailure(
        'ledger_unavailable',
        'ระบบบันทึกสลิปยังไม่พร้อม กรุณารอแอดมินตรวจสอบ',
      )
    if (previous.data) return standaloneDuplicate()
    const centralQuota = usesCentralZwizQuota()
    console.info('[standalone-slip] provider quota mode', {
      tenantId: input.tenantId,
      provider: centralQuota ? 'zwiz' : 'legacy_or_unsupported',
      tenantCreditsRequired: !centralQuota,
    })
    if (!centralQuota) {
      const credit = await db.rpc('consume_slip_credit', { p_tenant: input.tenantId })
      if (credit.error) throw credit.error
      if (credit.data !== true)
        return standaloneFailure(
          'no_credit',
          'ขณะนี้ร้านไม่สามารถตรวจสลิปอัตโนมัติได้ กรุณารอแอดมินตรวจสอบ',
        )
      charged = true
    }
    const zwizAccounts = [
      ...receivingAccounts.map((account) => ({
        accountNo: account.account_number,
        bankCode: account.bank_code,
      })),
      ...(input.expectedReceivingAccount &&
      !receivingAccounts.some(
        (account) =>
          account.account_number.replace(/[\s-]/g, '') ===
          input.expectedReceivingAccount!.replace(/[\s-]/g, ''),
      )
        ? [{ accountNo: input.expectedReceivingAccount, bankCode: 'promptpay' }]
        : []),
    ]
    const verified = await verifyWithSlipOK({
      file,
      log: true,
      bankAccounts: zwizAccounts,
    })
    const provider = slipVerificationProvider() ?? 'unknown'
    const providerDiagnostic =
      verified.providerDiagnostic ??
      (verified.providerFault
        ? {
            provider,
            stage: 'provider_failure',
            httpStatus: null,
            code: null,
            message: 'Selected provider returned a verification error without structured diagnostics',
          }
        : undefined)
    const resultLog = {
      provider,
      verdict: verified.verdict,
      providerFault: verified.providerFault === true,
      stage: providerDiagnostic?.stage ?? 'verification_result',
      httpStatus: providerDiagnostic?.httpStatus ?? null,
      providerCode: providerDiagnostic?.code ?? null,
      providerMessage: providerDiagnostic?.message ?? null,
      amountPresent: Number.isFinite(verified.amount),
      hasTransRef: Boolean(verified.transRef),
    }
    const resultTag = provider === 'zwiz' ? '[CALL_ZWIZ_RESULT]' : '[CALL_SLIP_PROVIDER_RESULT]'
    if (verified.providerFault) console.error(resultTag, resultLog)
    else console.info(resultTag, resultLog)
    providerReturned = true
    if (verified.providerFault) {
      await refund()
      charged = false
    }
    const result = validateStandaloneSlip(verified, receivingAccounts, {
      expectedReceivingAccount: input.expectedReceivingAccount,
      maxAgeHours,
    })
    if (!result.success) {
      if (verified.providerFault && providerDiagnostic) {
        const failure = await db
          .from('slips')
          .insert({
            tenant_id: input.tenantId,
            customer_id: input.customerId ?? null,
            message_id: input.messageId ?? null,
            status: 'error',
            note: result.message,
            raw: { provider_error: providerDiagnostic },
            verified_at: new Date().toISOString(),
          })
          .select('id')
          .maybeSingle()
        if (failure.error) {
          console.error('[standalone-slip] provider failure history insert failed', {
            code: failure.error.code,
          })
        } else {
          console.info('[standalone-slip] provider failure recorded', {
            slipId: failure.data?.id ?? null,
            stage: providerDiagnostic.stage,
            httpStatus: providerDiagnostic.httpStatus,
            providerCode: providerDiagnostic.code,
          })
        }
        return { ...result, providerDiagnostic }
      }
      return result
    }
    const d = result.data
    const saved = await db
      .from('standalone_slips')
      .insert({
        tenant_id: input.tenantId,
        trans_ref: d.transRef,
        amount: d.amount,
        sender_name: d.sender,
        sender_bank: d.senderBank,
        receiver_name: d.receiver,
        receiver_account: d.receiverAccount,
        trans_timestamp: d.transTimestamp,
        raw_payload: verified.raw,
        image_sha256: imageHash,
        customer_id: input.customerId ?? null,
        message_id: input.messageId ?? null,
      })
      .select('id')
      .single()
    if (saved.error?.code === '23505') return standaloneDuplicate()
    if (saved.error) {
      console.error('[standalone-slip] ledger insert failed', { code: saved.error.code })
      return standaloneFailure(
        'ledger_unavailable',
        'ตรวจสลิปแล้วแต่บันทึกประวัติไม่ได้ กรุณารอแอดมินตรวจสอบ ไม่ต้องโอนซ้ำ',
      )
    }
    if (!saved.data?.id) {
      console.error('[standalone-slip] ledger insert failed', {
        code: 'NO_ROW',
      })
      return standaloneFailure(
        'ledger_unavailable',
        'ตรวจสลิปแล้วแต่บันทึกประวัติไม่ได้ กรุณารอแอดมินตรวจสอบ ไม่ต้องโอนซ้ำ',
      )
    }
    return {
      ...result,
      slipId: saved.data.id,
    }
  } catch (error) {
    if (charged && !providerReturned) await refund()
    console.error('[standalone-slip] verification unavailable', {
      code: (error as { code?: string })?.code,
    })
    return standaloneFailure('unavailable', 'ระบบตรวจสลิปยังไม่พร้อม กรุณารอแอดมินตรวจสอบ')
  }
}
