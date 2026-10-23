const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  load = require('./helpers/load-typescript.cjs')
test('webhook admin fetch bounds stalled requests and preserves caller cancellation', async () => {
  const signals = []
  const api = load(
    'lib/supabase/server.ts',
    {
      'server-only': {},
      '@supabase/supabase-js': { createClient: (_url, _key, options) => options },
      '@supabase/ssr': {},
      'next/headers': {},
      '@/lib/supabase/env': { requireSupabaseEnv: () => ({ url: 'https://example.test' }) },
    },
    {
      process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' } },
      AbortSignal,
      fetch: async (_url, init) => {
        signals.push(init.signal)
        assert.equal(init.cache, 'no-store')
        return new Promise((resolve, reject) => {
          if (init.signal.aborted) reject(init.signal.reason)
          else
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        })
      },
    },
  )
  const db = api.supabaseAdmin({ timeoutMs: 20 })
  const keepAlive = setTimeout(() => {}, 100)
  try {
    await assert.rejects(db.global.fetch('https://example.test'), (e) => e.name === 'TimeoutError')
    const caller = new AbortController(),
      request = db.global.fetch('https://example.test', { signal: caller.signal })
    caller.abort()
    await assert.rejects(request, (e) => e.name === 'AbortError')
    assert.ok(signals.every((signal) => signal.aborted))
  } finally {
    clearTimeout(keepAlive)
  }
})
