const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript'), path = require('node:path'), os = require('node:os')
const load = require('./helpers/load-typescript.cjs')
test('a degraded workspace keeps inputs visible and prevents submitting rounds until an explicit reload', async () => {
  const file = 'components/live-cf/AuctionUnifiedForm.tsx'
  const source = process.env.AUCTION_ENTRY_TEST ? JSON.parse(fs.readFileSync('reports/auction-audit/remediation/entry.json', 'utf8')).files[file] : fs.readFileSync(file, 'utf8')
  const deps = {}, values = [], effects = []
  let cursor = 0, mounting = true, writes = 0
  for (const imp of ts.preProcessFile(source).importedFiles) deps[imp.fileName] = new Proxy({}, { get: () => () => null })
  deps['@/lib/features/commerce/auction-settings-status'] = load('lib/features/commerce/auction-settings-status.ts')
  deps.react = {
    useState(init) { const i = cursor++; if (!(i in values)) values[i] = typeof init === 'function' ? init() : init; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v }] },
    useRef(init) { const i = cursor++; return values[i] ?? (values[i] = { current: init }) },
    useCallback: fn => fn,
    useEffect: fn => { if (mounting) effects.push(fn) },
  }
  deps['react/jsx-runtime'] = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  deps['./session-ui'] = { read: async () => { throw Error('Unavailable') }, field: '', orange: '' }
  const temporary = path.join(os.tmpdir(), 'auction-form-test-' + process.pid + '.js')
  fs.writeFileSync(temporary, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText)
  try {
    const { AuctionUnifiedForm } = load(temporary, deps, { AbortController, AbortSignal, URLSearchParams, crypto: require('node:crypto').webcrypto, fetch: async () => { writes++; throw Error('Unexpected mutation') } })
    const props = { tenantId: 'fixture', sessionId: '', data: null, options: { pages: [{ id: '100' }], bankAccounts: [] }, onSaved() {} }
    AuctionUnifiedForm(props)
    effects.forEach(fn => fn())
    await new Promise(setImmediate)
    mounting = false; cursor = 0
    const tree = AuctionUnifiedForm(props), nodes = []
    function walk(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); nodes.push(n); walk(n.props?.children) }
    walk(tree)
    assert.ok(nodes.some(n => n.type === 'input'), 'draft inputs remain mounted')
    assert.ok(
      nodes.some(n => typeof n.props?.className === 'string' && n.props.className.includes('bg-rose-100')),
      'a failed workspace read shows a degraded status instead of a success badge',
    )
    const submit = nodes.find(n => n.type === 'button' && n.props.type === 'submit')
    assert.equal(submit.props.disabled, true)
    await nodes.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} })
    assert.equal(writes, 0)
    assert.ok(nodes.some(n => n.type === 'button' && n.props.type === 'button' && n.props.children === 'โหลดข้อมูลใหม่'))
  } finally { fs.unlinkSync(temporary) }
})
