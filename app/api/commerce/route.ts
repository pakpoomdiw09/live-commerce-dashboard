import { NextRequest, NextResponse } from 'next/server'
import {
  commerceScope,
  commerceSnapshot,
  commerceMutation,
  commerceResponse,
  sameOrigin,
} from '@/lib/features/commerce/commerce-server'
import { CommerceError } from '@/lib/features/commerce/commerce-core'
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(
      await commerceSnapshot(
        await commerceScope(req.nextUrl.searchParams.get('tenantId') ?? '', false, req),
        Object.fromEntries(req.nextUrl.searchParams),
      ),
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (e) {
    return commerceResponse(e)
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req)
    const raw = await req.text()
    if (Buffer.byteLength(raw, 'utf8') > 300000) throw new CommerceError('ข้อมูลยาวเกินกำหนด', 413)
    let input
    try {
      input = JSON.parse(raw)
    } catch {
      throw new CommerceError('ข้อมูลไม่ถูกต้อง')
    }
    if (!input || typeof input !== 'object') throw new CommerceError('ข้อมูลไม่ถูกต้อง')
    const scope = await commerceScope(input.tenantId, true, req)
    const rate = await scope.db.rpc('commerce_rate_limit', {
      p_bucket: `manage:${scope.tenantId}:${scope.actor.id}`,
      p_max: 90,
    })
    if (rate.error || rate.data !== true)
      throw new CommerceError('บันทึกถี่เกินไป กรุณารอสักครู่', 429)
    const result = await commerceMutation(scope, input)
    return NextResponse.json({ id: result }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return commerceResponse(e)
  }
}
