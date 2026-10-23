const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  load = require('./helpers/load-typescript.cjs')
const flush = () => new Promise((resolve) => setImmediate(resolve))
function clock() {
  let now = 100000,
    id = 0
  const timers = new Map()
  class FakeDate extends Date {
    static now() {
      return now
    }
  }
  const api = load(
    'lib/background-refresh.ts',
    {},
    {
      Date: FakeDate,
      AbortController,
      setTimeout: (fn, ms) => {
        timers.set(++id, { fn, at: now + ms })
        return id
      },
      clearTimeout: (key) => timers.delete(key),
    },
  )
  return {
    api,
    timers,
    async advance(ms) {
      const end = now + ms
      for (let i = 0; i < 100; i++) {
        const next = [...timers].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at
        timers.delete(next[0])
        next[1].fn()
        await flush()
      }
      now = end
    },
    now: () => now,
  }
}
test('refresh bursts never overlap; stop aborts in-flight work and clears timers', async () => {
  const c = clock()
  let calls = 0,
    release,
    signal
  const scheduler = c.api.createBackgroundRefresh(
    async (s) => {
      calls++
      signal = s
      await new Promise((resolve) => (release = resolve))
    },
    () => {},
    { visible: () => true },
  )
  scheduler.request()
  await c.advance(0)
  assert.equal(calls, 1)
  for (let i = 0; i < 100; i++) scheduler.request()
  await c.advance(10000)
  assert.equal(calls, 1)
  release()
  await flush()
  await c.advance(0)
  assert.equal(calls, 2)
  scheduler.stop()
  assert.equal(signal.aborted, true)
  release()
  await flush()
  assert.equal(c.timers.size, 0)
})
test('hidden tabs do not refresh and repeated failures back off', async () => {
  const c = clock()
  let visible = false,
    calls = 0,
    errors = 0
  const scheduler = c.api.createBackgroundRefresh(
    async () => {
      calls++
      throw Error('Unavailable')
    },
    () => errors++,
    { visible: () => visible },
  )
  scheduler.request()
  await c.advance(60000)
  assert.equal(calls, 0)
  visible = true
  scheduler.request()
  await c.advance(0)
  assert.equal(calls, 1)
  await c.advance(29999)
  assert.equal(calls, 1)
  await c.advance(1)
  assert.equal(calls, 2)
  await c.advance(59999)
  assert.equal(calls, 2)
  await c.advance(1)
  assert.equal(calls, 3)
  assert.equal(errors, 3)
  scheduler.stop()
})
test('single-flight cron work is shared only while active and released on success/failure', async () => {
  const api = load('lib/single-flight.ts', {}, { Map, Promise })
  let calls = 0,
    release
  const task = () => {
    calls++
    return new Promise((resolve) => (release = resolve))
  }
  const a = api.singleFlight('cron', task),
    b = api.singleFlight('cron', task)
  await flush()
  assert.equal(calls, 1)
  assert.equal(a, b)
  release('done')
  await a
  await flush()
  await assert.rejects(
    api.singleFlight('cron', async () => {
      throw Error('failed')
    }),
  )
  assert.equal(await api.singleFlight('cron', async () => 'recovered'), 'recovered')
})

test('a provider ignoring pagination stops with an explicit error instead of scanning forever', async () => {
  const api = load('lib/features/broadcast/broadcast.ts', {
    'server-only': {},
    '@/lib/features/agents/chatbot': { MESSAGING_WINDOW_MS: 86400000 },
  })
  let calls = 0
  await assert.rejects(
    api.fetchAll(async () => {
      calls++
      return { data: Array(1000).fill({ id: 'same' }), error: null }
    }),
    /BROADCAST_SCAN_LIMIT/,
  )
  assert.equal(calls, 100)
})
