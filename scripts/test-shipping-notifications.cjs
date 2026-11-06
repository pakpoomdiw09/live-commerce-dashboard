const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')
const types = load('lib/features/shipping/shipping-types.ts')

function fixture(failure) {
  const tables = {
    shipping_tracking_deliveries: [
      {
        id: 'delivery',
        tenant_id: 'tenant',
        shipment_id: 'shipment',
        tracking_number: 'BEE123456',
        tracking_url: 'https://client.beemove.co.th/tracking/BEE123456',
        courier_name: 'Bee Move',
        status: 'pending',
        created_at: '2026-01-01',
        next_attempt_at: '2026-01-01',
      },
    ],
    shipping_shipments: [
      {
        id: 'shipment',
        tenant_id: 'tenant',
        customer_id: 'buyer',
        fulfillment_status: 'shipped',
        tracking_number: 'BEE123456',
        recipient_name: 'Test Buyer',
        courier_name: 'Bee Move',
      },
    ],
    tenants: [
      { id: 'tenant', is_active: true, page_id: '100', page_access_token: 'test-only-page-token' },
    ],
    customers: [
      { id: 'buyer', tenant_id: 'tenant', platform: 'facebook', platform_user_id: '900' },
    ],
    shipping_provider_jobs: [],
    messages: [],
    shipping_integrations: [],
  }
  const sends = []
  const db = {
    from(table) {
      const filters = []
      let update
      const result = () => {
        const data = tables[table].filter((row) => filters.every((predicate) => predicate(row)))
        if (update) data.forEach((row) => Object.assign(row, update))
        return { data, error: null }
      }
      const query = {
        select() {
          return query
        },
        update(value) {
          update = value
          return query
        },
        eq(key, value) {
          filters.push((row) => row[key] === value)
          return query
        },
        lt(key, value) {
          filters.push((row) => row[key] < value)
          return query
        },
        lte(key, value) {
          filters.push((row) => row[key] <= value)
          return query
        },
        in(key, value) {
          filters.push((row) => value.includes(row[key]))
          return query
        },
        order() {
          return query
        },
        limit() {
          return query
        },
        async maybeSingle() {
          const answer = result()
          return { ...answer, data: answer.data[0] || null }
        },
        async single() {
          return query.maybeSingle()
        },
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject)
        },
      }
      return query
    },
  }
  const worker = load(
    'lib/features/shipping/shipping-notifications.ts',
    {
      'server-only': {},
      './shipping-types': types,
      '@/lib/integrations/facebook/client': { pageTokenFor: (row) => row.page_access_token },
      '@/lib/features/slips/notify': {
        deliverOnce: async (_db, recipient, key, body) => {
          if (failure === 'paused') throw Error('POLICY_BLOCKED')
          sends.push({ recipient, key, body })
          tables.messages.push({
            customer_id: recipient.id,
            external_id: key,
            delivery_status: failure === 'ambiguous' ? 'unknown' : 'sent',
          })
          if (failure === 'ambiguous') throw Error('PROVIDER_TIMEOUT')
          return true
        },
      },
    },
    { URL },
  )
  return { tables, sends, run: () => worker.deliverShippingTrackingNotifications(db) }
}

test('tracking outbox sends to the scoped buyer with the actual tracking URL once across concurrent drains/replays', async () => {
  const f = fixture()
  await Promise.all([f.run(), f.run()])
  await f.run()
  assert.equal(f.sends.length, 1)
  assert.equal(f.sends[0].recipient.psid, '900')
  assert.equal(f.sends[0].recipient.id, 'buyer')
  assert.match(f.sends[0].body, /BEE123456/)
  assert.match(f.sends[0].body, /https:\/\/client.beemove.co.th\/tracking\/BEE123456/)
  assert.equal(f.tables.shipping_tracking_deliveries[0].status, 'sent')
})

test('pre-send policy blocks keep tracking pending; uncertain sends require review and never resend automatically', async () => {
  const blocked = fixture('paused')
  await blocked.run()
  assert.equal(blocked.tables.shipping_tracking_deliveries[0].status, 'pending')
  assert.ok(Date.parse(blocked.tables.shipping_tracking_deliveries[0].next_attempt_at) > Date.now())
  assert.equal(blocked.sends.length, 0)
  const uncertain = fixture('ambiguous')
  await uncertain.run()
  await uncertain.run()
  assert.equal(uncertain.tables.shipping_tracking_deliveries[0].status, 'requires_review')
  assert.equal(uncertain.sends.length, 1)
})

test('a changed tracking allocation cancels stale notification; already-sent receipts reconcile without resending', async () => {
  const stale = fixture()
  stale.tables.shipping_shipments[0].tracking_number = 'NEW123456'
  await stale.run()
  assert.equal(stale.tables.shipping_tracking_deliveries[0].status, 'cancelled')
  assert.equal(stale.sends.length, 0)
  const sent = fixture()
  sent.tables.messages.push({
    customer_id: 'buyer',
    external_id: 'shipping-tracking:shipment:BEE123456',
    delivery_status: 'sent',
  })
  await sent.run()
  assert.equal(sent.tables.shipping_tracking_deliveries[0].status, 'sent')
  assert.equal(sent.sends.length, 0)
})
