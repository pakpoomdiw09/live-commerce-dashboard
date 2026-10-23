const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')
const { matchesInboxFilter: matches } = load('lib/features/inbox/inbox-list.ts')

test('tracked matches the distinct union of personal stars and follow-up flags', () => {
  const ids = ['star', 'flag', 'both', 'other']
  const filtered = ids.filter((id) =>
    matches('tracked', id, undefined, 'actor', [], ['star', 'both'], [], ['flag', 'both']),
  )
  assert.deepEqual(filtered, ['star', 'flag', 'both'])
  assert.equal(matches('starred', 'flag', undefined, 'actor', [], ['star'], [], ['flag']), false)
  assert.equal(matches('tracked', 'other', undefined, 'actor', [], [], [], []), false)
})

test('paid uses verified slip customer IDs and cannot be inferred from pending orders or conversation state', () => {
  assert.equal(matches('paid', 'verified', undefined, 'actor', ['pending'], [], ['verified']), true)
  assert.equal(
    matches('paid', 'pending', { inbox_stage: 'RESOLVED' }, 'actor', ['pending'], [], ['verified']),
    false,
  )
  assert.equal(
    matches('payment', 'pending', undefined, 'actor', ['pending'], [], ['verified']),
    true,
  )
})

function fixture({ followUpMissing = false, paidError = false, denied = false } = {}) {
  const queries = []
  const values = {
    orders: [{ customer_id: 'pending' }],
    inbox_stars: [{ customer_id: 'star' }],
    inbox_follow_up_flags: [{ customer_id: 'flag' }],
    customers: [{ id: 'verified' }],
  }
  const db = {
    from(table) {
      const record = { table, filters: [], limits: [], selection: '', order: '' }
      queries.push(record)
      const query = {
        select(value) {
          record.selection = value
          return query
        },
        eq(key, value) {
          record.filters.push([key, value])
          return query
        },
        or(value, options) {
          record.or = { value, options }
          return query
        },
        order(value) {
          record.order = value
          return query
        },
        limit(value, options) {
          record.limits.push({ value, options })
          return query
        },
        then(resolve) {
          return Promise.resolve({
            data: values[table],
            error:
              table === 'customers' && paidError
                ? { code: '57014' }
                : table === 'inbox_follow_up_flags' && followUpMissing
                  ? { code: 'PGRST205' }
                  : null,
          }).then(resolve)
        },
      }
      return query
    },
  }
  const api = load('app/api/inbox/stars/route.ts', {
    'next/server': {
      NextResponse: { json: (body, options) => ({ status: 200, body, headers: options?.headers }) },
    },
    '@/lib/features/inbox/inbox-server': {
      inboxTenant: async () => {
        if (denied) throw new Error('Forbidden')
        return { db, actor: { id: 'actor' }, tenantId: 'tenant' }
      },
      inboxError: () => ({ status: 503 }),
    },
  })
  return {
    api,
    queries,
    request: { nextUrl: { searchParams: new URLSearchParams({ tenantId: 'tenant' }) } },
  }
}

test('filter metadata is tenant-scoped, actor-scoped and bounded without queries per customer', async () => {
  const { api, queries, request } = fixture()
  const response = await api.GET(request)
  assert.equal(response.status, 200)
  assert.equal(queries.length, 4)
  assert.deepEqual(Array.from(response.body.paidCustomerIds), ['verified'])
  assert.deepEqual(Array.from(response.body.pendingPaymentIds), ['pending'])
  assert.deepEqual(Array.from(response.body.followUpCustomerIds), ['flag'])
  assert.equal(response.headers['Cache-Control'], 'no-store')
  for (const table of ['inbox_stars', 'inbox_follow_up_flags']) {
    const query = queries.find((query) => query.table === table)
    assert.ok(query.filters.some(([key, value]) => key === 'user_id' && value === 'actor'))
    assert.ok(
      query.filters.some(([key, value]) => key === 'customers.tenant_id' && value === 'tenant'),
    )
  }
  const paid = queries.find((query) => query.table === 'customers')
  assert.equal(paid.selection, 'id,slips!inner(id)')
  assert.ok(paid.filters.some(([key, value]) => key === 'tenant_id' && value === 'tenant'))
  assert.ok(paid.filters.some(([key, value]) => key === 'slips.tenant_id' && value === 'tenant'))
  assert.equal(paid.or.options.referencedTable, 'slips')
  assert.equal(
    paid.or.value,
    'status.eq.valid,and(approved_at.not.is.null,status.in.(amount_mismatch,wrong_receiver,fake,error))',
  )
  assert.ok(
    paid.limits.some((limit) => limit.value === 1 && limit.options?.referencedTable === 'slips'),
  )
  for (const query of queries)
    assert.ok(query.limits.some((limit) => limit.value === 1000 && !limit.options))
})

test('a missing optional flag migration preserves stars and paid filters', async () => {
  const { api, request } = fixture({ followUpMissing: true })
  const response = await api.GET(request)
  assert.equal(response.status, 200)
  assert.equal(response.body.followUpAvailable, false)
  assert.deepEqual(Array.from(response.body.customerIds), ['star'])
  assert.deepEqual(Array.from(response.body.paidCustomerIds), ['verified'])
})

test('authorization and failed paid queries cannot produce a successful empty paid count', async () => {
  const denied = fixture({ denied: true })
  assert.equal((await denied.api.GET(denied.request)).status, 503)
  assert.equal(denied.queries.length, 0)
  const failed = fixture({ paidError: true })
  assert.equal((await failed.api.GET(failed.request)).status, 503)
})
