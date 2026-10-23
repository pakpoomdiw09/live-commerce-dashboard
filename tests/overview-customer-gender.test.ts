import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateCustomerGenders } from '../lib/features/overview/overview-activity-core'
import { overviewFilters } from '../lib/features/overview/premium-overview-core'

test('gender counts use distinct inbound customers in the selected period and preserve unknown values', () => {
  const filters = overviewFilters({ range: '7' }, new Date('2026-10-17T05:00:00Z'))
  const customers = [
    { id: 'a', gender: 'male' },
    { id: 'b', gender: 'female' },
    { id: 'c', gender: null },
    { id: 'd', gender: 'other' },
    { id: 'old', gender: 'male' },
  ]
  const messages = ['a', 'a', 'b', 'c', 'd', 'missing'].map((customer_id) => ({
    customer_id,
    created_at: '2026-10-16T12:00:00Z',
  }))
  messages.push({ customer_id: 'old', created_at: '2026-09-01T00:00:00Z' })
  messages.push({ customer_id: 'old', created_at: filters.to })
  assert.deepEqual(aggregateCustomerGenders(customers, messages, filters), {
    male: 1,
    female: 1,
    unspecified: 3,
  })
  assert.deepEqual(aggregateCustomerGenders([], messages, filters), {
    male: 0,
    female: 0,
    unspecified: 5,
  })
  assert.deepEqual(aggregateCustomerGenders(customers, [], filters), {
    male: 0,
    female: 0,
    unspecified: 0,
  })
})
