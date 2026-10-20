const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync('app/api/broadcasts/[id]/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
class InboxError extends Error { constructor(message, status) { super(message); this.status = status } }
function fixture({ actor = { kind: 'user', role: 'owner' }, tenant = 'shop', status = 'draft', race = false, failure = false } = {}) {
  let deletes = 0, reads = 0, stats = 0
  const filters = {}
  const db = { from(table) {
    assert.equal(table, 'broadcasts')
    const query = { delete() { deletes++; return this }, eq(key, value) { filters[key] = value; return this }, select() { return this }, async maybeSingle() { return { data: race ? null : { id: 'draft' }, error: failure ? { code: '23503' } : null } } }
    return query
  } }
  const deps = {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, ...options }) } },
    '@/lib/auth': { getActor: async () => actor }, '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/features/broadcast/broadcast-service': {
      broadcastScope: async (user, id, owner) => {
        if (!user) throw new InboxError('Login required', 401)
        if (id !== 'shop' || owner && user.role !== 'owner') throw new InboxError('Forbidden', 403)
        return { db, tenantId: 'shop' }
      },
      readBroadcast: async (_db, id, shop) => { reads++; assert.equal(id, 'draft'); assert.equal(shop, 'shop'); return { id, tenant_id: 'shop', status, name: 'Fresh draft', message: 'Latest text', audience_segment: 'all', audience_tags: ['tag'] } },
    },
    '@/lib/features/broadcast/broadcast-send': { broadcastDeliveryStats: async () => { stats++; return { sent: 1 } } },
    '@/lib/features/inbox/inbox-server': { InboxError, inboxError: error => ({ status: error.status ?? 500 }) },
  }
  const context = { exports: {}, require: name => { assert.ok(name in deps, name); return deps[name] } }
  vm.runInNewContext(code, context)
  const req = { nextUrl: new URL('http://offline/api/broadcasts/draft?tenantId=' + tenant) }, args = { params: Promise.resolve({ id: 'draft' }) }
  return { get: () => context.exports.GET(req, args), remove: () => context.exports.DELETE(req, args), counts: () => ({ deletes, reads, stats }), filters }
}
test('opening a draft returns fresh form fields without depending on delivery ledger', async () => {
  const f = fixture(), result = await f.get()
  assert.equal(result.body.broadcast.message, 'Latest text')
  assert.equal(result.body.broadcast.audience_tags[0], 'tag')
  assert.equal(f.counts().stats, 0)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
})
test('draft deletion requires owner membership before reading or mutating tenant data', async () => {
  for (const options of [{ actor: null }, { actor: { kind: 'user', role: 'staff' } }, { tenant: 'foreign' }]) {
    const f = fixture(options), result = await f.remove()
    assert.ok([401, 403].includes(result.status)); assert.equal(f.counts().deletes, 0); assert.equal(f.counts().reads, 0)
  }
})
test('deletion is scoped and atomically conditional on still being a draft', async () => {
  const f = fixture(), result = await f.remove()
  assert.equal(result.body.deleted, 'draft')
  assert.deepEqual(f.filters, { id: 'draft', tenant_id: 'shop', status: 'draft' })
  for (const status of ['sending', 'sent', 'failed']) { const g = fixture({ status }); assert.equal((await g.remove()).status, 409); assert.equal(g.counts().deletes, 0) }
  assert.equal((await fixture({ race: true }).remove()).status, 409)
  assert.equal((await fixture({ failure: true }).remove()).status, 503)
})
