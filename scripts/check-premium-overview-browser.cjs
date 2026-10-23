// Offline browser layout smoke. Test-only fixtures; no authenticated app/DB/provider calls.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  vm = require('node:vm'),
  ts = require('typescript'),
  React = require('react'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process'),
  { renderToStaticMarkup } = require('react-dom/server')
function load(file, deps = {}) {
  const context = {
    exports: {},
    console,
    Date,
    JSON,
    Math,
    Object,
    Number,
    URLSearchParams,
    require: (n) => {
      if (n in deps) return deps[n]
      throw Error(n)
    },
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  )
  return context.exports
}
const utils = load('lib/utils.ts'),
  jsx = require('react/jsx-runtime'),
  chart = load('components/overview/RevenueChart.tsx', {
    react: React,
    'react/jsx-runtime': jsx,
    '@/lib/utils': utils,
  }),
  avatar = load('components/inbox/Avatar.tsx', {
    react: React,
    'react/jsx-runtime': jsx,
    '@/lib/utils': utils,
  })
const { PremiumOverview } = load('components/overview/PremiumOverview.tsx', {
  react: React,
  'react/jsx-runtime': jsx,
  'next/link': {
    default: ({ href, children, ...props }) =>
      React.createElement('a', { href, ...props }, children),
  },
  'next/navigation': { useRouter: () => ({ refresh() {} }) },
  'lucide-react': require('lucide-react'),
  '@/components/inbox/Avatar': avatar,
  './RevenueChart': chart,
})
const data = {
  shop: { id: 'fixture', name: 'ร้านทดสอบ Layout เท่านั้น' },
  updatedAt: '2026-10-16T02:00:00Z',
  filters: { range: '7', page: 1, q: '' },
  access: { slips: true, customers: true, ai: true },
  metrics: {
    reconciledRevenue: null,
    messages: 0,
    approved: 0,
    totalSlips: 0,
    pending: 0,
    slipCredits: 0,
    verifiedSlipAmount: 0,
  },
  previous: { approved: 0, totalSlips: 0, verifiedSlipAmount: 0 },
  results: { passed: 0, pending: 0, rejected: 0, error: 0 },
  series: [{ day: '2026-10-16', amount: 0, count: 0, previousAmount: 0, previousCount: 0 }],
  bucket: 'day',
  slips: [
    {
      id: 'fixture',
      created_at: '2026-10-16T02:00:00Z',
      customer: 'ข้อมูลทดสอบตารางเท่านั้น',
      amount: null,
      result: 'pending',
      note: 'ไม่มีการเชื่อมข้อมูลจริง',
    },
  ],
  slipMatches: 1,
  chats: [],
  chatMatches: 0,
  ai: null,
  health: [
    'Slip Verification',
    'AI Agent',
    'Messenger',
    'Database',
    'Credit System',
    'Broadcast',
  ].map((name) => ({ name, status: 'unknown', detail: 'Offline layout fixture' })),
}
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-overview-browser-')),
    files = fs.readdirSync('.next/static/css').filter((f) => f.endsWith('.css'))
  const html = path.join(root, 'overview.html'),
    css = files.map((f) => fs.readFileSync(path.join('.next/static/css', f), 'utf8')).join('\n')
  fs.writeFileSync(
    html,
    '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
      css +
      '</style></head><body>' +
      renderToStaticMarkup(
        React.createElement(PremiumOverview, { data, shopCount: 1, userName: 'Offline fixture' }),
      ) +
      '</body></html>',
  )
  const exe = process.argv[2] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    port = 19383
  const browser = spawn(
    exe,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + path.join(root, 'profile'),
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  )
  let socket
  try {
    let target
    for (let i = 0; i < 100; i++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
          (t) => t.type === 'page',
        )
        if (target) break
      } catch {}
      await new Promise((r) => setTimeout(r, 100))
    }
    if (!target) throw Error('Headless browser unavailable')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Browser socket timeout')), 10000)
      socket.onopen = () => {
        clearTimeout(timeout)
        resolve()
      }
      socket.onerror = () => {
        clearTimeout(timeout)
        reject(Error('Browser socket unavailable'))
      }
    })
    let next = 0
    const pending = new Map()
    socket.onmessage = (event) => {
      const r = JSON.parse(event.data)
      if (r.id) {
        const p = pending.get(r.id)
        pending.delete(r.id)
        if (r.error) p.reject(Error(r.error.message))
        else p.resolve(r.result)
      }
    }
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++next,
          timeout = setTimeout(() => reject(Error('Browser command timeout: ' + method)), 10000)
        pending.set(id, {
          resolve: (r) => {
            clearTimeout(timeout)
            resolve(r)
          },
          reject: (e) => {
            clearTimeout(timeout)
            reject(e)
          },
        })
        socket.send(JSON.stringify({ id, method, params }))
      })
    await call('Page.enable')
    await call('Page.navigate', { url: require('node:url').pathToFileURL(html).href })
    for (const width of [375, 768, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 500,
      })
      await new Promise((r) => setTimeout(r, 350))
      const v = await call('Runtime.evaluate', {
        expression: `JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector('h1')?.textContent,metrics:document.querySelectorAll('article').length,svgMax:Math.max(...[...document.querySelectorAll('svg')].map(s=>s.getBoundingClientRect().width)),tableScroll:[...document.querySelectorAll('table')].some(t=>!!t.closest('.overflow-x-auto'))})`,
        returnByValue: true,
      })
      const result = JSON.parse(v.result.value)
      assert.ok(result.heading.includes('สวัสดี'))
      assert.equal(result.metrics, 5)
      assert.ok(result.scroll <= result.width, JSON.stringify(result))
      assert.ok(result.svgMax <= 32)
      assert.ok(result.tableScroll)
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })
      fs.writeFileSync(path.join(root, `overview-${width}.png`), Buffer.from(shot.data, 'base64'))
      console.log('PASS responsive ' + width + 'px ' + JSON.stringify(result))
    }
    console.log('Screenshots: ' + root)
    await call('Browser.close')
  } finally {
    socket?.close()
    browser.kill()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
