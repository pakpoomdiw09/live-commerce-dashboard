import { NextRequest, NextResponse } from 'next/server'
import { inboxCustomer, inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (
      req.headers.get('sec-fetch-site') === 'cross-site' ||
      (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin)
    )
      throw new InboxError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น', 403)
    const { db, customer } = await inboxCustomer(req, (await params).id)
    const result = await db.rpc('expire_inbox_automation', { p_customer: customer.id })
    checkRpc(result.error)
    return NextResponse.json(
      { changed: result.data === true },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
