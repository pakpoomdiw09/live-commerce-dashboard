const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  load = require('./helpers/load-typescript.cjs')
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('channel names are unique without crypto or a secure browser context', () => {
  const realtime = load('lib/features/inbox/inbox-realtime.ts')
  const names = Array.from({ length: 100 }, () => realtime.inboxChannelName('inbox', 'tenant'))
  assert.equal(new Set(names).size, 100)
  assert.ok(names.every((name) => name.startsWith('inbox:tenant:')))
  assert.ok(realtime.inboxChannelName('inbox-state', 'tenant').startsWith('inbox-state:tenant:'))
})
test('browser renders share one client; SSR calls are not shared', () => {
  let created = 0
  const deps = {
    '@supabase/ssr': { createBrowserClient: () => ({ id: ++created }) },
    '@/lib/supabase/env': {
      requireSupabaseEnv: () => ({ url: 'https://example.test', anonKey: 'public' }),
    },
  }
  const browser = load('lib/supabase/browser.ts', deps, { window: {} })
  const first = browser.supabaseBrowser()
  for (let i = 0; i < 100; i++) assert.equal(browser.supabaseBrowser(), first)
  assert.equal(created, 1)
  const server = load('lib/supabase/browser.ts', deps)
  assert.notEqual(server.supabaseBrowser(), server.supabaseBrowser())
  assert.equal(created, 3)
})
function metadataFixture() {
  const values = [],
    memos = [],
    effects = [],
    pending = [],
    timers = new Map(),
    listeners = new Map(),
    signals = []
  let cursor = 0,
    now = 100000,
    timerId = 0,
    fetches = 0,
    fail = false,
    block = false,
    release
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    useState(value) {
      const i = cursor++
      if (!(i in values)) values[i] = value
      return [
        values[i],
        (next) => {
          values[i] = typeof next === 'function' ? next(values[i]) : next
        },
      ]
    },
    useRef(value) {
      const i = cursor++
      return (values[i] ??= { current: value })
    },
    useCallback(fn, deps) {
      const i = cursor++
      if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { fn, deps }
      return memos[i].fn
    },
    useEffect(fn, deps) {
      const i = cursor++
      if (!effects[i] || !same(effects[i].deps, deps))
        pending.push(() => {
          effects[i]?.cleanup?.()
          effects[i] = { deps, cleanup: fn() }
        })
    },
  }
  class FakeDate extends Date {
    static now() {
      return now
    }
  }
  const document = {
    visibilityState: 'visible',
    addEventListener: (k, v) => listeners.set('document:' + k, v),
    removeEventListener: (k) => listeners.delete('document:' + k),
  }
  const globals = {
    AbortController,
    Date: FakeDate,
    document,
    window: {
      addEventListener: (k, v) => listeners.set(k, v),
      removeEventListener: (k) => listeners.delete(k),
    },
    setTimeout: (fn, ms) => {
      timers.set(++timerId, { fn, at: now + ms })
      return timerId
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (_url, opts) => {
      fetches++
      signals.push(opts.signal)
      if (block) {
        block = false
        await new Promise((resolve) => {
          release = resolve
        })
      }
      return { ok: !fail, json: async () => ({ conversations: [] }) }
    },
  }
  const background = load('lib/background-refresh.ts', {}, globals)
  const api = load(
    'hooks/inbox/useInboxState.ts',
    {
      react,
      '@/lib/background-refresh': background,
      '@/lib/utils': { apiError: async () => 'Unavailable' },
      '@/lib/features/inbox/inbox-request': load(
        'lib/features/inbox/inbox-request.ts',
        {},
        { AbortController },
      ),
    },
    globals,
  )
  return {
    render(tenant = 'tenant-a', ids = ['one']) {
      cursor = 0
      const state = api.useInboxState(tenant, ids)
      while (pending.length) pending.shift()()
      return state
    },
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
    document,
    timers,
    listeners,
    signals,
    count: () => fetches,
    fail: () => {
      fail = true
    },
    block: () => {
      block = true
    },
    release: () => release?.(),
    cleanup() {
      for (const effect of effects) effect?.cleanup?.()
    },
  }
}

test('metadata has no Realtime dependency; rerenders and read/message bursts coalesce into bounded requests', async () => {
  const f = metadataFixture()
  const first = f.render()
  await f.advance(0)
  assert.equal(f.count(), 1)
  for (let i = 0; i < 30; i++) f.render()
  assert.equal(f.count(), 1)
  for (let i = 0; i < 100; i++) void first.refreshSoon()
  await f.advance(9999)
  assert.equal(f.count(), 1)
  await f.advance(1)
  assert.equal(f.count(), 2)
  f.render('tenant-a', ['one', 'two'])
  await f.advance(10000)
  assert.equal(f.count(), 3)
  f.document.visibilityState = 'hidden'
  await f.advance(120000)
  assert.equal(f.count(), 3)
  f.document.visibilityState = 'visible'
  f.listeners.get('document:visibilitychange')()
  await f.advance(0)
  assert.equal(f.count(), 4)
  f.render('tenant-b', ['other'])
  await f.advance(0)
  assert.equal(f.count(), 5)
  f.cleanup()
  assert.equal(f.timers.size, 0)
  assert.equal(f.listeners.size, 0)
  await first.refreshSoon()
  await f.advance(300000)
  assert.equal(f.count(), 5)
})

test('metadata background failures back off and cleanup aborts in-flight requests without late rescheduling', async () => {
  const f = metadataFixture()
  f.fail()
  const state = f.render()
  await f.advance(0)
  assert.equal(f.count(), 1)
  for (let i = 0; i < 100; i++) void state.refreshSoon()
  await f.advance(29999)
  assert.equal(f.count(), 1)
  await f.advance(1)
  assert.equal(f.count(), 2)
  await f.advance(59999)
  assert.equal(f.count(), 2)
  await f.advance(1)
  assert.equal(f.count(), 3)
  f.cleanup()
  const g = metadataFixture()
  g.block()
  g.render()
  await g.advance(0)
  assert.equal(g.count(), 1)
  assert.equal(g.signals[0].aborted, false)
  g.cleanup()
  assert.equal(g.signals[0].aborted, true)
  g.release()
  await flush()
  assert.equal(g.timers.size, 0)
  assert.equal(g.listeners.size, 0)
})
