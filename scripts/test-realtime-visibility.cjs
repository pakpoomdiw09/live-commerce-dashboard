const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')

function fixture() {
  const listeners = new Set(),
    timers = new Map()
  let now = 100000,
    id = 0
  const document = {
    visibilityState: 'visible',
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  }
  class FakeDate extends Date {
    static now() {
      return now
    }
  }
  const globals = {
    document,
    Date: FakeDate,
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, at: now + ms })
      return id
    },
    clearTimeout: (key) => timers.delete(key),
  }
  const visibility = load('lib/realtime-visibility.ts', {}, globals)
  return {
    globals,
    visibility,
    listeners,
    timers,
    visible(value) {
      document.visibilityState = value ? 'visible' : 'hidden'
      for (const fn of [...listeners]) fn()
    },
    advance(ms) {
      now += ms
      for (const [key, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(key)
          timer.fn()
        }
    },
  }
}

test('visibility resource starts once, releases on hide, reconnects on show and cannot restart after cleanup', () => {
  const f = fixture()
  let starts = 0,
    stops = 0
  f.visible(false)
  const stop = f.visibility.subscribeWhileVisible(() => {
    starts++
    return () => {
      stops++
    }
  })
  assert.equal(starts, 0)
  f.visible(true)
  f.visible(true)
  assert.equal(starts, 1)
  f.visible(false)
  f.visible(false)
  assert.equal(stops, 1)
  f.visible(true)
  assert.equal(starts, 2)
  stop()
  stop()
  assert.equal(stops, 2)
  assert.equal(f.listeners.size, 0)
  f.visible(true)
  assert.equal(starts, 2)
})

test('server-page subscriptions require tenant scope and coalesce bursts to at most one refresh per 30 seconds', () => {
  const f = fixture(),
    effects = [],
    channels = []
  let refreshed = 0,
    removed = 0
  const db = {
    channel(name) {
      const row = {
        name,
        events: [],
        on(_, filter, callback) {
          row.events.push({ filter, callback })
          return row
        },
        subscribe(callback) {
          row.status = callback
          return row
        },
      }
      channels.push(row)
      return row
    },
    removeChannel: async () => {
      removed++
    },
  }
  const api = load(
    'components/shared/LiveRefresh.tsx',
    {
      react: { useMemo: (fn) => fn(), useEffect: (fn) => effects.push(fn) },
      'next/navigation': {
        useRouter: () => ({
          refresh: () => {
            refreshed++
          },
        }),
      },
      '@/lib/supabase/browser': { supabaseBrowser: () => db },
      '@/lib/realtime-visibility': f.visibility,
    },
    f.globals,
  )
  api.LiveRefresh({ channel: 'overview', tables: ['orders', 'slips'] })
  assert.equal(effects.pop()(), undefined)
  assert.equal(channels.length, 0)
  api.LiveRefresh({ channel: 'overview', tables: ['orders', 'slips'], filter: 'tenant_id=eq.shop' })
  const stop = effects.pop()()
  const first = channels[0]
  first.status('SUBSCRIBED')
  assert.equal(
    first.events.every((e) => e.filter.filter === 'tenant_id=eq.shop'),
    true,
  )
  for (let i = 0; i < 100; i++) first.events[0].callback()
  f.advance(800)
  assert.equal(refreshed, 1)
  for (let i = 0; i < 100; i++) first.events[0].callback()
  f.advance(29999)
  assert.equal(refreshed, 1)
  f.advance(1)
  assert.equal(refreshed, 2)
  f.visible(false)
  assert.equal(removed, 1)
  first.events[0].callback()
  assert.equal(f.timers.size, 0)
  f.visible(true)
  assert.equal(channels.length, 2)
  assert.notEqual(channels[0].name, channels[1].name)
  channels[1].status('SUBSCRIBED')
  f.advance(30000)
  assert.equal(refreshed, 3)
  stop()
  assert.equal(removed, 2)
  assert.equal(f.listeners.size, 0)
  assert.equal(f.timers.size, 0)
  channels[1].events[0].callback()
  assert.equal(f.timers.size, 0)
})
