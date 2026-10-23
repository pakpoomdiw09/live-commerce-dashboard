const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')

test('confirmed claim updates shared metadata immediately, preserves unread counts and ignores stale/foreign snapshots', () => {
  const refs = [],
    values = []
  let refIndex = 0,
    stateIndex = 0
  const react = {
    useCallback: (fn) => fn,
    useEffect() {},
    useRef(value) {
      const i = refIndex++
      return (refs[i] ??= { current: value })
    },
    useState(value) {
      const i = stateIndex++
      if (!(i in values)) values[i] = value
      return [
        values[i],
        (next) => {
          values[i] = typeof next === 'function' ? next(values[i]) : next
        },
      ]
    },
  }
  const { LatestInboxRequest } = load('lib/features/inbox/inbox-request.ts')
  const { useInboxState } = load('hooks/inbox/useInboxState.ts', {
    react,
    '@/lib/supabase/browser': {},
    '@/lib/utils': {},
    '@/lib/features/inbox/inbox-request': { LatestInboxRequest },
    '@/lib/features/inbox/inbox-realtime': {},
  })
  const hook = (tenant) => {
    stateIndex = 0
    refIndex = 0
    return useInboxState(tenant, ['customer'])
  }
  const first = hook('shop')
  values[0] = {
    viewerId: 'actor',
    conversations: [
      { id: 'customer', conversation_version: 1, unread_count: 7, bot_enabled: true },
    ],
  }
  const saved = {
    id: 'customer',
    tenant_id: 'shop',
    conversation_version: 2,
    assigned_user_id: 'actor',
    bot_enabled: false,
    conversation_status: 'open',
    inbound_seq: 1,
  }
  first.applyConversation(saved)
  assert.equal(values[0].conversations[0].assigned_user_id, 'actor')
  assert.equal(values[0].conversations[0].bot_enabled, false)
  assert.equal(values[0].conversations[0].unread_count, 7)
  first.applyConversation({ ...saved, conversation_version: 1, bot_enabled: true })
  assert.equal(values[0].conversations[0].bot_enabled, false)
  hook('other-shop')
  first.applyConversation({ ...saved, conversation_version: 3 })
  assert.equal(values[0].conversations[0].conversation_version, 2)
})

test('Inbox diagnostic errors retain query context while hiding credentials', () => {
  const entries = [],
    secret = 'private-page-token'
  const { logInboxError } = load(
    'lib/features/inbox/inbox-diagnostics.ts',
    {},
    {
      process: { env: { PAGE_ACCESS_TOKEN: secret } },
      console: { error: (...args) => entries.push(args) },
    },
  )
  logInboxError(
    'manage_inbox_pro',
    { code: '42703', message: secret, details: 'Missing column', hint: 'Apply migration' },
    { status: 400 },
  )
  assert.equal(entries[0][1].status, 400)
  assert.equal(entries[0][1].details, 'Missing column')
  assert.ok(!JSON.stringify(entries).includes(secret))
})
