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
    assert.deepEqual(parseAuctionComment(text), { type: 'OPENING_BID' }, text)
})

test('host identity determines commands; a customer cannot close or count', () => {
  for (const text of ['ปิด', 'ปิดประมูล', 'กากบาท', 'x', 'X', 'xxx', 'ปุด', '❌']) {
    assert.deepEqual(parseAuctionComment(text, true), {
      type: 'HOST_CONTROL',
      action: 'close',
      count: null,
    })
    assert.deepEqual(parseAuctionComment(text), { type: 'IGNORE' })
  }
  for (const text of ['1', '2', '3', 'เคาะ 1', 'เคาะ 2', 'เคาะ 3', 'นับขิง'])
    assert.equal(parseAuctionComment(text, true).type, 'HOST_CONTROL')
  assert.equal(
    parseAuctionComment('เคาะ 3', true).type,
    'HOST_CONTROL',
    'third knock is a count, not an implicit close',
  )
  assert.deepEqual(parseAuctionComment('1'), { type: 'STEP_BID' })
  assert.deepEqual(parseAuctionComment('+1'), { type: 'STEP_BID' })
  assert.deepEqual(parseAuctionComment('กด 1'), { type: 'STEP_BID' })
  assert.deepEqual(parseAuctionComment('250', true), { type: 'IGNORE' })
})

test('configured closing keywords include composed and repeated emoji text for the Page only', () => {
  const automation = {
    keywords: ['1'],
    closeKeywords: ['ปิด🛑', '❌❌❌'],
    countEnabled: false,
    closeEnabled: true,
    heartCloses: false,
  }
  for (const text of ['ปิด🛑', 'ปิด🛑 ครับ', '❌❌❌']) {
    assert.deepEqual(parseAuctionComment(text, true, automation), {
      type: 'HOST_CONTROL',
      action: 'close',
      count: null,
    })
    assert.deepEqual(parseAuctionComment(text, false, automation), { type: 'IGNORE' })
  }
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
