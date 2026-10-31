import { NextResponse, type NextRequest } from 'next/server'
import {
  receivingCodeTenant,
  decodeReceivingQr,
} from '@/lib/features/payments/payment-codes-server'
import { isSupportedBank, UNSUPPORTED_BANK_MESSAGE } from '@/lib/features/banking/banks'
import { UUID } from '@/lib/utils'
import { validateBankQrPayload, type BankQrAccount } from '@/lib/features/banking/bank-qr-upload'
import { InboxError, inboxError } from '@/lib/features/inbox/inbox-server'
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

function fail(error: unknown) {
  const code = (error as { code?: string } | null)?.code
  if (['42P01', 'PGRST205', 'PGRST202'].includes(code ?? '')) {
    console.error('[bank-qr] install bank-qr-upload.sql and bank-qr-per-account.sql', { code })
    return NextResponse.json(
      { error: 'ระบบบันทึก QR ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ' },
      { status: 503, headers },
    )
  }
  if (error instanceof UploadError)
    return NextResponse.json({ error: error.message }, { status: error.status, headers })
  return inboxError(error)
}

export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await receivingCodeTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
    )
    const accountId = req.nextUrl.searchParams.get('accountId') ?? ''
    if (!UUID.test(accountId)) throw new InboxError('กรุณาเลือกบัญชีธนาคาร')
    const selected = await db
      .from('bank_accounts')
      .select('id,bank_code,account_name,account_number,is_active,is_primary')
      .eq('tenant_id', tenantId)
      .eq('id', accountId)
      .maybeSingle()
    if (selected.error) throw selected.error
    if (!selected.data) throw new InboxError('ไม่พบบัญชีในร้านนี้', 404)
    const current = await db
      .from('bank_receiving_qr')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (current.error) throw current.error
    const account = selected.data as BankQrAccount
    const qr = current.data
    const hasQr = !!(
      qr &&
      account &&
      qr.account_id === account.id &&
      qr.bank_code_snapshot === account.bank_code &&
      qr.account_number_snapshot === account.account_number
    )
    if (req.nextUrl.searchParams.get('asset') === 'image') {
      if (!hasQr || !qr.image_path.startsWith(`${tenantId}/`))
        throw new InboxError('ยังไม่มีรูป QR ประจำบัญชีนี้', 404)
      const image = await db.storage.from(bucket).download(qr.image_path)
      if (image.error) throw new InboxError('โหลดรูป QR ไม่สำเร็จ กรุณาลองใหม่', 503)
      return new NextResponse(image.data, {
        headers: {
          ...headers,
          'Content-Type': image.data.type,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    return NextResponse.json({ account, hasQr, version: qr?.version ?? 0 }, { headers })
  } catch (error) {
    return fail(error)
  }
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
    const accountId = req.nextUrl.searchParams.get('accountId') ?? ''
    if (!UUID.test(accountId)) throw new InboxError('กรุณาเลือกบัญชีธนาคาร')
    const selected = await db
      .from('bank_accounts')
      .select('id,bank_code,account_name,account_number,is_active,is_primary')
      .eq('tenant_id', tenantId)
      .eq('id', accountId)
      .maybeSingle()
    if (selected.error) throw selected.error
    if (!selected.data) throw new InboxError('ไม่พบบัญชีในร้านนี้', 404)
    const account = selected.data as BankQrAccount
    if (!isSupportedBank(account.bank_code)) throw new InboxError(UNSUPPORTED_BANK_MESSAGE)
    release = acquireUploadSlot(`${tenantId}:${actor.id}`)
    const form = await readUploadForm(req, {
      file: UPLOAD_FILE_BYTES,
      version: 16,
    })
    const versionText = String(form.get('version') ?? '')
    const version = Number(versionText)
    if (!/^\d+$/.test(versionText) || !Number.isSafeInteger(version))
      throw new InboxError('กรุณาโหลดข้อมูล QR ใหม่')
    const previous = await db
      .from('bank_receiving_qr')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (previous.error) throw previous.error
    if ((previous.data?.version ?? 0) !== version)
      throw new InboxError('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก', 409)
    const file = form.get('file')
    let path: string,
      payload: string,
      uploaded = false
    if (file instanceof File && file.size) {
      if (!['image/png', 'image/jpeg'].includes(file.type))
        throw new InboxError('กรุณาเลือกรูป PNG หรือ JPG')
      const bytes = await validateUploadImage(file)
      try {
        payload = validateBankQrPayload(await decodeReceivingQr(file))
      } catch (error) {
        throw new InboxError(error instanceof Error ? error.message : 'อ่าน QR ไม่สำเร็จ')
      }
      path = `${tenantId}/${accountId}/${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : 'jpg'}`
      const stored = await db.storage
        .from(bucket)
        .upload(path, bytes, { contentType: file.type, upsert: false })
      if (stored.error)
        throw new InboxError('อัปโหลด QR ไม่สำเร็จ กรุณาตรวจสอบพื้นที่จัดเก็บแล้วลองใหม่', 503)
      uploaded = true
    } else {
      throw new InboxError('กรุณาเลือกรูป QR Code ที่ต้องการบันทึก')
    }
    const saved = await db.rpc('save_bank_account_qr', {
      p_tenant: tenantId,
      p_actor: actor.id,
      p_account: accountId,
      p_bank: account.bank_code,
      p_number: account.account_number,
      p_path: path,
      p_payload: payload,
      p_version: version,
    })
    if (saved.error) {
      // Clean up only after a definite database rejection. A network timeout may have committed.
      if (
        uploaded &&
        (/^[0-9A-Z]{5}$/.test(saved.error.code ?? '') || saved.error.code === 'PGRST202')
      )
        await db.storage.from(bucket).remove([path])
      if (saved.error.code === '40001')
        throw new InboxError('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก', 409)
      throw saved.error
    }
    if (
      previous.data?.image_path?.startsWith(`${tenantId}/`) &&
      previous.data.image_path !== path
    ) {
      try {
        const removed = await db.storage.from(bucket).remove([previous.data.image_path])
        if (removed.error) console.warn('[bank-qr] previous image cleanup deferred')
      } catch {
        console.warn('[bank-qr] previous image cleanup deferred')
      }
    }
    return NextResponse.json({ ok: true, version: saved.data }, { headers })
  } catch (error) {
    return fail(error)
  } finally {
    release?.()
  }
}
