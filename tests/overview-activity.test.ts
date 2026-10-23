import test from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregateOverviewActivity,
  type InboundActivityMessage,
} from '../lib/features/overview/overview-activity-core'
import type { OverviewFilters } from '../lib/features/overview/premium-overview-core'

function filters(from: string | null, to: string): OverviewFilters {
  return {
    range: from ? '7' : 'all',
    page: 1,
    q: '',
    from,
    to,
    previousFrom: null,
  }
}

test('groups inbound messages by Bangkok date and counts distinct customers', () => {
  const messages: InboundActivityMessage[] = [
    { customer_id: 'customer-1', created_at: '2024-01-01T18:00:00.000Z' },
    { customer_id: 'customer-1', created_at: '2024-01-02T20:00:00.000Z' },
    { customer_id: 'customer-2', created_at: '2024-01-03T17:00:00.000Z' },
  ]

  const result = aggregateOverviewActivity(
    messages,
    filters('2024-01-01T17:00:00.000Z', '2024-01-05T17:00:00.000Z'),
  )

  assert.equal(result.messages, 3)
  assert.equal(result.uniqueCustomers, 2)
  assert.equal(result.points.length, 4)
  assert.deepEqual(
    result.points.map(({ key, messages, customers }) => ({ key, messages, customers })),
    [
      { key: '2024-01-02', messages: 1, customers: 1 },
      { key: '2024-01-03', messages: 1, customers: 1 },
      { key: '2024-01-04', messages: 1, customers: 1 },
      { key: '2024-01-05', messages: 0, customers: 0 },
    ],
  )
  assert.equal(result.hours[0].messages, 2)
  assert.equal(result.hours[1].messages, 1)
  assert.equal(result.hours[7].messages, 0)
  assert.equal(result.peakHour?.label, '00:00–03:00')
})

test('keeps all-time monthly buckets continuous across year boundaries', () => {
  const messages: InboundActivityMessage[] = [
    { customer_id: 'customer-1', created_at: '2023-12-31T18:00:00.000Z' },
    { customer_id: 'customer-2', created_at: '2024-02-01T18:00:00.000Z' },
  ]

  const result = aggregateOverviewActivity(messages, filters(null, '2024-04-01T16:59:59.999Z'))

  assert.equal(result.messages, 2)
  assert.equal(result.uniqueCustomers, 2)
  assert.deepEqual(
    result.points.map((point) => [point.key, point.messages]),
    [
      ['2024-01-01', 1],
      ['2024-02-01', 1],
      ['2024-03-01', 0],
      ['2024-04-01', 0],
    ],
  )
})

test('returns zeroes for empty periods and excludes the exclusive end timestamp', () => {
  const messages: InboundActivityMessage[] = [
    { customer_id: 'customer-1', created_at: '2024-01-02T17:00:00.000Z' },
    { customer_id: 'customer-2', created_at: 'not-a-date' },
  ]

  const result = aggregateOverviewActivity(
    messages,
    filters('2024-01-01T17:00:00.000Z', '2024-01-02T17:00:00.000Z'),
  )

  assert.equal(result.messages, 0)
  assert.equal(result.uniqueCustomers, 0)
  assert.equal(result.points[0].messages, 0)
  assert.equal(result.hours.length, 8)
  assert.equal(result.peakHour, null)
})
