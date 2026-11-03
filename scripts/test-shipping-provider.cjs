const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')

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
