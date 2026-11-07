import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseLiveCfCodes,
  addLiveCfCode,
  matchLiveCfCode,
  liveCfCodeExamples,
  previewLiveCfCodes,
} from '../../../lib/features/commerce/live-cf-codes'
import { matchOrderCode } from '../../../lib/features/commerce/cf-code'
import { liveRuleCode } from '../../../lib/features/comments/comment-rules'

test('Contains matches partial keywords, punctuation and mixed letter/number spacing identically in preview and webhook', () => {
  for (const [code, comments] of [
    ['CF159', ['cf159?', 'เอา cf 159', 'ข้อความก่อน CF 159! ข้อความหลัง', 'xxcf159yy']],
    ['159', ['cf159?', 'รับ 159 ครับ', 'เอา cf 159', '1590', 'abc159xyz']],
    ['A1', ['รับ a 1 ค่ะ?! ', 'BA12', 'ａ１？']],
    ['เสื้อ', ['ขอเสื้อผ้าค่ะ!', 'เสื้อ,']],
    ['01', ['รับ01ครับ', '01 . , ! ? ']],
    ['A-1', ['รับ a-1!', 'a-1.']],
    ['A_', ['a_!', 'รับ a_']],
  ] as const) {
    for (const comment of comments) {
      assert.equal(matchLiveCfCode(comment, [code], 'flexible'), code, comment)
      assert.equal(
        liveRuleCode({ keywords: [code], match_type: 'keyword' }, comment),
        code.toLowerCase(),
        comment,
      )
    }
  }
  for (const comment of ['cf159?', 'cf 159', 'เอา cf 159', 'cf159 ครับ']) {
    assert.equal(matchLiveCfCode(comment, ['CF159'], 'strict'), null, comment)
    assert.equal(liveRuleCode({ keywords: ['CF159'], match_type: 'exact' }, comment), null, comment)
  }
  assert.equal(matchLiveCfCode('  cF159  ', ['CF159'], 'strict'), 'CF159')
  for (const comment of ['', '?! . , ', 'ข้อความทั่วไป', 'CF158', 'CF 158'])
    assert.equal(matchLiveCfCode(comment, ['CF159'], 'flexible'), null, comment)
  assert.equal(matchLiveCfCode('159', [''], 'flexible'), null)
  assert.equal(matchLiveCfCode('1', ['01'], 'flexible'), null)
  assert.equal(matchLiveCfCode('0 1', ['01'], 'flexible'), null)
  assert.equal(matchLiveCfCode('a1', ['A-1'], 'flexible'), null)
})

test('draft codes preview only configured prefixes without adding a saved tag', () => {
  const codes: string[] = []
  assert.deepEqual(previewLiveCfCodes(codes, ''), [])
  assert.deepEqual(
    liveCfCodeExamples(previewLiveCfCodes(codes, 'A1'), 'flexible', ['RESERVE', 'รับ']),
    ['A1', 'RESERVE A1', 'รับ A1'],
  )
  assert.deepEqual(liveCfCodeExamples(['A1'], 'flexible'), ['A1'])
  assert.deepEqual(codes, [])
  for (const code of ['01', '159', 'เสื้อ']) {
    assert.deepEqual(previewLiveCfCodes([], code), [code])
    assert.deepEqual(liveCfCodeExamples([code], 'strict'), [code])
  }
  assert.deepEqual(previewLiveCfCodes(['A1'], 'a1'), ['A1'])
  assert.deepEqual(previewLiveCfCodes([], '  '), [])
  assert.deepEqual(previewLiveCfCodes([], 'A 1'), [])
  assert.deepEqual(previewLiveCfCodes(['A1', 'B2', 'C3', 'D4', 'E5'], 'F6'), [
    'A1',
    'B2',
    'C3',
    'D4',
    'E5',
  ])
})

test('webhook matching accepts bare, joined Thai booking words and polite endings without requiring a Latin prefix', () => {
  for (const code of ['A1', '01', '159', 'เสื้อ', 'จอง']) {
    for (const prefix of ['', 'รับ', 'จอง', 'เอา', 'ปิด']) {
      for (const separator of ['', ' ']) {
        for (const suffix of ['', ' ครับ', ' ค่ะ', 'ครับ', 'ค่ะ']) {
          const comment = `${prefix}${separator}${code}${suffix}`
          assert.equal(matchOrderCode(comment, code, 'flexible'), true, comment)
          assert.equal(matchLiveCfCode(comment, [code], 'flexible'), code, comment)
        }
      }
    }
    for (const prefix of ['รับ', 'จอง', 'เอา', 'ปิด']) {
      assert.equal(matchOrderCode(`${prefix}${code}`, code, 'strict'), false)
    }
  }
  for (const [comment, code] of [
    ['1590', '159'],
    ['ปิด1590', '159'],
    ['A12', 'A1'],
    ['BA1', 'A1'],
    ['B01', '01'],
    ['A1-2', 'A1'],
    ['เสื้อ', 'เส'],
    ['เสื้อผ้า', 'เสื้อ'],
    ['สวัสดีครับ', 'A1'],
  ])
    assert.equal(matchOrderCode(comment, code), false, `${comment} must not match ${code}`)
})

