// Real component handlers with mock React/Supabase. No .env, network or database writes.
const assert = require('node:assert/strict'),
  { test } = require('node:test'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript')
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
const requests = {}
vm.runInNewContext(compile('lib/features/inbox/inbox-request.ts'), {
  exports: requests,
  Map,
  AbortController,
})
const helpers = {}
vm.runInNewContext(compile('lib/features/inbox/inbox-realtime.ts'), { exports: helpers, Map })
const message = (id, customer_id = 'customer-a', body = id) => ({
  id,
  customer_id,
  body,
  sender: 'customer',
  attachments: null,
  created_at: `2026-10-15T00:00:${id === 'one' ? '01' : '02'}Z`,
})
const flush = () => new Promise((resolve) => setImmediate(resolve))
function fixture(errors = {}, options = {}) {
  const a = { id: 'customer-a', tenant_id: 'shop-a', last_message_at: '2026-10-15T00:00:01Z' },
    b = { id: 'customer-b', tenant_id: 'shop-b', last_message_at: '2026-10-15T00:00:01Z' }
  const customers = [a, b],
    messages = [message('one')],
    queries = [],
    listeners = [],
    effects = [],
    states = [],
    intervals = [],
    removed = []
  const browserListeners = new Map(),
    documentListeners = new Map()
  let stateIndex = 0,
    subscribe,
    channelName,
    cleaned = false
  const channelNames = []
  const db = {
    from(table) {
      const record = { table, filters: [] }
      queries.push(record)
      const q = {
        abortSignal() {
          return q
        },
        select() {
          return q
        },
        order() {
          return q
        },
        limit() {
          return q
        },
        eq(key, value) {
          record.filters.push([key, value])
          return q
        },
        result() {
          let data = (
            table === 'customers'
              ? customers.map((customer) => ({
                  ...customer,
                  messages: messages.filter((m) => m.customer_id === customer.id).slice(-1),
                  slips: [],
                }))
              : table === 'messages'
                ? messages
                : []
          ).filter((row) =>
            record.filters.every(([key, value]) =>
              key === 'customers.tenant_id'
                ? customers.find((c) => c.id === row.customer_id)?.tenant_id === value
                : key.includes('.')
                  ? true
                  : row[key] === value,
            ),
          )
          return { data, error: errors[table] ?? null }
        },
        async maybeSingle() {
          const result = q.result()
          return { data: result.data[0] ?? null, error: null }
        },
        then(resolve, reject) {
          return Promise.resolve(q.result()).then(resolve, reject)
        },
      }
      return q
    },
    channel(name) {
      channelName = name
      channelNames.push(name)
      const channel = {
        on(_kind, filter, handler) {
          listeners.push({ filter, handler })
          return channel
        },
        subscribe(callback) {
          subscribe = callback
          return channel
        },
      }
      return channel
    },
    async removeChannel() {
      cleaned = true
    },
  }
  const react = {
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useEffect: (fn) => effects.push(fn),
    useState: (initial) => {
      const index = stateIndex++
      states[index] = initial
      return [
        initial,
        (value) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value
        },
      ]
    },
  }
  const mod = {}
  vm.runInNewContext(compile('components/inbox/InboxClient.tsx'), {
    exports: mod,
    console,
    Map,
    Set,
    process: { env: { NODE_ENV: 'test' } },
    setTimeout: () => 8,
    clearTimeout: (id) => removed.push(id),
    setInterval: (fn) => {
      intervals.push(fn)
      return 7
    },
    clearInterval: (id) => removed.push(id),
    window: {
      addEventListener: (key, fn) => browserListeners.set(key, fn),
      removeEventListener: (key) => browserListeners.delete(key),
    },
    document: {
      visibilityState: 'visible',
      addEventListener: (key, fn) => documentListeners.set(key, fn),
      removeEventListener: (key) => documentListeners.delete(key),
    },
    require: (name) => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime')
        return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      if (name === '@/lib/supabase/browser') return { supabaseBrowser: () => db }
      if (name === '@/lib/types')
        return {
          CUSTOMER_COLUMNS: 'id,tenant_id,last_message_at',
          CUSTOMER_COLUMNS_WITHOUT_AVATAR: 'id,tenant_id,last_message_at',
          isMissingCustomerAvatarColumn: () => false,
          SLIP_COLUMNS: 'id,tenant_id,customer_id,status,created_at',
        }
      if (name === '@/lib/features/inbox/inbox-realtime') return helpers
      if (name === '@/lib/features/inbox/inbox-request') return requests
      if (name === '@/hooks/inbox/useInboxState')
        return { useInboxState: () => ({ data: null, error: null, refresh: async () => {} }) }
      if (name === '@/lib/utils') return { cn: (...args) => args.filter(Boolean).join(' ') }
      return new Proxy({}, { get: (_, key) => key })
    },
  })
  mod.InboxClient({
    initialChats: options.emptyList
      ? []
      : [{ customer: a, preview: message('one'), latestSlip: null }],
    initialComments: [],
    initialSelectedId: a.id,
    tenant: { id: 'shop-a', name: 'Shop A', autoVerify: true, autoReply: true },
  })
  const cleanups = effects.map((fn) => fn()).filter(Boolean)
  const dispatch = (table, event, row) => {
    for (const { filter, handler } of listeners)
      if (filter.table === table && (filter.event === event || filter.event === '*'))
        handler({
          eventType: event,
          new: event === 'DELETE' ? {} : row,
          old: event === 'DELETE' ? row : {},
        })
  }
  return {
    states,
    queries,
    messages,
    customers,
    intervals,
    channelName,
    channelNames,
    dispatch,
    restart() {
      cleanups.pop()()
      cleanups.push(effects.at(-1)())
    },
    emit: async (table, event, row) => {
      dispatch(table, event, row)
      await flush()
    },
    subscribe: async (status) => {
      subscribe(status)
      await flush()
    },
    cleanup() {
      cleanups.forEach((fn) => fn())
      return (
        cleaned &&
        removed.includes(7) &&
        browserListeners.size === 0 &&
        documentListeners.size === 0
      )
    },
  }
}

