import { singleFlight } from '@/lib/single-flight'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { paymentProAvailable } from '@/lib/features/payments/payment-pro-flags'
import { verifyCronAuth } from '@/lib/security/cron-auth'
export async function POST(req: NextRequest) {
  if (!verifyCronAuth(req))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!paymentProAvailable()) return NextResponse.json({ enabled: false, recovered: 0 })
  const result = await singleFlight(
    'cron:payment-pro',
    async () => await supabaseAdmin().rpc('recover_payment_pro'),
  )
  if (result.error)
    return NextResponse.json({ error: 'Payment Pro recovery unavailable' }, { status: 503 })
  return NextResponse.json({ enabled: true, recovered: result.data })
}
