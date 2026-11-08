const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

test('dashboard inbox notices deduplicate inserts and verify customer tenant before showing', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'components/shell/InboxRealtimeNotifications.tsx'),
    'utf8',
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const listeners = []
  const effects = []
  const filters = []
  const states = []
  const removed = []
  let stateIndex = 0
  let subscribed
  const channel = {
    on(_kind, filter, callback) {
      listeners.push({ filter, callback })
      return channel
    },
    subscribe(callback) {
      subscribed = callback
      return channel
    },
  }
  const db = {
    channel() {
      return channel
    },
    from(table) {
      const queryFilters = []
      const query = {
        select() { return query },
        eq(key, value) { queryFilters.push([key, value]); return query },
        async maybeSingle() {
          filters.push({ table, queryFilters })
          const owned = queryFilters.some(([key, value]) => key === 'id' && value === 'customer-a') &&
            queryFilters.some(([key, value]) => key === 'tenant_id' && value === 'tenant-a')
          return { data: owned ? { id: 'customer-a' } : null, error: null }
        },
      }
      return query
    },
    async removeChannel(value) { removed.push(value) },
  }
  const react = {
    useEffect(effect) { effects.push(effect) },
    useRef(value) { return { current: value } },
    useState(initial) {
      const index = stateIndex++
      if (!(index in states)) states[index] = initial
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
  }
  const api = {}
  vm.runInNewContext(compiled, {
    exports: api,
    console: { info() {}, warn() {} },
    fetch: async () => ({ ok: true, json: async () => ({ conversations: [{ unread_count: 2 }] }) }),
    setTimeout: () => 1,
    clearTimeout() {},
    require(name) {
      if (name === 'react') return react
      if (name === 'next/link') return { default: 'Link' }
      if (name === 'next/navigation') return { usePathname: () => '/overview' }
      if (name === 'lucide-react') return { MessageCircle: 'MessageCircle', X: 'X' }
      if (name === '@/lib/supabase/browser') return { supabaseBrowser: () => db }
      if (name === 'react/jsx-runtime')
        return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      throw new Error(`Unexpected import: ${name}`)
    },
  })

  let unreadCount = 0
  const props = { tenantId: 'tenant-a', onUnreadCountChange: (count) => { unreadCount = count } }
  const render = () => {
    stateIndex = 0
    return api.InboxRealtimeNotifications(props)
  }
  render()
  const cleanup = effects[0]()
  subscribed('SUBSCRIBED')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(unreadCount, 2)

  const insert = listeners.find(({ filter }) => filter.table === 'messages')
  assert.ok(insert)
  const event = { new: { id: 'message-1', customer_id: 'customer-a', sender: 'customer' } }
  await insert.callback(event)
  await insert.callback(event)
  assert.equal(filters.length, 1)
  const notice = render()
  assert.equal(notice.props.children[1].props.children[1].props.href, '/inbox?customer=customer-a')

  await insert.callback({ new: { id: 'message-2', customer_id: 'customer-b', sender: 'customer' } })
  assert.equal(filters.length, 2)
  cleanup()
  assert.deepEqual(removed, [channel])
})