test('thread reconciliation preserves in-flight inserts/updates/deletes and deduplicates rows', () => {
  const edits = new Map([
    ['two', { revision: 2, message: message('two') }],
    ['one', { revision: 3, message: null }],
  ])
  const result = helpers.reconcileThread(
    [message('one'), message('two'), message('foreign', 'customer-b')],
    edits,
    1,
    'customer-a',
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'two')
})

test('polling recovers chat messages when comments and slips fail without Realtime', async () => {
  const f = fixture({ comments: { code: '42P01' }, slips: { code: '42501' } })
  await flush()
  assert.equal(f.states[5].length, 1)
  f.messages.push(message('missed'))
  await f.intervals[0]()
  await flush()
  assert.ok(f.states[5].some((row) => row.id === 'missed'))
  assert.equal(f.states[2][0].preview.body, 'missed')
  f.cleanup()
})

test('known customer updates use payloads without per-event queries; healthy Realtime skips frequent snapshots', async () => {
  const f = fixture()
  await flush()
  await f.subscribe('SUBSCRIBED')
  await flush()
  const before = f.queries.length
  for (let i = 0; i < 10; i++)
    await f.emit('customers', 'UPDATE', { ...f.customers[0], display_name: `Name ${i}` })
  await f.intervals[0]()
  await flush()
  assert.equal(f.queries.length, before)
  assert.equal(f.states[2][0].customer.display_name, 'Name 9')
  await f.subscribe('TIMED_OUT')
  await f.intervals[0]()
  await flush()
  assert.ok(f.queries.length > before)
  f.cleanup()
})
test('Inbox subscribes to Realtime, scopes reads to the shop and immediately inserts incoming messages once', async () => {
  const f = fixture()
  await flush()
  assert.match(f.channelName, /^inbox:shop-a:/)
  const thread = f.queries.find((query) => query.table === 'messages')
  assert.ok(thread.filters.some(([key, value]) => key === 'customer_id' && value === 'customer-a'))
  assert.ok(
    thread.filters.some(([key, value]) => key === 'customers.tenant_id' && value === 'shop-a'),
  )
  const row = message('two')
  f.messages.push(row)
  await f.emit('messages', 'INSERT', row)
  await f.emit('messages', 'INSERT', row)
  assert.equal(f.states[5].filter((m) => m.id === 'two').length, 1)
  assert.equal(f.states[2][0].preview.body, 'two')
  await f.emit('messages', 'INSERT', message('foreign', 'customer-b'))
  assert.ok(!f.states[5].some((m) => m.customer_id === 'customer-b'))
  assert.ok(!f.states[2].some((c) => c.customer.tenant_id === 'shop-b'))
  assert.ok(f.cleanup())
})
test('new conversation is hydrated even if message event arrives before customer event; reconnect catches missed messages', async () => {
  const f = fixture()
  await flush()
  f.customers.push({ id: 'new-a', tenant_id: 'shop-a', last_message_at: '2026-10-15T00:00:02Z' })
  const row = message('new', 'new-a')
  f.messages.push(row)
  await f.emit('messages', 'INSERT', row)
  assert.equal(f.states[2].find((c) => c.customer.id === 'new-a').preview.id, 'new')
  f.messages.push(message('missed'))
  await f.subscribe('SUBSCRIBED')
  await flush()
  assert.ok(f.states[5].some((m) => m.id === 'missed'))
  await f.subscribe('TIMED_OUT')
  assert.equal(f.states[11], 'offline')
  assert.equal(f.intervals.length, 1)
  f.cleanup()
})

test('selected thread receives INSERT synchronously while customer hydration is pending', async () => {
  const f = fixture({}, { emptyList: true })
  f.messages.push(message('two'))
  f.dispatch('messages', 'INSERT', message('two'))
  assert.ok(f.states[5].some((row) => row.id === 'two'))
  await flush()
  assert.equal(f.states[5].filter((row) => row.id === 'two').length, 1)
  f.cleanup()
})

test('outgoing replies and delivery updates render directly without snapshot requests', async () => {
  const f = fixture()
  await flush()
  const before = f.queries.length
  const sent = { ...message('agent-reply'), sender: 'agent', delivery_status: 'pending' }
  f.dispatch('messages', 'INSERT', sent)
  assert.equal(f.states[5].find((row) => row.id === sent.id).sender, 'agent')
  f.dispatch('messages', 'UPDATE', { ...sent, delivery_status: 'sent' })
  assert.equal(f.states[5].find((row) => row.id === sent.id).delivery_status, 'sent')
  assert.equal(f.states[5].filter((row) => row.id === sent.id).length, 1)
  assert.equal(f.queries.length, before)
  f.cleanup()
})

test('remount uses a fresh channel and callbacks from disposed channels cannot change state', async () => {
  const f = fixture()
  await flush()
  f.restart()
  await flush()
  assert.equal(new Set(f.channelNames).size, 2)
  await f.emit('messages', 'INSERT', message('two'))
  assert.equal(f.states[5].filter((row) => row.id === 'two').length, 1)
  f.cleanup()
  const before = JSON.stringify(f.states)
  await f.emit('customers', 'DELETE', { id: 'customer-a' })
  await f.emit('messages', 'DELETE', { id: 'one' })
  await f.emit('messages', 'INSERT', message('late'))
  await f.subscribe('CLOSED')
  assert.equal(JSON.stringify(f.states), before)
})
