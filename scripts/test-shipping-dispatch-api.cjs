const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest, NextResponse } = require('next/server')
const { randomUUID } = require('node:crypto')
const load = require('./helpers/load-typescript.cjs')
const types = load('lib/features/shipping/shipping-types.ts')

function fixture(uncertain = false) {
  const tenantId = randomUUID(),
    shipmentId = randomUUID(),
    actorId = randomUUID()
  const events = []
  let job
  const db = {
    from(table) {
      const query = {
        select() {
          return query
        },
        eq() {
          return query
        },
        async maybeSingle() {
          assert.equal(table, 'shipping_integrations')
          return {
            data: {
              is_active: true,
              api_endpoint: 'https://client.beemove.co.th',
              credentials_ciphertext: 'encrypted',
              tracking_url_template: 'https://client.beemove.co.th/tracking/{tracking_number}',
              sender_info: { name: 'Shop', phone: '0899999999', address: 'Origin address' },
              weight_kg: 1,
            },
            error: null,
          }
        },
      }
      return query
    },
    async rpc(name, args) {
      events.push(name)
      if (name === 'commerce_rate_limit') return { data: true, error: null }
      if (name === 'manage_shipping') return { data: { ok: true }, error: null }
      if (name === 'shipping_snapshot')
        return {
          data: [
            {
              id: shipmentId,
              payment_ready: true,
              fulfillment_status: 'ready_to_ship',
              recipient_name: 'Buyer',
              phone_number: '0812345678',
              shipping_address: 'Delivery address',
              items: [{ order_id: 'order' }],
            },
          ],
          error: null,
        }
      if (name === 'begin_shipping_provider_job') {
        if (job) return { data: { ...job, claimed: false }, error: null }
        job = { jobId: 'job', idempotencyKey: 'stable-key', status: 'creating', claimed: true }
        return { data: job, error: null }
      }
      if (name === 'complete_shipping_provider_job') {
        assert.equal(args.p_tracking, 'BEE123456')
        job = {
          ...job,
          status: 'created',
          trackingNumber: args.p_tracking,
          trackingUrl: args.p_tracking_url,
          labelPdfUrl: args.p_label_url,
          notificationStatus: 'pending',
        }
        return { data: job, error: null }
      }
      if (name === 'finish_shipping_provider_job') {
        job.status = args.p_status
        return { data: null, error: null }
      }
      throw Error('Unexpected RPC ' + name)
    },
  }
  const route = load(
    'app/api/shipping/route.ts',
    {
      'next/server': {},
      '@/lib/features/shipping/shipping-server': {
        shippingScope: async () => ({ db, tenantId, actor: { id: actorId } }),
        shippingReply: (value) => NextResponse.json(value),
        shippingFailure: () => NextResponse.json({ error: 'failed' }, { status: 500 }),
        ShippingError: Error,
      },
      '@/lib/features/shipping/shipping-types': types,
      '@/lib/features/shipping/shipping-credentials': {
        decryptShippingCredentials: () => ({ apiKey: 'test-key' }),
      },
      '@/lib/features/shipping/shipping-provider': {
        shippingProviderAdapters: {
          beemove: {
            async createParcel(_config, parcel) {
              events.push('carrier')
              assert.equal(parcel.idempotencyKey, 'stable-key')
              if (uncertain) throw Error('SHIPPING_PROVIDER_RESPONSE_INVALID')
              return {
                trackingNumber: 'BEE123456',
                trackingUrl: 'https://client.beemove.co.th/tracking/BEE123456',
                labelPdfUrl: 'https://labels.example.test/bee.pdf',
              }
            },
          },
        },
      },
      '@/lib/features/shipping/shipping-notifications': {
        async deliverShippingTrackingNotifications(_db, options) {
          events.push('notify')
          assert.equal(options.tenantId, tenantId)
          assert.deepEqual(Array.from(options.shipmentIds), [shipmentId])
          return [{ shipmentId, status: 'sent' }]
        },
      },
      '@/lib/utils': { UUID: /^[a-f0-9-]{36}$/i },
    },
    { URL, console: { warn() {} } },
  )
  return {
    events,
    async post(action) {
      return route.POST(
        new NextRequest('https://shop.example/api/shipping', {
          method: 'POST',
          body: JSON.stringify({
            action,
            tenantId,
            requestId: randomUUID(),
            ids: [shipmentId],
            provider: 'beemove',
          }),
        }),
      )
    },
  }
}

test('manual dispatch commits before notifying the buyer', async () => {
  const f = fixture()
  const result = await f.post('dispatch')
  assert.equal(result.status, 200)
  assert.deepEqual(f.events, ['commerce_rate_limit', 'manage_shipping', 'notify'])
  assert.equal((await result.json()).notifications[0].status, 'sent')
})

test('parcel creation persists real tracking before notification and repeated requests reuse the parcel', async () => {
  const f = fixture()
  const result = await (await f.post('create_parcels')).json()
  assert.equal(result.results[0].trackingNumber, 'BEE123456')
  assert.equal(result.results[0].notification, 'sent')
  assert.ok(f.events.indexOf('complete_shipping_provider_job') < f.events.indexOf('notify'))
  await f.post('create_parcels')
  assert.equal(f.events.filter((item) => item === 'carrier').length, 1)
})

test('a malformed successful provider response stays uncertain and cannot create another parcel on replay', async () => {
  const f = fixture(true)
  assert.equal((await (await f.post('create_parcels')).json()).results[0].status, 'uncertain')
  assert.equal((await (await f.post('create_parcels')).json()).results[0].status, 'uncertain')
  assert.equal(f.events.filter((item) => item === 'carrier').length, 1)
})
