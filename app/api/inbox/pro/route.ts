import { NextRequest, NextResponse } from 'next/server'
import { inboxTenant, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await inboxTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '')
    if (process.env.SMART_INBOX_PRO_ENABLED !== 'true')
      return NextResponse.json(
        { enabled: false },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    const result = await db.rpc('inbox_pro_overview', { p_tenant: tenantId })
    if (result.error) throw new InboxError('รายงานยังไม่พร้อมใช้งาน กรุณาตรวจการติดตั้งระบบ', 503)
    return NextResponse.json(
      { enabled: true, ...result.data },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
