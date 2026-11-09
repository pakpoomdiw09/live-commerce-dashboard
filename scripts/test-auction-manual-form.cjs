const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript'), path = require('node:path'), os = require('node:os')
const load = require('./helpers/load-typescript.cjs')

for (const editing of [false, true]) test(`manual form hydrates ${editing ? 'a timed existing round' : 'an empty workspace'} and submits null duration without a duration field`, async () => {
  const source = fs.readFileSync(process.env.AUCTION_FORM_SOURCE ?? 'components/live-cf/AuctionUnifiedForm.tsx', 'utf8')
  const deps = {}, values = [], effects = [], sent = []
  let cursor = 0, mounting = true
  for (const imp of ts.preProcessFile(source).importedFiles) deps[imp.fileName] = new Proxy({}, { get: () => value => value })
  deps.react = {
    useState(init) { const i = cursor++; if (!(i in values)) values[i] = typeof init === 'function' ? init() : init; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v }] },
    useRef(init) { const i = cursor++; return values[i] ?? (values[i] = { current: init }) },
    useCallback: fn => fn,
    useEffect: fn => { if (mounting) effects.push(fn) },
  }
  deps['react/jsx-runtime'] = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  const config = { ready: true, session: editing ? { id: 'session', page_id: '100', live_post_id: '456' } : null,
    round: editing ? { id: 'round', status: 'active', item_name: 'Hydrated item', start_price: 100, min_step: 10, duration_seconds: 600 } : null,
    settings: null, preferencesOnly: !editing }
  deps['./session-ui'] = { read: async () => config, field: '', orange: '' }
  const temporary = path.join(os.tmpdir(), `auction-manual-form-${process.pid}-${editing}.js`)
  fs.writeFileSync(temporary, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText)
  try {
    const { AuctionUnifiedForm } = load(temporary, deps, { AbortController, AbortSignal, URLSearchParams,
      crypto: require('node:crypto').webcrypto,
      fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ sessionId: 'session' }) } } })
    const props = { tenantId: 'tenant', sessionId: editing ? 'session' : '', data: null, options: { pages: [{ id: '100' }], bankAccounts: [] }, onSaved() {} }
    AuctionUnifiedForm(props); effects.forEach(fn => fn()); await new Promise(setImmediate)
    mounting = false; cursor = 0
    const tree = AuctionUnifiedForm(props), nodes = []
    function walk(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); nodes.push(n); walk(n.props?.children) }
    walk(tree)
    assert.equal(JSON.stringify(tree).includes('ระยะเวลาประมูล'), false)
    await nodes.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].durationSeconds, null)
    assert.equal(sent[0].roundId, editing ? 'round' : null)
    if (editing) assert.equal(sent[0].itemName, 'Hydrated item')
  } finally { fs.unlinkSync(temporary) }
})
