const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')

test('Claim releases its loading lock after a stalled refresh and preserves an uncertain request key', async () => {
  const fs = require('node:fs'),
    vm = require('node:vm'),
    ts = require('typescript')
  for (const saved of [false, true]) {
    const setters = [[], [], []],
      bodies = []
    let index = 0
    const helpers = api(() => {
      throw Error('unused transport')
    })
    const exports = {}
    const jsx = (type, props) => ({ type, props })
    const dependencies = {
      react: {
        useRef: (value) => ({ current: value }),
        useState: (value) => {
          const state = index++
          return [value, (next) => setters[state].push(next)]
        },
      },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'lucide-react': { Bot: 'icon', LoaderCircle: 'spinner', UserRoundCheck: 'icon' },
      '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
      '@/lib/features/inbox/inbox-action-request': {
        inboxActionRequest: async (_url, body) => {
          bodies.push(body)
          if (!saved) throw Error('ambiguous timeout')
          return { response: { ok: true }, data: { ok: true } }
        },
        refreshInboxAction: (refresh) => helpers.refreshInboxAction(refresh, 5),
      },
    }
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync('components/inbox/ConversationActions.tsx', 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      {
        exports,
        Error,
        crypto: require('node:crypto').webcrypto,
        require(name) {
          if (name in dependencies) return dependencies[name]
          throw Error(name)
        },
      },
    )
    const tree = exports.ConversationActions({
      state: {
        id: 'customer',
        conversation_version: 4,
        assigned_user_id: null,
        bot_enabled: true,
        conversation_status: 'open',
      },
      inbox: { viewerId: 'actor', proEnabled: true, aiAllowed: true, autoReplyEnabled: true },
      windowAllowed: true,
      onChange: () => new Promise(() => {}),
    })
    function find(node) {
      if (!node || typeof node !== 'object') return null
      if (node.props?.['aria-label'] === 'รับแชท') return node
      for (const child of [node.props?.children].flat()) {
        const result = find(child)
        if (result) return result
      }
      return null
    }
    const button = find(tree)
    assert.ok(button)
    button.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepEqual(setters[0], [true, false])
    if (!saved) {
      assert.equal(setters[1].at(-1), 'ambiguous timeout')
      button.props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(bodies.length, 2)
      assert.equal(bodies[0].requestId, bodies[1].requestId)
      assert.equal(bodies[0].version, bodies[1].version)
    }
  }
})

function api(fetch) {
  return load(
    'lib/features/inbox/inbox-action-request.ts',
    {},
    { fetch, AbortController, setTimeout, clearTimeout },
  )
}

test('claim times out without replay and passes the original idempotency key/version', async () => {
  let calls = 0
  const body = { action: 'claim', version: 4, requestId: 'same-key' }
  const client = api(async (_url, init) => {
    calls++
    assert.deepEqual(JSON.parse(init.body), body)
    return new Promise((_, reject) =>
      init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
    )
  })
  await assert.rejects(client.inboxActionRequest('/claim', body, 15), /รายการอาจบันทึกแล้ว/)
  assert.equal(calls, 1)
})

test('claim response body is bounded; malformed successful responses are not treated as saved', async () => {
  const slow = api(async (_url, init) => ({
    ok: true,
    json: () =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('body aborted'))),
      ),
  }))
  await assert.rejects(slow.inboxActionRequest('/claim', {}, 15), /รายการอาจบันทึกแล้ว/)
  const malformed = api(async () => ({
    ok: true,
    json: async () => {
      throw new Error('invalid json')
    },
  }))
  await assert.rejects(malformed.inboxActionRequest('/claim', {}, 100), /ไม่สามารถยืนยันผล/)
  const denied = api(async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: 'conflict' }),
  }))
  const result = await denied.inboxActionRequest('/claim', {}, 100)
  assert.equal(result.response.status, 409)
  assert.equal(result.data.error, 'conflict')
})

test('refresh timeout settles even when refresh never resolves, and completed refresh clears its timer', async () => {
  const client = api(() => {
    throw Error('must not send')
  })
  await assert.rejects(
    client.refreshInboxAction(() => new Promise(() => {}), 15),
    /REFRESH_TIMEOUT/,
  )
  let refreshed = false
  await client.refreshInboxAction(async () => {
    refreshed = true
  }, 100)
  assert.equal(refreshed, true)
})
