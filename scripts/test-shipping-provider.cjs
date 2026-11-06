const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')

test('Bee Move provisional adapter uses the configured single key, fixed create endpoint and real response values', async () => {
  const requests = []
  const bee = load(
    'lib/integrations/shipping/beemove-adapter.ts',
    { 'server-only': {} },
    {
      URL,
      AbortSignal,
      fetch: async (url, init) => {
        requests.push({ url, init })
        return Response.json({
          tracking_number: 'BEE123456',
          label_url: 'https://labels.example.test/bee.pdf',
        })
      },
    },
  )
  const config = {
    provider: 'beemove',
    apiEndpoint: bee.BEEMOVE_BASE_URL,
    credentials: { apiKey: 'test-key' },
    trackingUrlTemplate: bee.BEEMOVE_TRACKING_URL_TEMPLATE,
  }
  const parcel = {
    orderId: 'order',
    shipmentId: 'shipment',
    recipient: { name: 'Buyer', phone: '0812345678', address: 'Address' },
    sender: { name: 'Shop', phone: '0899999999', address: 'Origin' },
    weight: 1,
    courierCode: 'beemove',
    idempotencyKey: 'stable-job',
  }
  const result = await bee.beemoveShippingAdapter.createParcel(config, parcel)
  assert.equal(requests[0].url, 'https://client.beemove.co.th/api/v1/orders/create')
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key')
  assert.equal(requests[0].init.headers['Content-Type'], 'application/json')
  assert.equal(requests[0].init.headers['Idempotency-Key'], 'stable-job')
  assert.equal(JSON.parse(requests[0].init.body).recipient.name, 'Buyer')
  assert.equal(result.trackingNumber, 'BEE123456')
  assert.equal(result.labelPdfUrl, 'https://labels.example.test/bee.pdf')
  assert.match(result.trackingUrl, /BEE123456/)
  await assert.rejects(
    bee.beemoveShippingAdapter.createParcel(
      { ...config, apiEndpoint: 'https://evil.example' },
      parcel,
    ),
    /ENDPOINT_INVALID/,
  )
  await assert.rejects(
    bee.beemoveShippingAdapter.testConnection(config),
    /CONNECTION_TEST_UNAVAILABLE/,
  )
  assert.equal(
    requests.length,
    1,
    'connection tests never book parcels or claim a public HTML page proves authentication',
  )
})

test('Bee Move never invents tracking or labels when a successful HTTP response is incomplete', async () => {
  const bee = load(
    'lib/integrations/shipping/beemove-adapter.ts',
    { 'server-only': {} },
    {
      URL,
      AbortSignal,
      fetch: async () => Response.json({ success: true }),
    },
  )
  await assert.rejects(
    bee.beemoveShippingAdapter.createParcel(
      { apiEndpoint: bee.BEEMOVE_BASE_URL, credentials: { apiKey: 'test-key' } },
      {},
    ),
    /RESPONSE_INVALID/,
  )
})

test('shipping credentials are AES-GCM encrypted, round-trip correctly, and reject tampering', () => {
  const credentials = load(
    'lib/features/shipping/shipping-credentials.ts',
    { 'server-only': {}, 'node:crypto': require('node:crypto') },
    {
      Buffer,
      process: {
        env: { SHIPPING_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
      },
    },
  )
  const value = credentials.encryptShippingCredentials({
    apiKey: 'merchant-secret',
    secretKey: 'second-secret',
  })

  assert.doesNotMatch(value, /merchant-secret|second-secret/)
  assert.deepEqual(JSON.parse(JSON.stringify(credentials.decryptShippingCredentials(value))), {
    apiKey: 'merchant-secret',
    secretKey: 'second-secret',
  })
  assert.throws(
    () => credentials.decryptShippingCredentials(value.slice(0, -2) + 'aa'),
    /Unsupported state|authenticity|unable to authenticate/i,
  )
})

test('generic DMove adapter sends the normalized idempotent parcel request and resolves tracking URL', async () => {
  const requests = []
  const provider = load(
    'lib/features/shipping/shipping-provider.ts',
    {
      'server-only': {},
      'node:net': require('node:net'),
      '@/lib/integrations/shipping/beemove-adapter': { beemoveShippingAdapter: {} },
      'node:dns/promises': { lookup: async () => [{ address: '8.8.8.8' }] },
    },
    {
      fetch: async (url, init) => {
        requests.push({ url: String(url), init })
        return Response.json({
          success: true,
          tracking_number: 'TH123456789',
          label_url: 'https://labels.example.test/label.pdf',
        })
      },
      AbortSignal,
      URL,
    },
  )
  const config = {
    provider: 'dmove',
    apiEndpoint: 'https://api.example.test/v1',
    credentials: { apiKey: 'key-a', secretKey: 'secret-a', merchantId: 'merchant-a' },
    trackingUrlTemplate: 'https://track.example.test/{tracking_number}',
  }
  const result = await provider.dmoveShippingAdapter.createParcel(config, {
    orderId: 'order-a',
    shipmentId: 'shipment-a',
    recipient: { name: 'Somchai', phone: '0812345678', address: 'Bangkok 10220' },
    sender: { name: 'Shop', phone: '0899999999', address: 'Origin address' },
    weight: 1.25,
    courierCode: 'dmove',
    idempotencyKey: 'job-a',
  })
  const body = JSON.parse(requests[0].init.body)

  assert.equal(requests[0].url, 'https://api.example.test/v1/parcels')
  assert.equal(requests[0].init.headers.Authorization, 'Bearer key-a')
  assert.equal(requests[0].init.headers['X-API-Secret'], 'secret-a')
  assert.equal(requests[0].init.headers['X-Merchant-Id'], 'merchant-a')
  assert.equal(requests[0].init.headers['Idempotency-Key'], 'job-a')
  assert.deepEqual(body.recipient, {
    name: 'Somchai',
    phone: '0812345678',
    address: 'Bangkok 10220',
  })
  assert.deepEqual(body.sender, {
    name: 'Shop',
    phone: '0899999999',
    address: 'Origin address',
  })
  assert.equal(body.weight, 1.25)
  assert.equal(body.courier_code, 'dmove')
  assert.equal(result.trackingNumber, 'TH123456789')
  assert.equal(result.labelPdfUrl, 'https://labels.example.test/label.pdf')
  assert.equal(result.trackingUrl, 'https://track.example.test/TH123456789')
})

test('shipping adapter refuses private-network endpoints before making a request', async () => {
  let requests = 0
  const provider = load(
    'lib/features/shipping/shipping-provider.ts',
    {
      'server-only': {},
      'node:net': require('node:net'),
      '@/lib/integrations/shipping/beemove-adapter': { beemoveShippingAdapter: {} },
      'node:dns/promises': { lookup: async () => [{ address: '10.0.0.5' }] },
    },
    {
      fetch: async () => {
        requests++
        return Response.json({ success: true })
      },
      AbortSignal,
      URL,
    },
  )

  await assert.rejects(
    provider.dmoveShippingAdapter.testConnection({
      provider: 'dmove',
      apiEndpoint: 'https://carrier.example.test',
      credentials: { apiKey: 'secret' },
      trackingUrlTemplate: 'https://track.example.test/{tracking_number}',
    }),
    /SHIPPING_PROVIDER_ENDPOINT_INVALID/,
  )
  assert.equal(requests, 0)
})
