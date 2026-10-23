const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  load = require('./helpers/load-typescript.cjs')
test('shared vision loader bounds and deduplicates images; message adapter emits image_url parts', async () => {
  const urls = []
  const api = load(
    'lib/features/agents/llm-vision.ts',
    {
      'server-only': {},
      '@/lib/features/vision/vision-image': {
        downloadVisionImage: async (url) => {
          urls.push(url)
          return { type: 'image/png', arrayBuffer: async () => Buffer.from('image') }
        },
      },
    },
    { Buffer },
  )
  const images = await api.loadLlmImages(['one', 'one', 'two'])
  assert.equal(images.length, 2)
  assert.equal(urls.length, 2)
  const content = api.visionMessageContent('Find this product', images)
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'image_url')
  assert.match(content[1].image_url.url, /^data:image\/png;base64,/)
  await assert.rejects(api.loadLlmImages(['one', 'two', 'three', 'four']), /VISION_IMAGE_LIMIT/)
  assert.equal(urls.length, 2)
  for (const invalid of [undefined, [], [''], [null]])
    await assert.rejects(api.loadLlmImages(invalid), /VISION_IMAGE_URL_MISSING/)
})

test('catalog references are bounded thumbnails labeled with product codes; broken images are skipped', async () => {
  const sharp = require('sharp'),
    png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00f' } })
      .png()
      .toBuffer()
  let downloads = 0,
    active = 0,
    peak = 0
  const api = load(
    'lib/features/agents/llm-vision.ts',
    {
      'server-only': {},
      sharp,
      '@/lib/features/vision/vision-image': {
        downloadVisionImage: async (url, scope) => {
          assert.equal(scope.tenantId, 'tenant')
          downloads++
          active++
          peak = Math.max(peak, active)
          await new Promise((resolve) => setImmediate(resolve))
          active--
          if (url === 'broken') throw Error('expired')
          return { arrayBuffer: async () => png }
        },
      },
    },
    { Buffer },
  )
  const products = Array.from({ length: 20 }, (_, i) => ({
    code: `P${i}`,
    image_url: i === 0 ? 'broken' : `photo-${i}`,
  }))
  const refs = await api.loadCatalogImages(products, 'tenant')
  assert.equal(downloads, 12)
  assert.equal(refs.length, 11)
  assert.ok(peak <= 3)
  assert.equal(refs[0].code, 'P1')
  assert.equal(refs[0].image.mimeType, 'image/webp')
  assert.ok(Buffer.from(refs[0].image.data, 'base64').length <= 256 * 1024)
})

test('catalog downloader accepts only this tenant public storage path', async () => {
  let fetched = 0
  const api = load(
    'lib/features/vision/vision-image.ts',
    { 'server-only': {}, '@/lib/image-signature': { detectImageMime: () => null } },
    {
      URL,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://shop.supabase.co' } },
      fetch: async () => {
        fetched++
        throw Error('download failed')
      },
      AbortSignal,
    },
  )
  await assert.rejects(
    api.downloadVisionImage(
      'https://shop.supabase.co/storage/v1/object/public/comment-media/commerce/other/a.webp',
      { tenantId: 'own' },
    ),
    /UNTRUSTED/,
  )
  await assert.rejects(
    api.downloadVisionImage('https://evil.test/photo', { tenantId: 'own' }),
    /UNTRUSTED/,
  )
  assert.equal(fetched, 0)
  await assert.rejects(
    api.downloadVisionImage(
      'https://shop.supabase.co/storage/v1/object/public/comment-media/commerce/own/a.webp',
      { tenantId: 'own' },
    ),
    /download failed/,
  )
  assert.equal(fetched, 1)
})

test('valid CDN images with missing or binary MIME reach Vision; non-image bodies remain rejected', async () => {
  const png = await require('sharp')({
    create: { width: 2, height: 2, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer()
  const detector = load('lib/image-signature.ts', {}, { Buffer })
  let bytes = png,
    type = 'application/octet-stream'
  const api = load(
    'lib/features/vision/vision-image.ts',
    { 'server-only': {}, '@/lib/image-signature': detector },
    {
      Buffer,
      File,
      URL,
      AbortSignal,
      fetch: async () => new Response(bytes, { headers: type ? { 'content-type': type } : {} }),
    },
  )
  for (const header of ['application/octet-stream', '']) {
    type = header
    const image = await api.downloadVisionImage('https://scontent.fbcdn.net/photo')
    assert.equal(image.type, 'image/png')
    assert.equal(image.size, png.length)
  }
  bytes = Buffer.from('<html>expired</html>')
  type = 'application/octet-stream'
  await assert.rejects(
    api.downloadVisionImage('https://scontent.fbcdn.net/expired'),
    /IMAGE_MIME_INVALID/,
  )
})
