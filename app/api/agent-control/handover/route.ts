import { NextRequest, NextResponse } from 'next/server'
import {
  agentControlTenant,
  agentHandoverCustomers,
} from '@/lib/features/agents/agent-control-server'
import { inboxError } from '@/lib/features/inbox/inbox-server'
export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await agentControlTenant(
      req,
      req.nextUrl.searchParams.get('tenantId') ?? '',
      false,
      true,
    )
    return NextResponse.json(
      { customers: await agentHandoverCustomers(db, tenantId) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
