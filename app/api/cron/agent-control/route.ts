import { singleFlight } from '@/lib/single-flight'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { agentControlAvailable } from '@/lib/features/agents/agent-control-flags'
import { verifyCronAuth } from '@/lib/security/cron-auth'
export async function POST(req: NextRequest) {
  if (!verifyCronAuth(req))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!agentControlAvailable()) return NextResponse.json({ enabled: false, recovered: 0 })
  const result = await singleFlight(
    'cron:agent-control',
    async () => await supabaseAdmin().rpc('recover_agent_jobs'),
  )
  return result.error
    ? NextResponse.json({ error: 'Recovery unavailable' }, { status: 503 })
    : NextResponse.json({ enabled: true, recovered: result.data })
}
