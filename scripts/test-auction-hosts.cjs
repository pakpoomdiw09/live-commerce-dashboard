const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')

function fixture({ identities = [], connection = null, tokenUser = '999', error = null } = {}) {
  const filters = []
  const tokenCalls = []
  const db = {
    auth: { admin: { getUserById: async (id) => ({ data: { user: { id, identities } }, error }) } },
    from(table) {
      assert.equal(table, 'facebook_pages')
      return {
        select(columns) {
          assert.equal(columns, 'access_token')
          return this
        },
        eq(key, value) {
          filters.push([key, value])
          return this
        },
        async maybeSingle() {
          return { data: connection, error: null }
        },
      }
    },
  }
  const api = load('lib/features/commerce/auction-hosts.ts', {
    'server-only': {},
    '@/lib/integrations/facebook/client': {
      getPageTokenUserId: async (...args) => {
        tokenCalls.push(args)
        return tokenUser
      },
    },
  })
  return { run: () => api.auctionHostIds(db, 'owner-uuid', '100'), filters, tokenCalls }
}

test('hosts contain the Page and authenticated Facebook identity, never the Supabase UUID', async () => {
  const f = fixture({
    identities: [
      { provider: 'email', id: '123' },
      { provider: 'facebook', id: '999' },
      { provider: 'facebook', id: '999' },
    ],
  })
  assert.deepEqual(Array.from(await f.run()), ['100', '999'])
  assert.equal(f.filters.length, 0)
})

test('separate Facebook connection uses only the signed-in owner and selected Page', async () => {
  const f = fixture({ connection: { access_token: 'owner-page-token' } })
  assert.deepEqual(Array.from(await f.run()), ['100', '999'])
  assert.deepEqual(f.filters, [
    ['user_id', 'owner-uuid'],
    ['page_id', '100'],
  ])
  assert.deepEqual(f.tokenCalls, [['owner-page-token', '100']])
})

test('missing or unverifiable personal identity requires reconnection instead of creating Page-only rounds', async () => {
  await assert.rejects(fixture().run(), /AUCTION_HOST_FACEBOOK_REQUIRED/)
  await assert.rejects(
    fixture({ connection: { access_token: 'bad' }, tokenUser: null }).run(),
    /AUCTION_HOST_FACEBOOK_REQUIRED/,
  )
  await assert.rejects(fixture({ error: new Error('Auth unavailable') }).run(), /Auth unavailable/)
})
