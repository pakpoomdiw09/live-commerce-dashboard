const assert = require('node:assert/strict'),
  { test } = require('node:test'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const api = {}
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/features/inbox/inbox-request.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports: api, AbortController, Map },
)
test('rapid A-B-C invalidates old responses even when transport ignores abort, and cleanup prevents late writes', () => {
  const gate = new api.LatestInboxRequest(),
    a = gate.begin(),
    b = gate.begin(),
    c = gate.begin()
  assert.equal(a.current(), false)
  assert.equal(b.current(), false)
  assert.equal(c.current(), true)
  assert.equal(a.signal.aborted, true)
  gate.cancel()
  assert.equal(c.current(), false)
})
test('event replay deduplicates identical IDs/payloads while preserving real delivery updates', () => {
  const events = new api.InboxEventDeduplicator()
  assert.equal(events.accept('message', { status: 'pending' }), true)
  assert.equal(events.accept('message', { status: 'pending' }), false)
  assert.equal(events.accept('message', { status: 'sent' }), true)
  for (let n = 0; n < 1100; n++) events.accept(String(n), { n })
  assert.equal(events.accept('message', { status: 'sent' }), true)
})