test('Live CF tags preserve display case, accept one to five codes and reject equivalent duplicates', () => {
  assert.deepEqual(parseLiveCfCodes([' A1 ', '159', 'จอง', 'B2', 'รับ1']), [
    'A1',
    '159',
    'จอง',
    'B2',
    'รับ1',
  ])
  assert.deepEqual(addLiveCfCode(['A1'], '159'), ['A1', '159'])
  for (const input of [
    null,
    'A1',
    [],
    [''],
    ['  '],
    ['A1', 'a1'],
    ['Ａ１', 'A1'],
    ['A 1'],
    ['a'.repeat(41)],
    [159],
    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'],
  ])
    assert.throws(() => parseLiveCfCodes(input))
  assert.throws(() => addLiveCfCode(['A1'], ''), /กรุณากรอกรหัส/)
  assert.throws(() => addLiveCfCode(['A1', 'B1', 'C1', 'D1', 'E1'], 'F1'), /เพิ่มได้สูงสุด 5 รหัส/)
})

test('all Live CF tag examples match using the webhook rules in flexible and strict mode', () => {
  const codes = ['A1', '159', 'จอง']
  for (const mode of ['flexible', 'strict'] as const) {
    for (const code of codes) assert.equal(matchLiveCfCode(code, codes, mode), code)
    for (const example of liveCfCodeExamples(codes, mode))
      assert.ok(matchLiveCfCode(example, codes, mode), example)
    assert.ok(liveCfCodeExamples(codes, mode).every((example) => !/\b(?:cf|fc)\b/i.test(example)))
  }
  assert.equal(matchLiveCfCode('CF 159', codes, 'strict'), null)
  assert.equal(matchLiveCfCode('รับ A1', codes, 'flexible'), 'A1')
  assert.equal(matchLiveCfCode('CF 1590', ['A1', '159'], 'flexible'), '159')
  assert.equal(matchLiveCfCode('ข้อความทั่วไป', codes, 'flexible'), null)
  assert.equal(matchLiveCfCode('159', [], 'flexible'), null)
})
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

test('quick product preserves categories, photos and sale settings and totals variant stock', () => {
  const value = quickLiveProduct({
    name: 'พระเนื้อเงิน',
    cf_code: 'AM1',
    price: '999',
    stock: '',
    category_id: '77777777-7777-4777-8777-777777777777',
    description: ' รายละเอียดพระเครื่อง ',
    images: ['https://storage.example/one.webp'],
    is_active: false,
    featured: true,
    variants: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        label: 'พิมพ์ใหญ่',
        variant_code: 'AM1-L',
        price: '1099.50',
        stock: '3',
      },
      {
        id: '99999999-9999-4999-8999-999999999999',
        label: 'พิมพ์เล็ก',
        variant_code: '',
        price: '999',
        stock: '2',
      },
    ],
  })
  assert.equal(value.stock, 5)
  assert.equal(value.is_active, false)
  assert.equal(value.featured, true)
  assert.equal(value.description, 'รายละเอียดพระเครื่อง')
  assert.equal(value.category_id, '77777777-7777-4777-8777-777777777777')
  assert.deepEqual(value.images, ['https://storage.example/one.webp'])
  assert.equal(value.variants[0].id, '88888888-8888-4888-8888-888888888888')
  assert.equal(value.variants[0].price, 1099.5)
  for (const invalid of [
    { stock: '' },
    { stock: '-1' },
    { stock: '1.5' },
    { price: '' },
    { price: '0' },
    { label: '' },
  ])
    assert.throws(() =>
      quickLiveProduct({
        name: 'สินค้า',
        cf_code: 'A1',
        price: '159',
        stock: '0',
        variants: [
          {
            id: '88888888-8888-4888-8888-888888888888',
            label: 'พิมพ์ใหญ่',
            variant_code: '',
            price: '159',
            stock: '2',
            ...invalid,
          },
        ],
      }),
    )
  assert.throws(() =>
    quickLiveProduct({
      name: 'สินค้า',
      cf_code: 'A1',
      price: '159',
      stock: '1',
      images: ['javascript:alert(1)'],
    }),
  )
})
