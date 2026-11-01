import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { canAccessTenant, getActor } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { UUID } from '@/lib/utils'

export const auctionReply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })

export async function authorizeAuction(req: NextRequest, tenantId: unknown, write = false) {
  if (!isFeatureEnabled('live_cf')) return auctionReply({ error: 'ไม่พบหน้านี้' }, 404)
  if (write && req.headers.get('origin') !== req.nextUrl.origin)
    return auctionReply({ error: 'คำขอไม่ถูกต้อง' }, 403)
  const actor = await getActor(req)
  if (
    !actor ||
    actor.kind !== 'user' ||
    typeof tenantId !== 'string' ||
    !UUID.test(tenantId) ||
    !(await canAccessTenant(actor, tenantId, 'owner'))
  )
    return auctionReply({ error: 'ไม่มีสิทธิ์จัดการการประมูลของร้านนี้' }, 403)
  return null
}

export function auctionFailure(error: unknown) {
  if (error instanceof SyntaxError) return auctionReply({ error: 'ข้อมูลคำขอไม่ถูกต้อง' }, 400)
  const code = (error as { code?: string } | null)?.code
  console.error('[auction/api] failed', {
    code: /^[A-Z0-9_]{1,80}$/i.test(code ?? '') ? code : 'AUCTION_FAILED',
  })
  if (code === '23505')
    return auctionReply({ error: 'ไลฟ์นี้มีรายการประมูลที่กำลังเปิดอยู่แล้ว' }, 409)
  return auctionReply(
    { error: 'ดำเนินการไม่สำเร็จ กรุณาตรวจสอบการติดตั้ง live-auctions.sql แล้วลองใหม่' },
    503,
  )
}
