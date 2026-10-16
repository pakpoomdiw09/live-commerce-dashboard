import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OverviewFilters, OverviewPoint, OverviewSlip, PremiumOverviewData } from './premium-overview-core'
import { hasFeature } from './feature-access'
import { InboxError } from './inbox-server'

type Slip = { id: string; customer_id: string | null; created_at: string; status: string; approved_at: string | null; amount: number | null; note: string | null; trans_ref: string | null }
type Customer = { id: string; display_name: string | null; last_message_at: string | null; bot_enabled: boolean; avatar_url?: string | null; unread_count?: number; assigned_user_id?: string | null }
type Message = { id: string; customer_id: string; created_at: string; body: string | null; sender: string }
type Job = { id: string; route: string; status: string; customer_id: string | null; created_at: string }
type Summary = Omit<PremiumOverviewData, 'filters' | 'health'>
type QueryResult<T> = { data: T[] | null; error: { code?: string; message: string } | null }

/** Read every page rather than silently truncating aggregates at PostgREST's row limit. */
async function rows<T>(page: (start: number, end: number) => PromiseLike<QueryResult<T>>): Promise<T[]> {
  const result: T[] = []
  for (let start = 0; ; start += 1000) {
    const response = await page(start, start + 999)
    if (response.error) throw response.error
    const batch = response.data ?? []
    result.push(...batch)
    if (batch.length < 1000) return result
  }
}

const day = (value: string) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const amount = (slip: Slip) => Number.isFinite(Number(slip.amount)) ? Math.round(Number(slip.amount) * 100) : 0
const resultOf = (slip: Slip): OverviewSlip['result'] => {
  if (slip.status === 'valid' || (slip.approved_at && ['amount_mismatch', 'wrong_receiver', 'fake', 'error'].includes(slip.status))) return 'passed'
  if (['pending', 'amount_mismatch', 'wrong_receiver'].includes(slip.status)) return 'pending'
  return slip.status === 'error' ? 'error' : 'rejected'
}

