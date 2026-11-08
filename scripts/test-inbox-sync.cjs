const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./helpers/load-typescript.cjs')

class InboxError extends Error {
  constructor(message, status = 400, code = 'INBOX_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}
const tenantId = '11111111-1111-4111-8111-111111111111'
const pageId = '987654321'
const token = 'TEST_DATABASE_PAGE_TOKEN'
const makeMessage = (id = 'mid-1', sender = '456') => ({
  id,
  message: 'hello',
  from: { id: sender },
  created_time: '2026-11-08T10:00:00Z',
})
const conversation = (messages = [makeMessage()], paging) => ({
  id: 't_456',
  participants: { data: [{ id: pageId }, { id: '456', name: 'Buyer' }] },
  messages: { data: messages, paging },
})

function fixture(responses, { customers = [], messages = [], tokenSet = true, targetId } = {}) {
  const calls = [],
    logs = []
  const pagination = load(
    'lib/integrations/facebook/sync-pagination.ts',
    {
      'server-only': {},
      '@/lib/integrations/facebook/client': {
        graph: (path) => `https://graph.facebook.com/v24.0/${path}`,
      },
      '@/lib/features/inbox/inbox-server': { InboxError },
    },
    {
      URL,
      AbortSignal,
      console: { warn: (...args) => logs.push(args) },
      fetch: async (url, options) => {
        calls.push({ url: new URL(url), options })
        const response = responses.shift()
        assert.ok(response, 'unexpected Graph request')
        if (response instanceof Error) throw response
        return Response.json(response.body ?? response, { status: response.status ?? 200 })
      },
    },
  )
  const tables = {
    tenants: [
      {
        id: tenantId,
        page_id: pageId,
        page_access_token: tokenSet ? token : null,
        is_active: true,
      },
    ],
    customers,
    messages,
  }
  const db = {
    from(table) {
      let action, values
      const filters = []
      const q = {
        select() {
          return q
        },
        eq(k, v) {
          filters.push((row) => row[k] === v)
          return q
        },
        is(k, v) {
          filters.push((row) => row[k] == null && v === null)
          return q
        },
        in(k, v) {
          filters.push((row) => v.includes(row[k]))
          return q
        },
        or() {
          return q
        },
        insert(v) {
          action = 'insert'
          values = v
          return q
        },
        update(v) {
          action = 'update'
          values = v
          return q
        },
        upsert(v) {
          action = 'upsert'
          values = v
          return q
        },
        execute() {
          let data = tables[table].filter((row) => filters.every((fn) => fn(row)))
          if (action === 'insert') {
            const row = {
              id: 'customer-' + (customers.length + 1),
              last_message_at: null,
              ...values,
            }
            tables[table].push(row)
            data = [row]
          }
          if (action === 'update') data.forEach((row) => Object.assign(row, values))
          if (action === 'upsert')
            for (const row of values)
              if (!tables[table].some((prior) => prior.external_id === row.external_id))
                tables[table].push({ ...row })
          return { data, error: null }
        },
        async maybeSingle() {
          const result = q.execute()
          return { ...result, data: result.data[0] ?? null }
        },
        single() {
          return q.maybeSingle()
        },
        then(resolve, reject) {
          return Promise.resolve(q.execute()).then(resolve, reject)
        },
      }
      return q
    },
  }
  const api = load(
    'app/api/inbox/sync/route.ts',
    {
      'next/server': {
        NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) },
      },
      '@/lib/features/inbox/inbox-server': {
        InboxError,
        inboxTenant: async () => ({ db, tenantId }),
        inboxError: (error) => ({
          status: error.status ?? 500,
          body: { code: error.code, error: error.message },
        }),
      },
      '@/lib/integrations/facebook/client': { pageTokenFor: (row) => row.page_access_token },
      '@/lib/integrations/facebook/sync-pagination': pagination,
    },
    { URL },
  )
  return {
    calls,
    logs,
    tables,
    pagination,
    run: () =>
      api.POST({
        headers: { get: () => null },
        nextUrl: { origin: 'https://shop.test' },
        json: async () => ({ tenantId, ...(targetId ? { customerId: targetId } : {}) }),
      }),
  }
}

test('sync uses the tenant Page and DB token, follows absolute versioned URLs without prefix duplication', async () => {
  const f = fixture([
    {
      data: [conversation()],
      paging: {
        next: `https://graph.facebook.com/v25.0/${pageId}/conversations?after=A%2BB&access_token=STALE_TOKEN`,
      },
    },
    { data: [conversation([makeMessage('mid-2', pageId)])] },
  ])
  const result = await f.run()
  assert.equal(result.status, 200)
  assert.equal(result.body.partial, false)
  assert.equal(f.calls[0].url.pathname, `/v24.0/${pageId}/conversations`)
  assert.equal(f.calls[1].url.pathname, `/v25.0/${pageId}/conversations`)
  assert.equal(f.calls[1].url.searchParams.get('after'), 'A+B')
  for (const call of f.calls) {
    assert.equal(call.options.headers.Authorization, `Bearer ${token}`)
    assert.equal(call.url.searchParams.has('access_token'), false)
    assert.equal(call.options.redirect, 'error')
  }
  assert.equal(f.tables.messages.length, 2)
  assert.equal(f.tables.messages[1].sender, 'agent')
})

