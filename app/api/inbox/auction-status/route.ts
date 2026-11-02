import { NextRequest, NextResponse } from 'next/server'
import { inboxTenant, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await inboxTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '')
    const ids = [
      ...new Set((req.nextUrl.searchParams.get('customers') ?? '').split(',').filter(Boolean)),
    ]
    if (ids.length > 50 || ids.some((id) => !UUID.test(id)))
      throw new InboxError('รหัสลูกค้าไม่ถูกต้อง')
    const result = ids.length
      ? await db.rpc('auction_inbox_status', { p_tenant: tenantId, p_customers: ids })
      : { data: [], error: null }
    // Older shops without the optional auction migration keep their existing inbox.
    if (result.error && !['42883', 'PGRST202'].includes(result.error.code)) throw result.error
    return NextResponse.json(
      { statuses: result.data ?? [] },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
