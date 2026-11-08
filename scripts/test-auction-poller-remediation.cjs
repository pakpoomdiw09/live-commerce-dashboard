const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture, comment, pageUrl } = require('./test-auction-poller-hardening.cjs')

test('live query retains ordering/stream and explicitly requests no quality filter', async () => {
  const f = fixture({ pages: () => ({ data: [] }) })
  await f.poll()
  const url = new URL(f.graphCalls[0].url)
  assert.equal(url.searchParams.get('order'), 'reverse_chronological')
  assert.equal(url.searchParams.get('filter'), 'stream')
  assert.equal(url.searchParams.get('live_filter'), 'no_filter')
})

test('paging refuses another video, another edge and another version before any bearer request', async () => {
  for (const path of ['/v25.0/999/comments', '/v25.0/456/feed', '/v24.0/456/comments', '/v25.0/456/comments/extra']) {
    const f = fixture({ pages: () => ({ data: [comment(path)], paging: { next: 'https://graph.facebook.com' + path } }) })
    assert.equal((await f.poll()).status, 503)
    assert.equal(f.graphCalls.length, 1)
  }
})

test('cursor shifts cannot skip a newly inserted intermediate page', async () => {
  const f = fixture({ cursor: {
    high_water_at: '2026-02-01T00:10:00Z', continuation_url: pageUrl(11),
    continuation_anchor_url: pageUrl(2), continuation_boundary_at: '2026-02-01T00:00:00Z', updated_at: new Date().toISOString(),
  }, pages: (page) => ({ data: [comment('shift-' + page, '2026-02-01T00:10:01Z')],
    ...(page === 1 || page === 2 ? { paging: { next: pageUrl(page + 1) } } : {}) }) })
  assert.equal((await f.poll()).status, 200)
  assert.deepEqual(f.graphCalls.map(c => new URL(c.url).searchParams.get('page') ?? '1'), ['1','2','3'])
})