/** Pure aggregation shared by direct-table loading and isolated regression tests. */
export function aggregateOverviewSlips(slips: Slip[], customers: Customer[], filters: OverviewFilters) {
  const current = slips.filter(slip => (!filters.from || Date.parse(slip.created_at) >= Date.parse(filters.from)) && Date.parse(slip.created_at) < Date.parse(filters.to))
  const previous = filters.previousFrom && filters.from ? slips.filter(slip => Date.parse(slip.created_at) >= Date.parse(filters.previousFrom!) && Date.parse(slip.created_at) < Date.parse(filters.from!)) : null
  const names = new Map(customers.map(customer => [customer.id, customer.display_name]))
  const results = { passed: 0, pending: 0, rejected: 0, error: 0 }
  for (const slip of current) results[resultOf(slip)]++
  const passed = (items: Slip[]) => items.filter(slip => resultOf(slip) === 'passed')
  const total = (items: Slip[]) => passed(items).reduce((sum, slip) => sum + amount(slip), 0) / 100
  const bucket: 'day' | 'month' = filters.from ? 'day' : 'month'
  const key = (value: string) => bucket === 'day' ? day(value) : day(value).slice(0, 7) + '-01'
  const series = new Map<string, OverviewPoint>()
  const first = filters.from ?? [...current].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.created_at
  if (first) {
    const end = key(filters.to)
    for (let cursor = new Date(key(first) + 'T00:00:00+07:00'); key(cursor.toISOString()) <= end;) {
      const date = key(cursor.toISOString())
      series.set(date, { day: date, amount: 0, count: 0, previousAmount: previous ? 0 : null, previousCount: previous ? 0 : null })
      if (bucket === 'day') cursor = new Date(cursor.getTime() + 86400000)
      else {
        const [year, month] = date.split('-').map(Number)
        cursor = new Date(Date.UTC(year, month, 1) - 7 * 3600000)
      }
    }
  }
  for (const slip of current) {
    const point = series.get(key(slip.created_at))
    if (point) { point.count++; if (resultOf(slip) === 'passed') point.amount += amount(slip) / 100 }
  }
  for (const slip of previous ?? []) {
    const shifted = new Date(Date.parse(slip.created_at) + Number(filters.range) * 86400000).toISOString()
    const point = series.get(key(shifted))
    if (point) { point.previousCount!++; if (resultOf(slip) === 'passed') point.previousAmount! += amount(slip) / 100 }
  }
  for (const point of series.values()) {
    point.amount = Math.round(point.amount * 100) / 100
    if (point.previousAmount !== null) point.previousAmount = Math.round(point.previousAmount * 100) / 100
  }
  const query = filters.q.toLocaleLowerCase('th-TH')
  const matches = current.filter(slip => !query || [slip.note, slip.trans_ref, names.get(slip.customer_id ?? '')].some(value => value?.toLocaleLowerCase('th-TH').includes(query)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
  return {
    totalSlips: current.length, approved: results.passed, pending: results.pending, verifiedSlipAmount: total(current), results,
    previous: previous ? { totalSlips: previous.length, approved: passed(previous).length, verifiedSlipAmount: total(previous) } : null,
    series: [...series.values()], bucket,
    slipMatches: matches.length,
    slips: matches.slice((filters.page - 1) * 10, filters.page * 10).map(slip => ({ id: slip.id, created_at: slip.created_at, customer: names.get(slip.customer_id ?? '') ?? null, amount: slip.amount, result: resultOf(slip), note: slip.note })),
  }
}

/** Caller verifies session and tenant membership before entering this service-role reader. */
export async function overviewFromTables(db: SupabaseClient, tenantId: string, filters: OverviewFilters): Promise<{ summary: Summary; notices: string[] }> {
  const shop = await db.from('tenants').select('id,name,slip_quota,slip_used').eq('id', tenantId).eq('is_active', true).maybeSingle()
  if (shop.error || !shop.data) throw new InboxError('โหลดข้อมูลร้านค้าไม่ได้', 503, 'OVERVIEW_UNAVAILABLE')
  const [slipsAllowed, customersAllowed, aiAllowed] = await Promise.all([
    hasFeature(db, tenantId, 'slip_auto_pilot'), hasFeature(db, tenantId, 'customer_management'), hasFeature(db, tenantId, 'ai_agent'),
  ])
  const notices: string[] = []
  let customers: Customer[] = [], messages: Message[] | null = null, ai: Summary['ai'] = null
  const slipQuery = () => {
    let query = db.from('slips').select('id,customer_id,created_at,status,approved_at,amount,note,trans_ref').eq('tenant_id', tenantId).lt('created_at', filters.to)
    if (filters.previousFrom ?? filters.from) query = query.gte('created_at', (filters.previousFrom ?? filters.from)!)
    return query.order('created_at').order('id')
  }
  const slipsPromise = slipsAllowed ? rows<Slip>((start, end) => slipQuery().range(start, end).returns<Slip[]>()) : Promise.resolve([])
  const chatsPromise = (async () => {
    if (!customersAllowed) return
    try {
      try {
        customers = await rows<Customer>((start, end) => db.from('customers').select('id,display_name,last_message_at,bot_enabled,avatar_url,unread_count,assigned_user_id').eq('tenant_id', tenantId).order('id').range(start, end).returns<Customer[]>())
      } catch (error) {
        if (!['42703', 'PGRST204'].includes((error as { code?: string }).code ?? '')) throw error
        customers = await rows<Customer>((start, end) => db.from('customers').select('id,display_name,last_message_at,bot_enabled').eq('tenant_id', tenantId).order('id').range(start, end).returns<Customer[]>())
        notices.push('ฐานข้อมูลยังไม่มีข้อมูลรูปโปรไฟล์และสถานะการรับแชทบางส่วน')
      }
      messages = await rows<Message>((start, end) => {
        let query = db.from('messages').select('id,customer_id,created_at,body,sender,customers!inner(tenant_id)').eq('customers.tenant_id', tenantId).lt('created_at', filters.to)
        if (filters.from) query = query.gte('created_at', filters.from)
        return query.order('created_at').order('id').range(start, end).returns<Message[]>()
      })
    } catch { notices.push('โหลดรายละเอียดแชทไม่ครบ กรุณาตรวจสอบตาราง customers/messages') }
  })()
  const aiPromise = (async () => {
    if (!aiAllowed) return
    try {
      const jobs = await rows<Job>((start, end) => {
        let query = db.from('agent_message_jobs').select('id,route,status,customer_id,created_at').eq('tenant_id', tenantId).lt('created_at', filters.to)
        if (filters.from) query = query.gte('created_at', filters.from)
        return query.order('id').range(start, end).returns<Job[]>()
      })
      const replies = jobs.filter(job => job.route === 'AI' && job.status === 'sent')
      ai = { replies: replies.length, conversations: new Set(replies.map(job => job.customer_id).filter(Boolean)).size, handoffs: jobs.filter(job => job.route === 'ADMIN').length, usage: null, limit: null }
    } catch { notices.push('ยังไม่มีข้อมูลสถิติ AI จากตาราง agent_message_jobs') }
  })()
  let slips: Slip[]
  try { [slips] = await Promise.all([slipsPromise, chatsPromise, aiPromise]) }
  catch { throw new InboxError('โหลดประวัติสลิปไม่ได้ กรุณาตรวจสอบการเชื่อมต่อฐานข้อมูล', 503, 'OVERVIEW_UNAVAILABLE') }
  const totals = aggregateOverviewSlips(slips, customers, filters)
  const credits = slipsAllowed ? await db.from('tenants').select('slip_quota_credits').eq('id', tenantId).maybeSingle() : null
  if (credits?.error) notices.push('อ่านเครดิตเสริมไม่ได้ ยอดเครดิตแสดงเป็นไม่ทราบค่า')
  const latest = new Map<string, Message>()
  const loadedMessages = messages as Message[] | null
  for (const message of loadedMessages ?? []) latest.set(message.customer_id, message)
  const query = filters.q.toLocaleLowerCase('th-TH')
  const chats = customers.filter(customer => customer.last_message_at && (!filters.from || Date.parse(customer.last_message_at) >= Date.parse(filters.from)) && Date.parse(customer.last_message_at) < Date.parse(filters.to))
    .filter(customer => !query || [customer.display_name, latest.get(customer.id)?.body].some(value => value?.toLocaleLowerCase('th-TH').includes(query)))
    .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '') || a.id.localeCompare(b.id))
  return { notices, summary: {
    shop: { id: shop.data.id, name: shop.data.name }, updatedAt: filters.to,
    access: { slips: slipsAllowed, customers: customersAllowed, ai: aiAllowed },
    metrics: { reconciledRevenue: null, messages: loadedMessages?.length ?? null, totalSlips: slipsAllowed ? totals.totalSlips : null, approved: slipsAllowed ? totals.approved : null, pending: slipsAllowed ? totals.pending : null, verifiedSlipAmount: slipsAllowed ? totals.verifiedSlipAmount : null,
      slipCredits: slipsAllowed && credits && !credits.error ? Math.max(0, Number(shop.data.slip_quota) + Number(credits.data?.slip_quota_credits ?? 0) - Number(shop.data.slip_used)) : null },
    previous: slipsAllowed ? totals.previous : null, results: slipsAllowed ? totals.results : null, series: slipsAllowed ? totals.series : [], bucket: totals.bucket,
    slips: totals.slips, slipMatches: totals.slipMatches,
    chats: chats.slice((filters.page - 1) * 10, filters.page * 10).map(customer => ({ id: customer.id, name: customer.display_name, avatar_url: customer.avatar_url ?? null, last_message_at: customer.last_message_at, unread_count: customer.unread_count ?? 0, owner: customer.assigned_user_id ? 'แอดมินรับแชท' : customer.bot_enabled ? 'บอท' : 'รอแอดมิน', body: latest.get(customer.id)?.body ?? null })), chatMatches: chats.length, ai,
  } }
}
