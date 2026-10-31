import { createHash, randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import {
  receivingCodeTenant,
  decodeReceivingQr,
} from '@/lib/features/payments/payment-codes-server'
import { bankAccountError } from '@/lib/features/banking/bank-accounts'
import { bankAccountDraft, type BankAccountDraft } from '@/lib/features/banking/bank-account-draft'
import { validateBankQrPayload } from '@/lib/features/banking/bank-qr-upload'
import { InboxError, inboxError } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'
import {
  acquireUploadSlot,
  readUploadForm,
  validateUploadImage,
  UploadError,
  UPLOAD_FILE_BYTES,
} from '@/lib/upload-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const bucket = 'bank-receiving-qr'
const headers = { 'Cache-Control': 'private, no-store' }
const answer = (result: { id: string }) =>
  NextResponse.json({ ok: true, id: result.id }, { headers })

function errorResponse(error: unknown) {
  const code = (error as { code?: string } | null)?.code
  if (['42P01', 'PGRST205', 'PGRST202'].includes(code ?? '')) {
    console.error('[bank-account/save] install bank-account-combined-save.sql', { code })
    return NextResponse.json(
      { error: 'ระบบบันทึกบัญชียังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ' },
      { status: 503, headers },
    )
  }
  if (error instanceof UploadError)
    return NextResponse.json({ error: error.message }, { status: error.status, headers })
  if (code === '40001')
    return inboxError(new InboxError('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก', 409))
  if (code === '23505')
    return inboxError(new InboxError('บัญชีนี้มีอยู่ในร้านแล้ว กรุณาแก้ไขบัญชีเดิม', 409))
  if (code === 'P0002') return inboxError(new InboxError('ไม่พบบัญชีในร้านนี้', 404))
  if (code === '22023')
    return inboxError(new InboxError('กรุณาตรวจสอบข้อมูลและแนบ QR ของบัญชีที่เลือก'))
  return inboxError(error)
}

export async function POST(req: NextRequest) {
  let release: (() => void) | undefined
  try {
    const { db, tenantId, actor } = await receivingCodeTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
    )
    if (
      req.headers.get('sec-fetch-site') === 'cross-site' ||
      (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin)
    )
      throw new InboxError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น', 403)
    release = acquireUploadSlot(`${tenantId}:${actor.id}`)
    const form = await readUploadForm(req, {
      file: UPLOAD_FILE_BYTES,
      id: 36,
      bank_code: 32,
      account_name: 480,
      account_number: 60,
      is_active: 5,
      original: 1024,
      version: 16,
      requestId: 36,
    })
    const id = String(form.get('id') ?? ''),
      requestId = String(form.get('requestId') ?? ''),
      active = form.get('is_active'),
      versionText = String(form.get('version') ?? '')
    if (
      (id && !UUID.test(id)) ||
      !UUID.test(requestId) ||
      !['true', 'false'].includes(String(active))
    )
      throw new InboxError('ข้อมูลบัญชีไม่ถูกต้อง')
    const draft = bankAccountDraft({
      bank_code: String(form.get('bank_code') ?? ''),
      account_name: String(form.get('account_name') ?? ''),
      account_number: String(form.get('account_number') ?? ''),
      is_active: active === 'true',
    })
    const problem = bankAccountError(draft.bank_code, draft.account_name, draft.account_number)
    if (problem) throw new InboxError(problem)
    const version = Number(versionText)
    if (!/^\d+$/.test(versionText) || !Number.isSafeInteger(version) || version > 2147483646)
      throw new InboxError('ข้อมูลเวอร์ชันไม่ถูกต้อง')
    let original: BankAccountDraft | null
    try {
      const value = JSON.parse(String(form.get('original') ?? 'null'))
      if (value === null) original = null
      else {
        if (
          typeof value.bank_code !== 'string' ||
          typeof value.account_name !== 'string' ||
          typeof value.account_number !== 'string' ||
          typeof value.is_active !== 'boolean'
        )
          throw new Error('invalid')
        original = bankAccountDraft(value)
      }
    } catch {
      throw new InboxError('ข้อมูลบัญชีเดิมไม่ถูกต้อง กรุณาโหลดข้อมูลใหม่')
    }
    if (!!id !== !!original) throw new InboxError('กรุณาโหลดข้อมูลบัญชีใหม่')
    const file = form.get('file')
    let bytes: Buffer | null = null
    if (file instanceof File) {
      if (!['image/png', 'image/jpeg'].includes(file.type))
        throw new InboxError('กรุณาแนบรูป PNG หรือ JPG')
      bytes = await validateUploadImage(file)
    }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          id: id || null,
          draft,
          original,
          version,
          image: bytes ? createHash('sha256').update(bytes).digest('hex') : null,
        }),
      )
      .digest('hex')
    const cached = await db
      .from('bank_account_save_requests')
      .select('actor_id,fingerprint,result')
      .eq('tenant_id', tenantId)
      .eq('request_id', requestId)
      .maybeSingle()
    if (cached.error) throw cached.error
    if (cached.data) {
      if (cached.data.actor_id !== actor.id || cached.data.fingerprint !== fingerprint)
        throw new InboxError('คำขอนี้ถูกใช้บันทึกแล้ว กรุณาโหลดข้อมูลใหม่', 409)
      return answer(cached.data.result)
    }
    const accountId = id || randomUUID()
    let previous: {
      image_path: string
      version: number
      bank_code_snapshot: string
      account_number_snapshot: string
    } | null = null
    if (id) {
      const account = await db
        .from('bank_accounts')
        .select('id,bank_code,account_name,account_number,is_active')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .maybeSingle()
      if (account.error) throw account.error
      if (!account.data) throw new InboxError('ไม่พบบัญชีในร้านนี้', 404)
      if (JSON.stringify(bankAccountDraft(account.data)) !== JSON.stringify(original))
        throw new InboxError('ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่', 409)
      const qr = await db
        .from('bank_receiving_qr')
        .select('image_path,version,bank_code_snapshot,account_number_snapshot')
        .eq('tenant_id', tenantId)
        .eq('account_id', id)
        .maybeSingle()
      if (qr.error) throw qr.error
      previous = qr.data
    }
    if ((previous?.version ?? 0) !== version)
      throw new InboxError('รูป QR เปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่', 409)
    if (
      previous &&
      !bytes &&
      (previous.bank_code_snapshot !== draft.bank_code ||
        previous.account_number_snapshot !== draft.account_number)
    )
      throw new InboxError('กรุณาแนบ QR Code ของบัญชีใหม่')
    let path: string | null = null,
      payload: string | null = null
    if (bytes && file instanceof File) {
      try {
        payload = validateBankQrPayload(await decodeReceivingQr(file))
      } catch (error) {
        throw new InboxError(error instanceof Error ? error.message : 'อ่าน QR ไม่สำเร็จ')
      }
      path = `${tenantId}/${accountId}/${randomUUID()}.${file.type === 'image/png' ? 'png' : 'jpg'}`
      const uploaded = await db.storage
        .from(bucket)
        .upload(path, bytes, { contentType: file.type, upsert: false })
      if (uploaded.error) throw new InboxError('อัปโหลดรูป QR ไม่สำเร็จ กรุณาลองใหม่', 503)
    }
    const saved = await db.rpc('save_bank_account_with_qr', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_account: accountId,
      p_create: !id,
      p_data: draft,
      p_original: original,
      p_path: path,
      p_payload: payload,
      p_version: version,
      p_request: requestId,
      p_fingerprint: fingerprint,
    })
    const remove = async (value: string) => {
      if (!value.startsWith(`${tenantId}/`)) return
      try {
        const result = await db.storage.from(bucket).remove([value])
        if (result.error) console.warn('[bank-account/save] image cleanup deferred')
      } catch {
        console.warn('[bank-account/save] image cleanup deferred')
      }
    }
    if (saved.error) {
      if (path && (/^[0-9A-Z]{5}$/.test(saved.error.code ?? '') || saved.error.code === 'PGRST202'))
        await remove(path)
      throw saved.error
    }
    if (!saved.data?.id) throw new InboxError('ไม่สามารถยืนยันผลการบันทึก กรุณาลองอีกครั้ง', 503)
    if (path && path !== saved.data.image_path) await remove(path) // Concurrent replay used the first committed image.
    if (previous?.image_path && previous.image_path !== saved.data.image_path)
      await remove(previous.image_path)
    return answer(saved.data)
  } catch (error) {
    return errorResponse(error)
  } finally {
    release?.()
  }
}
