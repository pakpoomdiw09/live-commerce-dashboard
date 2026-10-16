import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { getProviderQuota } from '@/lib/provider-quota'

export async function GET() {
  const actor = await getActor()
  if (!actor || actor.kind !== 'user' || !actor.isPlatformAdmin) return NextResponse.json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, { status: actor ? 403 : 401 })
  return NextResponse.json(await getProviderQuota(), { headers: { 'Cache-Control': 'no-store' } })
}
