import Link from 'next/link'
import {supabaseServer} from '@/lib/supabase/server'
import type {TenantRow} from '@/lib/types'

/** Session/RLS reads only. Unknown counts are never displayed as a fake zero. */
export async function ActionRequired({tenant}: {tenant: TenantRow}) {
  if (process.env.SNAPBOT_SAFETY_ENABLED !== 'true') return null
  const db = await supabaseServer()
  const [slips, chats] = await Promise.all([
    db.from('slips').select('id', {count: 'exact', head: true}).eq('tenant_id', tenant.id).is('approved_at', null).in('status', ['pending', 'amount_mismatch', 'wrong_receiver', 'fake', 'error']),
    db.from('customers').select('id', {count: 'exact', head: true}).eq('tenant_id', tenant.id).eq('bot_enabled', false).is('assigned_user_id', null).not('handover_at', 'is', null).eq('conversation_status', 'open'),
  ])
  const credits = Math.max(0, tenant.slip_quota + tenant.slip_quota_credits - tenant.slip_used)
  const creditKnown = Number.isFinite(credits)
  const linked = !!tenant.page_id && tenant.page_token_set
  return <section aria-labelledby="action-required-title" className="rounded-2xl border border-orange-200 bg-white p-5">
    <h2 id="action-required-title" className="font-bold">งานที่ต้องจัดการทันที</h2>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Link href="/slips" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-900">สลิปรอตรวจหรือมีความเสี่ยง<strong className="mt-2 block">{slips.error || slips.count === null ? 'ยังอ่านจำนวนไม่ได้' : `${slips.count} รายการ`}</strong></Link>
      <Link href="/inbox" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">แชทรอแอดมินรับช่วง<strong className="mt-2 block">{chats.error || chats.count === null ? 'ยังอ่านจำนวนไม่ได้' : `${chats.count} แชท`}</strong></Link>
      <Link href="/billing" className="rounded-xl bg-orange-50 p-4 text-sm text-orange-900">เครดิตตรวจสลิป<strong className="mt-2 block">{!creditKnown ? 'ยังอ่านเครดิตไม่ได้' : credits <= 10 ? `ใกล้หมด · เหลือ ${credits}` : `เหลือ ${credits}`}</strong></Link>
      <Link href="/settings" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-800">การเชื่อมต่อเพจ<strong className="mt-2 block">{linked ? 'บันทึกการเชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}</strong>{linked && <span className="mt-1 block text-xs">ยังไม่ได้ตรวจสถานะ API สด</span>}</Link>
    </div>
  </section>
}
