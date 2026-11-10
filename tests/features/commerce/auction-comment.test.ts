import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAuctionComment } from '../../../lib/integrations/facebook/auction-comment-parser'
import { parseWebhook } from '../../../lib/integrations/facebook/webhook-envelope'

test('opening chatter uses opening intent, including incidental numbers', () => {
  for (const text of [
    'เปิด',
    'เปิดให้',
    'เปิดให้ 10 ลุ้น',
    'เปิด 10 ลุ้น',
    'ขอเปิด',
    'เปิดครับ',
    'เปิดค่ะ',
    'เจิม',
    '+',
  ])
    assert.deepEqual(
      parseAuctionComment(text, false, {
        keywords: [],
        opening_tags: [text],
        closeEnabled: true,
        heartCloses: false,
      }),
      { type: 'OPENING_BID' },
      text,
    )
})

test('host identity determines close commands; numeric comments are not host controls', () => {
  for (const text of ['ปิด', ' ปิด ']) {
    assert.deepEqual(parseAuctionComment(text, true), {
      type: 'HOST_CONTROL',
      action: 'close',
    })
    assert.deepEqual(parseAuctionComment(text), { type: 'IGNORE' })
  }
  assert.deepEqual(parseAuctionComment('1', false, null, true), { type: 'CONFIRM_BID' })
  assert.deepEqual(parseAuctionComment('1'), { type: 'NUMERIC_BID', amount: 1 })
  assert.deepEqual(parseAuctionComment('+1'), { type: 'IGNORE' })
  assert.deepEqual(parseAuctionComment('กด 1'), { type: 'IGNORE' })
  assert.deepEqual(parseAuctionComment('250', true), { type: 'IGNORE' })
})

test('empty tags use defaults while configured tags replace defaults and respect disabled automation', () => {
  const automation = {
    keywords: [],
    closeKeywords: [],
    closeEnabled: true,
    heartCloses: false,
  }
  assert.deepEqual(parseAuctionComment('ปิด', true, automation), {
    type: 'HOST_CONTROL',
    action: 'close',
    count: null,
  })
  assert.deepEqual(parseAuctionComment('1', false, automation, true), { type: 'CONFIRM_BID' })
  assert.deepEqual(
    parseAuctionComment('stop', true, {
      ...automation,
      closeKeywords: ['stop'],
      closeEnabled: false,
    }),
    { type: 'IGNORE' },
  )
  const custom = {
    ...automation,
    keywords: ['11', '111', ' CONFIRM '],
    closeKeywords: ['XXX', 'XX', 'X'],
  }
  for (const tag of ['11', '111', ' confirm ', ' ＣＯＮＦＩＲＭ '])
    assert.deepEqual(parseAuctionComment(tag, false, custom), { type: 'CONFIRM_BID' })
  assert.deepEqual(parseAuctionComment('1', false, custom), { type: 'NUMERIC_BID', amount: 1 })
  assert.deepEqual(parseAuctionComment('ปิด', true, custom), { type: 'IGNORE' })
  for (const tag of ['X', 'xx', ' XXX '])
    assert.deepEqual(parseAuctionComment(tag, true, custom), {
      type: 'HOST_CONTROL',
      action: 'close',
    })
  assert.deepEqual(parseAuctionComment('prefixXXX', true, custom), { type: 'IGNORE' })
})

test('configured closing keywords include composed and repeated emoji text for the Page only', () => {
  const automation = {
    keywords: ['1'],
    closeKeywords: ['ปิด🛑', '❌❌❌'],
    closeEnabled: true,
    heartCloses: false,
  }
  for (const text of ['ปิด🛑', ' ปิด🛑 ', '❌❌❌']) {
    assert.deepEqual(parseAuctionComment(text, true, automation), {
      type: 'HOST_CONTROL',
      action: 'close',
      count: null,
    })
    assert.deepEqual(parseAuctionComment(text, false, automation), { type: 'IGNORE' })
  }
  assert.deepEqual(parseAuctionComment('ปิด🛑 ครับ', true, automation), { type: 'IGNORE' })
})

test('prices must be an entire valid number, not embedded product or phone chatter', () => {
  for (const [text, amount] of [
    ['220', 220],
    ['1,250', 1250],
    ['250.50 บาท', 250.5],
    ['３００', 300],
  ] as const)
    assert.deepEqual(parseAuctionComment(text), { type: 'NUMERIC_BID', amount })
  for (const text of [
    '0',
    '-250',
    '250.001',
    '1e3',
    '1,00',
    'โทร 0812345678',
    'CF 250',
    'ปิดราคา 250',
    '',
  ])
    assert.deepEqual(parseAuctionComment(text), { type: 'IGNORE' }, text)
})

test('all live commenters and the host share a queue ordering key', () => {
  const changes = ['900', '901', '100'].map((sender, index) => ({
    field: 'feed',
    value: {
      item: 'comment',
      verb: 'add',
      comment_id: `456_${index}`,
      post_id: '456',
      from: { id: sender },
      message: index === 2 ? 'ปิด' : 'เปิด',
    },
  }))
  const events = parseWebhook(
    Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: '100', changes }] })),
  ).events
  assert.equal(new Set(events.map((e) => e.orderingKey)).size, 1)
  assert.equal(events[0].orderingKey, 'comments:100')
})
