import { NextRequest, NextResponse } from 'next/server'
import {
  receivingCodeTenant,
  createReceivingQr,
  decodeReceivingQr,
} from '@/lib/features/payments/payment-codes-server'
import { codeMatchesAccount, receivingAmount } from '@/lib/features/payments/payment-codes-core'
import { validateQrDesign } from '@/lib/features/payments/qr-design'
import { validateVisionFile } from '@/lib/features/vision/vision-image'
import { InboxError, inboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'
import sharp from 'sharp'
export const runtime = 'nodejs'
const bucket = 'payment-qr-assets'
async function scope(req: NextRequest) {
  const result = await receivingCodeTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '')
  if (process.env.QR_PAYMENT_DESIGNER_ENABLED !== 'true')
    throw new InboxError('เครื่องมือตกแต่ง QR ยังไม่เปิดใช้งาน', 409)
  return result
}
export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await scope(req),
      id = req.nextUrl.searchParams.get('accountId') ?? ''
    if (!UUID.test(id)) throw new InboxError('กรุณาเลือกบัญชี')
    const account = await db
      .from('bank_accounts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle()
    if (account.error) throw account.error
    if (!account.data) throw new InboxError('ไม่พบบัญชี', 404)
    const result = await db
      .from('bank_qr_designs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('account_id', id)
      .maybeSingle()
    if (result.error) throw result.error
    const row = result.data
    if (row) {
      try {
        codeMatchesAccount(row.payload, account.data)
        if (row.recipient_snapshot !== account.data.account_number) throw Error()
      } catch {
        return NextResponse.json(
          { design: { ...row, payload: null }, stale: true },
          { headers: { 'Cache-Control': 'private, no-store' } },
        )
      }
    }
    const asset = req.nextUrl.searchParams.get('asset')
    if (asset) {
      if (!['original', 'logo'].includes(asset)) throw new InboxError('ชนิดรูปไม่ถูกต้อง')
      const path = asset === 'original' ? row?.original_path : row?.logo_path
      if (!path || !path.startsWith(`${tenantId}/${id}/`)) throw new InboxError('ไม่พบรูป', 404)
      const download = await db.storage.from(bucket).download(path)
      if (download.error) throw download.error
      return new NextResponse(download.data, {
        headers: {
          'Content-Type': download.data.type,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    return NextResponse.json({ design: row }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return inboxError(e)
  }
}
export async function POST(req: NextRequest) {
  try {
    const { db, tenantId, actor } = await scope(req)
    if (
      req.headers.get('sec-fetch-site') === 'cross-site' ||
      (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin)
    )
      throw new InboxError('ไม่อนุญาตเว็บไซต์อื่น', 403)
    if (Number(req.headers.get('content-length') ?? 0) > 11 * 1024 * 1024)
      throw new InboxError('ไฟล์ใหญ่เกินกำหนด', 413)
    const reader = req.body?.getReader()
    if (!reader || !req.headers.get('content-type')?.startsWith('multipart/form-data'))
      throw new InboxError('กรุณาส่งรูปแบบฟอร์มที่ถูกต้อง')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.length
        if (size > 11 * 1024 * 1024) throw new InboxError('ไฟล์ใหญ่เกินกำหนด', 413)
        chunks.push(part.value)
      }
    } finally {
      await reader.cancel()
    }
    const bounded = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'Content-Type': req.headers.get('content-type')! },
      body: Buffer.concat(chunks),
    })
    const form = await bounded.formData(),
      id = String(form.get('accountId') ?? ''),
      version = Number(form.get('version'))
    if (
      !UUID.test(id) ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      form.get('confirmed') !== 'true'
    )
      throw new InboxError('กรุณาตรวจสอบและยืนยันข้อมูล')
    const design = validateQrDesign(JSON.parse(String(form.get('design'))))
    const account = await db
      .from('bank_accounts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle()
    if (account.error) throw account.error
    if (!account.data) throw new InboxError('ไม่พบบัญชี', 404)
    const previous = await db
      .from('bank_qr_designs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('account_id', id)
      .maybeSingle()
    if (previous.error) throw previous.error
    let amount = receivingAmount(form.get('amount')),
      payload: string
    const original = form.get('original'),
      logo = form.get('logo'),
      regenerate = form.get('regenerate') === 'true'
    if (original instanceof File && original.size) {
      payload = await decodeReceivingQr(original)
      amount = codeMatchesAccount(payload, account.data).amountSatang
    } else if (previous.data && !regenerate) {
      payload = previous.data.payload
      amount = codeMatchesAccount(payload, account.data).amountSatang
    } else payload = createReceivingQr(account.data, amount)
    let originalPath = regenerate ? null : (previous.data?.original_path ?? null),
      logoPath = previous.data?.logo_path ?? null
    const uploaded: string[] = []
    try {
      for (const [kind, file] of [
        ['original', original],
        ['logo', logo],
      ] as const) {
        if (!(file instanceof File) || !file.size) continue
        const bytes = await validateVisionFile(file)
        // Bound decompression for both logos and QR originals; preserve original bytes.
        await sharp(bytes, { limitInputPixels: 16000000, animated: false })
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer()
        const path = `${tenantId}/${id}/${crypto.randomUUID()}-${kind}`
        const result = await db.storage
          .from(bucket)
          .upload(path, bytes, { contentType: file.type, upsert: false })
        if (result.error) throw result.error
        uploaded.push(path)
        if (kind === 'original') originalPath = path
        else logoPath = path
      }
      const saved = await db.rpc('save_bank_qr_design', {
        p_tenant: tenantId,
        p_actor: actor.id,
        p_account: id,
        p_recipient: account.data.account_number,
        p_payload: payload,
        p_amount: amount,
        p_original: originalPath,
        p_logo: logoPath,
        p_design: design,
        p_version: version,
      })
      if (saved.error?.code === '40001')
        throw new InboxError('ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดหน้าใหม่ก่อนบันทึก', 409)
      checkRpc(saved.error)
    } catch (e) {
      if (uploaded.length) await db.storage.from(bucket).remove(uploaded)
      throw e
    }
    return NextResponse.json({ ok: true, paymentVerified: false })
  } catch (e) {
    return inboxError(e)
  }
}