test('malformed next URLs can rebuild the trusted edge with a cursor; last-page cursors alone do not loop', async () => {
  const f = fixture([
    {
      data: [conversation()],
      paging: {
        next: 'https://graph.facebook.comhttps://graph.facebook.com/broken',
        cursors: { after: 'A+B/=' },
      },
    },
    { data: [], paging: { cursors: { after: 'last-cursor' } } },
  ])
  assert.equal((await f.run()).body.partial, false)
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1].url.origin, 'https://graph.facebook.com')
  assert.equal(f.calls[1].url.searchParams.get('after'), 'A+B/=')
})

test('relative links and the me alias preserve the same conversation edge and requested fields', async () => {
  const f = fixture([
    {
      data: [conversation()],
      paging: { next: `https://graph.facebook.com/v25.0/me/conversations?after=one` },
    },
    { data: [], paging: { next: '?after=two' } },
    { data: [] },
  ])
  const result = await f.run()
  assert.equal(result.status, 200)
  assert.equal(result.body.partial, false)
  assert.equal(f.calls.length, 3)
  for (const call of f.calls) {
    assert.match(call.url.pathname, new RegExp('/' + pageId + '/conversations$'))
    assert.ok(call.url.searchParams.get('fields').includes('messages'))
  }
})

test('a later conversation-page failure returns partial success and saves already collected rows', async () => {
  const f = fixture([
    {
      data: [conversation()],
      paging: { next: `https://graph.facebook.com/v24.0/${pageId}/conversations?after=next` },
    },
    new Error('timeout with private credentials'),
  ])
  const result = await f.run()
  assert.equal(result.status, 200)
  assert.equal(result.body.partial, true)
  assert.equal(f.tables.messages.length, 1)
  assert.equal(result.body.warnings[0], 'FACEBOOK_UNAVAILABLE')
  assert.doesNotMatch(
    JSON.stringify(f.logs),
    /private credentials|TEST_DATABASE_PAGE_TOKEN|access_token/,
  )
})

test('nested message paging preserves both inline messages and fetched messages when a later page fails', async () => {
  const f = fixture([
    {
      data: [
        conversation([makeMessage()], {
          next: 'https://graph.facebook.com/v25.0/t_456/messages?after=first',
        }),
      ],
    },
    {
      data: [makeMessage('mid-2')],
      paging: { next: 'https://graph.facebook.com/v25.0/t_456/messages?after=second' },
    },
    { status: 400, body: { error: { code: 190, message: 'expired' } } },
  ])
  const result = await f.run()
  assert.equal(result.status, 200)
  assert.equal(result.body.partial, true)
  assert.equal(f.tables.messages.length, 2)
  assert.ok(result.body.warnings.includes('FACEBOOK_TOKEN_INVALID'))
})

test('first-page failures remain actionable, and malicious or repeated next links never send credentials elsewhere', async () => {
  const first = fixture([{ status: 400, body: { error: { code: 190 } } }])
  assert.equal((await first.run()).body.code, 'FACEBOOK_TOKEN_INVALID')
  const malicious = fixture([
    { data: [conversation()], paging: { next: 'https://attacker.test/?access_token=SECRET' } },
  ])
  assert.equal((await malicious.run()).body.partial, true)
  assert.equal(malicious.calls.length, 1)
  assert.equal(malicious.tables.messages.length, 1)
  const repeated = fixture([
    {
      data: [conversation()],
      paging: { next: `https://graph.facebook.com/v24.0/${pageId}/conversations?after=same` },
    },
    {
      data: [],
      paging: { next: `https://graph.facebook.com/v24.0/${pageId}/conversations?after=same` },
    },
  ])
  assert.ok((await repeated.run()).body.warnings.includes('FACEBOOK_PAGING_REPEATED'))
  assert.equal(repeated.calls.length, 2)
})

test('sync deduplicates dashboard/echo receipts by provider ID and refuses to reassign another tenant customer', async () => {
  const customers = [
    {
      id: 'known',
      tenant_id: tenantId,
      platform: 'facebook',
      platform_user_id: '456',
      last_message_at: null,
    },
  ]
  const f = fixture([{ data: [conversation()] }], {
    customers,
    messages: [
      { customer_id: 'known', external_id: 'agent:local-id', provider_message_id: 'mid-1' },
    ],
  })
  assert.equal((await f.run()).status, 200)
  assert.equal(f.tables.messages.length, 1)
  const foreign = fixture([{ data: [conversation()] }], {
    customers: [{ ...customers[0], tenant_id: 'other-tenant' }],
  })
  assert.equal((await foreign.run()).body.code, 'CUSTOMER_TENANT_MISMATCH')
  assert.equal(foreign.tables.messages.length, 0)
})
