import type {
  OverviewFilters,
  OverviewPoint,
  OverviewSlip,
} from '../../lib/features/overview/premium-overview-core'

type Slip = {
  id: string
  customer_id: string | null
  created_at: string
  status: string
  approved_at: string | null
  amount: number | null
  note: string | null
  trans_ref: string | null
}
type Customer = {
  id: string
  display_name: string | null
  last_message_at: string | null
  bot_enabled: boolean
  gender?: string | null
  avatar_url?: string | null
  unread_count?: number
  assigned_user_id?: string | null
}
const day = (value: string) =>
  new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const amount = (slip: Slip) =>
  Number.isFinite(Number(slip.amount)) ? Math.round(Number(slip.amount) * 100) : 0
const resultOf = (slip: Slip): OverviewSlip['result'] => {
  if (
    slip.status === 'valid' ||
    (slip.approved_at &&
      ['amount_mismatch', 'wrong_receiver', 'fake', 'error'].includes(slip.status))
  )
    return 'passed'
  if (['pending', 'amount_mismatch', 'wrong_receiver'].includes(slip.status)) return 'pending'
  return slip.status === 'error' ? 'error' : 'rejected'
}

/** Reference aggregation for regression tests; production reads use SQL below. */
export function aggregateOverviewSlips(
  slips: Slip[],
  customers: Customer[],
  filters: OverviewFilters,
) {
  const current = slips.filter(
    (slip) =>
      (!filters.from || Date.parse(slip.created_at) >= Date.parse(filters.from)) &&
      Date.parse(slip.created_at) < Date.parse(filters.to),
  )
  const previous =
    filters.previousFrom && filters.from
      ? slips.filter(
          (slip) =>
            Date.parse(slip.created_at) >= Date.parse(filters.previousFrom!) &&
            Date.parse(slip.created_at) < Date.parse(filters.from!),
        )
      : null
  const customerById = new Map(customers.map((customer) => [customer.id, customer]))
  const results = { passed: 0, pending: 0, rejected: 0, error: 0 }
  for (const slip of current) results[resultOf(slip)]++
  const passed = (items: Slip[]) => items.filter((slip) => resultOf(slip) === 'passed')
  const total = (items: Slip[]) => passed(items).reduce((sum, slip) => sum + amount(slip), 0) / 100
  const bucket: 'day' | 'month' = filters.from ? 'day' : 'month'
  const key = (value: string) => (bucket === 'day' ? day(value) : day(value).slice(0, 7) + '-01')
  const series = new Map<string, OverviewPoint>()
  const first =
    filters.from ??
    [...current].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.created_at
  if (first) {
    const end = key(filters.to)
    for (let cursor = new Date(key(first) + 'T00:00:00+07:00'); key(cursor.toISOString()) <= end;) {
      const date = key(cursor.toISOString())
      series.set(date, {
        day: date,
        amount: 0,
        count: 0,
        previousAmount: previous ? 0 : null,
        previousCount: previous ? 0 : null,
      })
      if (bucket === 'day') cursor = new Date(cursor.getTime() + 86400000)
      else {
        const [year, month] = date.split('-').map(Number)
        cursor = new Date(Date.UTC(year, month, 1) - 7 * 3600000)
      }
    }
  }
  for (const slip of current) {
    const point = series.get(key(slip.created_at))
    if (point) {
      point.count++
      if (resultOf(slip) === 'passed') point.amount += amount(slip) / 100
    }
  }
  for (const slip of previous ?? []) {
    const shifted = new Date(
      Date.parse(slip.created_at) + Number(filters.range) * 86400000,
    ).toISOString()
    const point = series.get(key(shifted))
    if (point) {
      point.previousCount!++
      if (resultOf(slip) === 'passed') point.previousAmount! += amount(slip) / 100
    }
  }
  for (const point of series.values()) {
    point.amount = Math.round(point.amount * 100) / 100
    if (point.previousAmount !== null)
      point.previousAmount = Math.round(point.previousAmount * 100) / 100
  }
  const query = filters.q.toLocaleLowerCase('th-TH')
  const matches = current
    .filter(
      (slip) =>
        !query ||
        [slip.note, slip.trans_ref, customerById.get(slip.customer_id ?? '')?.display_name].some(
          (value) => value?.toLocaleLowerCase('th-TH').includes(query),
        ),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
  return {
    totalSlips: current.length,
    approved: results.passed,
    pending: results.pending,
    verifiedSlipAmount: total(current),
    results,
    previous: previous
      ? {
          totalSlips: previous.length,
          approved: passed(previous).length,
          verifiedSlipAmount: total(previous),
        }
      : null,
    series: [...series.values()],
    bucket,
    slipMatches: matches.length,
    slips: matches.slice((filters.page - 1) * 10, filters.page * 10).map((slip) => {
      const customer = customerById.get(slip.customer_id ?? '')
      return {
        id: slip.id,
        created_at: slip.created_at,
        customer: customer?.display_name ?? null,
        avatar_url: customer?.avatar_url ?? null,
        amount: slip.amount,
        result: resultOf(slip),
        note: slip.note,
      }
    }),
  }
}
