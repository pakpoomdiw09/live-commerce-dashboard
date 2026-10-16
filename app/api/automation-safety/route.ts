import {NextRequest, NextResponse} from 'next/server'
import {slipBankTenant} from '@/lib/slip-bank-server'
import {automationSafetyEnabled, automationStopped} from '@/lib/automation-safety'
import {InboxError, inboxError, checkRpc} from '@/lib/inbox-server'

export async function GET(req: NextRequest) {
  try {
    const {db, tenantId, owner} = await slipBankTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '')
    if (!automationSafetyEnabled()) return NextResponse.json({enabled: false, canManage: false}, {headers: {'Cache-Control': 'private, no-store'}})
    return NextResponse.json({enabled: true, stopped: await automationStopped(db, tenantId), canManage: owner}, {headers: {'Cache-Control': 'private, no-store'}})
  } catch (error) { return inboxError(error) }
}
export async function PATCH(req: NextRequest) {
  try {
    const {db, tenantId, actor} = await slipBankTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '', true)
    if (!automationSafetyEnabled()) throw new InboxError('ระบบหยุดฉุกเฉินรายร้านยังไม่เปิดใช้งาน', 409)
    const input = await req.json().catch(() => null)
    if (typeof input?.stopped !== 'boolean' || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) throw new InboxError('กรุณาระบุสถานะและเหตุผลไม่เกิน 500 ตัวอักษร')
    if (!input.stopped && process.env.AGENT_CONTROL_KILL_SWITCH === 'true') throw new InboxError('ผู้ดูแลเซิร์ฟเวอร์ยังหยุด AI ฉุกเฉินอยู่', 409)
    const result = await db.rpc('set_tenant_automation_stop', {p_tenant: tenantId, p_actor: actor.id, p_stopped: input.stopped, p_reason: input.reason.trim()})
    checkRpc(result.error)
    return NextResponse.json({ok: true, stopped: input.stopped})
  } catch (error) { return inboxError(error) }
}
