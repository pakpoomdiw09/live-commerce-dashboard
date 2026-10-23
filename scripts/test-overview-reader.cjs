const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')
const core = load('lib/features/overview/premium-overview-core.ts')
const filters = core.overviewFilters({}, new Date('2026-10-24T05:00:00Z'))
class InboxError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}
function fixture({
  rpcError = null,
  partial = false,
  badDate = false,
  failedTable = '',
  denied = false,
  creditMissing = false,
} = {}) {
  const logs = [],
    queries = []
  const logger = { logOverviewError: (...args) => logs.push(args) }
  const recovery = load('lib/features/overview/overview-recovery.ts', {
    'server-only': {},
    '@/lib/feature-access': {
      loadFeatureAccess: async () => ({
        slip_auto_pilot: true,
        customer_management: true,
        ai_agent: true,
      }),
    },
    './premium-overview-core': core,
    './overview-diagnostics': logger,
    '@/lib/features/inbox/inbox-server': { InboxError },
  })
  const reader = load('lib/features/overview/overview-tables.ts', {
    'server-only': {},
    './overview-recovery': recovery,
    './overview-diagnostics': logger,
    '@/lib/features/inbox/inbox-server': { InboxError },
  })
  const db = {
    from(table) {
      const query = { table, columns: '', filters: [] }
      queries.push(query)
      const builder = {
        select(columns) {
          query.columns = columns
          return this
        },
        eq(...args) {
          query.filters.push(['eq', ...args])
          return this
        },
        gte(...args) {
          query.filters.push(['gte', ...args])
          return this
        },
        lt(...args) {
          query.filters.push(['lt', ...args])
          return this
        },
        or(...args) {
          query.filters.push(['or', ...args])
          return this
        },
        in(...args) {
          query.filters.push(['in', ...args])
          return this
        },
        is(...args) {
          query.filters.push(['is', ...args])
          return this
        },
        maybeSingle() {
          return this
        },
        then(resolve, reject) {
          const error =
            (failedTable === 'all-counts' && table !== 'tenants') ||
            table === failedTable ||
            (creditMissing && query.columns.includes('slip_quota_credits'))
              ? {
                  code: '42703',
                  message: 'Missing column',
                  details: 'fixture',
                  hint: 'Apply migration',
                }
              : null
          return Promise.resolve({
            data:
              table === 'tenants' && !error
                ? { id: 'shop', name: 'Shop', slip_quota: 0, slip_used: 0, slip_quota_credits: 0 }
                : null,
            count: error ? null : table === 'messages' ? 12 : table === 'customers' ? 3 : 2,
            error,
            status: error ? 400 : 200,
          }).then(resolve, reject)
        },
      }
      return builder
    },
    async rpc() {
      const data = {
        access: { customers: true, slips: true, ai: true },
        totals: partial
          ? undefined
          : { totalSlips: 4, approved: 3, pending: 1, verifiedSlipAmount: 25 },
        messages: 12,
        uniqueCustomers: 3,
        activity: badDate ? [{ key: 'invalid' }] : [],
        hours: partial ? null : [],
        slips: [],
        chats: [],
        slipMatches: 4,
        chatMatches: 3,
        results: { passed: 3 },
        series: [],
        customerGenders: { male: 1, female: 1, unspecified: 1 },
        ai: null,
        previous: null,
      }
      return {
        data: rpcError ? null : data,
        error: rpcError,
        status: denied ? 403 : rpcError ? 404 : 200,
      }
    },
  }
  return { logs, queries, run: () => reader.overviewFromTables(db, 'shop', filters) }
}

test('incomplete aggregates preserve good counters and default only missing sections to zero', async () => {
  const f = fixture({ partial: true })
  const { summary, notices } = await f.run()
  assert.equal(summary.metrics.incomingMessages, 12)
  assert.equal(summary.metrics.uniqueCustomers, 3)
  assert.equal(summary.metrics.approved, 0)
  assert.ok(notices.length)
  assert.equal(f.queries.length, 1)
})
test('missing aggregate RPC recovers tenant-scoped SQL counts; a failed section does not erase others', async () => {
  const f = fixture({
    rpcError: { code: 'PGRST202', message: 'Missing RPC' },
    failedTable: 'slips',
  })
  const { summary, notices } = await f.run()
  assert.equal(summary.metrics.incomingMessages, 12)
  assert.equal(summary.metrics.uniqueCustomers, 3)
  assert.equal(summary.metrics.approved, 0)
  assert.ok(notices.length)
  for (const query of f.queries) {
    const field =
      query.table === 'messages'
        ? 'customers.tenant_id'
        : query.table === 'tenants'
          ? 'id'
          : 'tenant_id'
    assert.ok(
      query.filters.some(([op, column, id]) => op === 'eq' && column === field && id === 'shop'),
    )
    if (query.table !== 'tenants')
      assert.ok(query.columns === 'id' || query.columns.includes('!inner'))
  }
  assert.ok(f.logs.some(([stage]) => stage === 'rpc.overview_dashboard_stats'))
})
test('permission denials stay fatal and never invoke recovery queries', async () => {
  const f = fixture({ rpcError: { code: '42501', message: 'Denied' }, denied: true })
  await assert.rejects(f.run(), (e) => e.status === 403)
  assert.equal(f.queries.length, 1)
})
test('complete database count failure remains fatal instead of claiming real zero statistics', async () => {
  const f = fixture({
    rpcError: { code: 'PGRST202', message: 'Missing RPC' },
    failedTable: 'all-counts',
  })
  await assert.rejects(f.run(), (e) => e.status === 503 && e.code === 'OVERVIEW_UNAVAILABLE')
})

test('invalid graph dates and optional credit columns cannot break every KPI', async () => {
  const f = fixture({ badDate: true, creditMissing: true })
  const { summary, notices } = await f.run()
  assert.equal(summary.metrics.incomingMessages, 12)
  assert.equal(summary.metrics.approved, 3)
  assert.equal(summary.metrics.slipCredits, null)
  assert.equal(summary.activity.length, 0)
  assert.ok(notices.length)
})
test('diagnostic logs include status/details but redact credentials and JWTs', () => {
  const entries = [],
    secret = 'private-service-secret'
  const logger = load(
    'lib/features/overview/overview-diagnostics.ts',
    {},
    {
      process: { env: { SUPABASE_SERVICE_ROLE_KEY: secret } },
      console: { error: (...args) => entries.push(args) },
    },
  )
  logger.logOverviewError(
    'rpc',
    { code: '42703', message: secret, details: 'Missing column', hint: 'Apply migration' },
    { status: 400 },
  )
  assert.equal(entries[0][1].status, 400)
  assert.equal(entries[0][1].details, 'Missing column')
  assert.ok(!JSON.stringify(entries).includes(secret))
})
