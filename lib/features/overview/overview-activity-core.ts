import type { OverviewFilters } from '@/lib/features/overview/premium-overview-core'

export type InboundActivityMessage = { customer_id: string; created_at: string }
export type ActivityPoint = { key: string; label: string; messages: number; customers: number }
export type HourActivityPoint = { label: string; messages: number }
export type CustomerGenderSummary = { male: number; female: number; unspecified: number }

export function aggregateCustomerGenders(customers: { id: string; gender?: string | null }[], messages: InboundActivityMessage[], filters: OverviewFilters): CustomerGenderSummary {
  const genders = new Map(customers.map(customer => [customer.id, customer.gender?.trim().toLowerCase()]))
  const ids = new Set(messages.filter(message => {
    const time = Date.parse(message.created_at)
    return Number.isFinite(time) && (!filters.from || time >= Date.parse(filters.from)) && time < Date.parse(filters.to)
  }).map(message => message.customer_id))
  const counts = { male: 0, female: 0, unspecified: 0 }
  for (const id of ids) {
    const gender = genders.get(id)
    if (gender === 'male' || gender === 'ชาย' || gender === 'เพศชาย') counts.male++
    else if (gender === 'female' || gender === 'หญิง' || gender === 'เพศหญิง') counts.female++
    else counts.unspecified++
  }
  return counts
}

const TIME_ZONE = 'Asia/Bangkok'
const DAY_MS = 86_400_000
const HOUR_BINS = Array.from({ length: 8 }, (_, index) => {
  const start = index * 3
  const end = start + 3
  return { label: `${String(start).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00`, start, end }
})

function localDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function localMonth(value: string) {
  return `${localDate(value).slice(0, 7)}-01`
}

function localHour(value: string) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date(value)))
}

function pointLabel(key: string, bucket: 'day' | 'month') {
  const date = new Date(`${key.slice(0, 10)}T12:00:00+07:00`)
  return new Intl.DateTimeFormat('th-TH', bucket === 'day'
    ? { timeZone: TIME_ZONE, day: 'numeric', month: 'short' }
    : { timeZone: TIME_ZONE, month: 'short', year: '2-digit' }).format(date)
}

function bucketKeys(messages: InboundActivityMessage[], filters: OverviewFilters) {
  if (!filters.from) {
    const dates = messages.map(message => localMonth(message.created_at)).sort()
    if (!dates.length) return { bucket: 'month' as const, keys: [] }
    const [firstYear, firstMonth] = dates[0].slice(0, 7).split('-').map(Number)
    const [lastYear, lastMonth] = localMonth(filters.to).slice(0, 7).split('-').map(Number)
    const keys: string[] = []
    for (let year = firstYear, month = firstMonth; year < lastYear || (year === lastYear && month <= lastMonth);) {
      keys.push(`${year}-${String(month).padStart(2, '0')}-01`)
      month++
      if (month === 13) { month = 1; year++ }
    }
    return { bucket: 'month' as const, keys }
  }
  const keys: string[] = []
  const end = Date.parse(filters.to)
  for (let time = Date.parse(filters.from); time < end; time += DAY_MS) {
    keys.push(localDate(new Date(time).toISOString()))
  }
  return { bucket: 'day' as const, keys }
}

export function aggregateOverviewActivity(messages: InboundActivityMessage[], filters: OverviewFilters) {
  const inRange = messages.filter(message => {
    const timestamp = Date.parse(message.created_at)
    return Number.isFinite(timestamp) && (!filters.from || timestamp >= Date.parse(filters.from)) && timestamp < Date.parse(filters.to)
  })
  const { bucket, keys } = bucketKeys(inRange, filters)
  const byBucket = new Map<string, { messages: number; customers: Set<string> }>(
    keys.map(key => [key, { messages: 0, customers: new Set<string>() }]),
  )
  const uniqueCustomers = new Set<string>()
  const hourCounts = HOUR_BINS.map(() => 0)

  for (const message of inRange) {
    const key = bucket === 'day' ? localDate(message.created_at) : localMonth(message.created_at)
    let current = byBucket.get(key)
    if (!current) {
      current = { messages: 0, customers: new Set<string>() }
      byBucket.set(key, current)
    }
    current.messages++
    if (message.customer_id) {
      current.customers.add(message.customer_id)
      uniqueCustomers.add(message.customer_id)
    }
    const hour = localHour(message.created_at)
    const bin = Math.min(Math.floor(hour / 3), HOUR_BINS.length - 1)
    hourCounts[bin]++
  }

  const points: ActivityPoint[] = [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, label: pointLabel(key, bucket), messages: value.messages, customers: value.customers.size }))
  const hours: HourActivityPoint[] = HOUR_BINS.map((bin, index) => ({ label: bin.label, messages: hourCounts[index] }))
  const peak = points.reduce<ActivityPoint | null>((best, point) => point.messages > (best?.messages ?? 0) ? point : best, null)
  const peakHour = hours.reduce<HourActivityPoint | null>((best, point) => point.messages > (best?.messages ?? 0) ? point : best, null)

  return {
    messages: inRange.length,
    uniqueCustomers: uniqueCustomers.size,
    points,
    hours,
    peak,
    peakHour: peakHour?.messages ? peakHour : null,
  }
}
