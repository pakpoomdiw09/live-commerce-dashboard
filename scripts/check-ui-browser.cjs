const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const webpack = require('next/dist/compiled/webpack/webpack')

webpack.init()

async function checkInterface() {
  const workspace = process.cwd()
  const output = path.join(workspace, '.tmp/ui-preview')
  fs.mkdirSync(output, { recursive: true })
  await new Promise((resolve, reject) => webpack.webpack({
    mode: 'development', devtool: false, target: 'web',
    entry: path.join(workspace, 'scripts/fixtures/design-system/entry.tsx'),
    output: { path: output, filename: 'bundle.js' },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.json'],
      alias: {
        '@': workspace,
        'next/link$': path.join(workspace, 'scripts/fixtures/agent-overview/link.tsx'),
        'next/navigation$': path.join(workspace, 'scripts/fixtures/design-system/navigation.ts'),
        'next/image$': path.join(workspace, 'scripts/fixtures/design-system/image.tsx'),
      },
    },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(workspace, 'scripts/inbox-browser-loader.cjs') }] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()))

  const css = fs.readdirSync('.next/static/css').filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join('.next/static/css', file), 'utf8')).join('\n')
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:'development'}};</script><script src="/bundle.js"></script></body></html>`
  const server = http.createServer((request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return }
    const files = { '/bundle.js': [path.join(output, 'bundle.js'), 'text/javascript'], '/logo-icon.png': [path.join(workspace, 'public/logo-icon.png'), 'image/png'] }
    const file = files[request.url]
    if (!file) { response.writeHead(404); response.end(); return }
    response.setHeader('Content-Type', file[1])
    fs.createReadStream(file[0]).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=19462', '--user-data-dir=' + path.join(output, 'chrome-profile'), 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let socket
  try {
    let target
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = (await (await fetch('http://127.0.0.1:19462/json/list')).json()).find(tab => tab.type === 'page') } catch {}
      if (target) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(target, 'Chrome debugging endpoint must be available')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    const pending = new Map(), errors = []
    let sequence = 0
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    }
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Browser timeout: ' + method)) }, 15000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      return result.result.value
    }
    const wait = async expression => {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await evaluate(expression)) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('UI condition timed out: ' + expression + '\n' + errors.join('\n'))
    }
    const resize = async width => {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1050, deviceScaleFactor: 1, mobile: width < 768 })
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    await call('Runtime.enable')
    await call('Page.enable')
    await resize(1440)
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` })
    await wait(`document.querySelector('h1')?.textContent.includes('ภาพรวมธุรกิจของคุณ') && document.querySelector('input[aria-label="ชื่อร้านตัวอย่าง"]') !== null`)
    await new Promise(resolve => setTimeout(resolve, 400))

    for (const width of [375, 768, 1440, 1920]) {
      await resize(width)
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Page overflow at ' + width)
      assert.ok(await evaluate('document.documentElement.scrollHeight <= innerHeight + 1'), 'The workspace must scroll inside its content panel at ' + width)
      assert.ok(await evaluate(`document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth + 1`), 'Content overflow at ' + width)
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      fs.writeFileSync(path.join(output, `overview-${width}.png`), Buffer.from(screenshot.data, 'base64'))
    }
    await resize(375)
    await evaluate(`document.querySelector('button[aria-label="เปิดเมนู"]').focus(); document.activeElement.click()`)
    await wait(`document.querySelector('[role="dialog"]')?.contains(document.activeElement)`)
    await evaluate(`const links = [...document.querySelector('[role="dialog"]').querySelectorAll('a[href],button:not(:disabled)')].filter(el=>el.getClientRects().length); links.at(-1).focus()`)
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.ok(await evaluate(`document.querySelector('[role="dialog"]').contains(document.activeElement)`), 'Keyboard focus must stay in the drawer')
    const drawer = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(path.join(output, 'mobile-menu.png'), Buffer.from(drawer.data, 'base64'))
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await wait(`!document.querySelector('[role="dialog"]')`)
    assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'เปิดเมนู')
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('input[aria-label="ชื่อร้านตัวอย่าง"]')).fontSize`), '16px')
    const before = await evaluate(`document.querySelector('[aria-label="สถานะตัวอย่าง"]').getAttribute('aria-checked')`)
    await evaluate(`document.querySelector('[aria-label="สถานะตัวอย่าง"]').click()`)
    await wait(`document.querySelector('[aria-label="สถานะตัวอย่าง"]').getAttribute('aria-checked') !== '${before}'`)
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.drawer-enter') || document.body).animationDuration`), '1e-05s')
    assert.deepEqual(errors, [])
    console.log('PASS: 375/768/1440/1920px layouts, mobile drawer focus/escape/recovery, form sizing, switches, reduced motion; no browser exceptions.')
    console.log('Screenshots: .tmp/ui-preview/')
  } finally {
    socket?.close()
    browser.kill()
    await new Promise(resolve => server.close(resolve))
  }
}

checkInterface().catch(error => { console.error(error); process.exitCode = 1 })
