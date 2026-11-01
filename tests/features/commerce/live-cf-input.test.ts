import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extractFacebookLiveId,
  quickLiveProduct,
  displayLiveReplyTemplate,
  storedLiveReplyTemplate,
} from '../../../lib/features/commerce/live-cf-setup'

test('Thai message fields round-trip to the existing delivery format and keep unknown text intact', () => {
  const stored = '{product_name} {variant_name} {price} {total} {payment_link} {other} สวัสดี'
  const displayed = displayLiveReplyTemplate(stored)
  assert.equal(
    displayed,
    '{ชื่อสินค้า} {ตัวเลือกสินค้า} {ราคา} {ยอดชำระ} {ลิงก์ชำระเงิน} {other} สวัสดี',
  )
  assert.equal(storedLiveReplyTemplate(displayed), stored)
  assert.equal(storedLiveReplyTemplate(stored), stored)
})

test('live input extracts numeric IDs from Facebook video and watch URLs without losing precision', () => {
  for (const [value, id] of [
    ['', ''],
    ['   ', ''],
    [' 123456789012345678 ', '123456789012345678'],
    ['100_456', '100_456'],
    ['https://www.facebook.com/shop/videos/123456789012345678/?ref=watch', '123456789012345678'],
    ['https://m.facebook.com/watch/?v=456&ref=sharing', '456'],
    ['https://www.facebook.com/watch/live/?v=456', '456'],
    ['https://facebook.com/video.php?v=456', '456'],
    ['www.facebook.com/shop/videos/live-sale/456/', '456'],
    ['https://web.facebook.com/live/456/', '456'],
  ])
    assert.equal(extractFacebookLiveId(value), id, value)
})

test('live input rejects unrelated URLs, misleading domains and opaque short/share links', () => {
  for (const input of [
    null,
    456,
    {},
    'abc',
    '123/456',
    'x'.repeat(2049),
    'https://example.com/videos/456',
    'https://facebook.com.evil.test/videos/456',
    'https://facebook.com@evil.test/videos/456',
    'https://evil@facebook.com/videos/456',
    'javascript:alert(456)',
    'https://fb.watch/abc/',
    'https://facebook.com/share/v/abc/',
    'https://facebook.com/shop?v=456',
    'https://facebook.com/watch/?v=abc',
  ])
    assert.equal(extractFacebookLiveId(input), null, String(input))
})

test('quick product validates the form and publishes using the existing product code column', () => {
  const value = quickLiveProduct({
    name: ' เสื้อไลฟ์ ',
    price: '159.50',
    stock: '7',
    cf_code: ' A1 ',
  })
  assert.equal(value.name, 'เสื้อไลฟ์')
  assert.equal(value.code, 'A1')
  assert.equal(value.price, 159.5)
  assert.equal(value.stock, 7)
  assert.equal(value.is_active, true)
  assert.deepEqual(value.variants, [])
  for (const invalid of [
    { name: '' },
    { price: '' },
    { price: 'NaN' },
    { price: '1.001' },
    { price: '-1' },
    { stock: '' },
    { stock: '-1' },
    { stock: '1.5' },
    { stock: '1000001' },
    { cf_code: '' },
    { cf_code: 'A 1' },
    { cf_code: 'a'.repeat(21) },
  ])
    assert.throws(() =>
      quickLiveProduct({ name: 'สินค้า', price: '159', stock: '7', cf_code: 'A1', ...invalid }),
    )
})
