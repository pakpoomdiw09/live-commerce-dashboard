import { NextRequest, NextResponse } from 'next/server'
import { checkout, commerceResponse } from '@/lib/commerce-server'
import { CommerceError } from '@/lib/commerce-core'
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const raw = await req.text()
    if (Buffer.byteLength(raw, 'utf8') > 20000) throw new CommerceError('ข้อมูลยาวเกินกำหนด', 413)
    let input
    try { input = JSON.parse(raw) } catch { throw new CommerceError('ข้อมูลคำสั่งซื้อไม่ถูกต้อง') }
    return NextResponse.json(await checkout(req, (await params).slug, input), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return commerceResponse(e) }
}
