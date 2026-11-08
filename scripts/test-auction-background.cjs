const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')

test('headless timer resolves an expired round once and cancels its background work on unmount', async () => {
  let effect,
    tick,
    cleanup,
    clock = 0,
    notifications = 0,
    cleared = false
  const calls = []
  const listeners = new Map()
  const { LiveAuctionTimer } = load(
    'components/live-cf/LiveAuctionTimer.tsx',
    {
      react: {
        useRef: (current) => ({ current }),
        useEffect: (callback) => {
          effect = callback
        },
      },
    },
    {
      AbortController,
      URLSearchParams,
      performance: { now: () => clock },
      document: {
        visibilityState: 'visible',
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name) => listeners.delete(name),
      },
      setInterval: (callback) => {
        tick = callback
        return 1
      },
      clearInterval: () => {
        cleared = true
      },
      fetch: async (_url, init) => {
        calls.push(init)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: init.method === 'POST' ? 'closed' : 'active',
            serverNow: '2026-01-01T00:00:00Z',
            ends_at: '2026-01-01T00:00:01Z',
          }),
        }
      },
    },
  )
  assert.equal(
    LiveAuctionTimer({
      tenantId: 'tenant',
      auctionId: 'auction',
      onResolved: () => notifications++,
    }),
    null,
  )
  cleanup = effect()
  await new Promise(setImmediate)
  clock = 1000
  tick()
  await new Promise(setImmediate)
  assert.equal(JSON.parse(calls[1].body).action, 'expire')
  assert.equal(notifications, 1)
  tick()
  assert.equal(calls.length, 2)
  cleanup()
  assert.equal(cleared, true)
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(listeners.size, 0)
})

test('headless comment poller aborts in-flight reads without scheduling another request on unmount', async () => {
  let effect,
    finish,
    scheduled = 0,
    signal
  const { LiveCommentPoller } = load(
    'components/live-cf/LiveCommentPoller.tsx',
    {
      react: {
        useRef: (current) => ({ current }),
        useEffect: (callback) => {
          effect = callback
        },
      },
    },
    {
      AbortController,
      setTimeout: () => {
        scheduled++
        return 1
      },
      clearTimeout() {},
      fetch: (_url, init) => {
        signal = init.signal
        return new Promise((resolve) => {
          finish = resolve
        })
      },
    },
  )
  assert.equal(LiveCommentPoller({ pageId: '100', sessionId: 'session' }), null)
  const cleanup = effect()
  cleanup()
  assert.equal(signal.aborted, true)
  finish({ status: 200, ok: true, json: async () => ({ queued: 1 }) })
  await new Promise(setImmediate)
  assert.equal(scheduled, 0)
})

test('inaccessible videos notify once and stop headless polling', async () => {
  let effect,
    notices = 0,
    scheduled = 0
  const { LiveCommentPoller } = load(
    'components/live-cf/LiveCommentPoller.tsx',
    {
      react: {
        useRef: (current) => ({ current }),
        useEffect: (callback) => {
          effect = callback
        },
      },
    },
    {
      AbortController,
      setTimeout: () => {
        scheduled++
        return 1
      },
      clearTimeout() {},
      fetch: async () => ({
        status: 502,
        ok: false,
        json: async () => ({ reason: 'VIDEO_NOT_ACCESSIBLE' }),
      }),
    },
  )
  assert.equal(
    LiveCommentPoller({ pageId: '100', sessionId: 'session', onVideoUnavailable: () => notices++ }),
    null,
  )
  const cleanup = effect()
  await new Promise(setImmediate)
  assert.equal(notices, 1)
  assert.equal(scheduled, 0)
  cleanup()
})

test('headless polling forwards only aggregate missing-author counts to the dashboard', async () => {
  let effect,
    count = null
  const { LiveCommentPoller } = load(
    'components/live-cf/LiveCommentPoller.tsx',
    {
      react: {
        useRef: (current) => ({ current }),
        useEffect: (callback) => {
          effect = callback
        },
      },
    },
    {
      AbortController,
      setTimeout: () => 1,
      clearTimeout() {},
      fetch: async () => ({
        status: 200,
        ok: true,
        json: async () => ({ skipped: { MISSING_FROM_ID: 4 } }),
      }),
    },
  )
  assert.equal(
    LiveCommentPoller({
      pageId: '100',
      sessionId: 'session',
      onSkippedAuthors: (value) => {
        count = value
      },
    }),
    null,
  )
  const cleanup = effect()
  await new Promise(setImmediate)
  assert.equal(count, 4)
  cleanup()
})

test('headless polling exposes only recognized aggregate skip reasons', async () => {
 let effect, result
 const { LiveCommentPoller } = load('components/live-cf/LiveCommentPoller.tsx', {
 react: { useRef: current => ({ current }), useEffect: callback => { effect = callback } }
 }, { AbortController, setTimeout: () => 1, clearTimeout() {}, fetch: async () => ({ status: 200, ok: true,
 json: async () => ({ skipped: { MISSING_MESSAGE: 3, INVALID_CREATED_TIME: 2, MISSING_FROM_ID: 1, unexpected_private_data: 7 } }) }) })
 assert.equal(LiveCommentPoller({ pageId: '100', sessionId: 'fixture', onSkipped: value => { result = value } }), null)
 const cleanup = effect(); await new Promise(setImmediate)
 assert.deepEqual(JSON.parse(JSON.stringify(result ?? null)), { MISSING_FROM_ID: 1, MISSING_MESSAGE: 3, INVALID_CREATED_TIME: 2 })
 cleanup()
})
