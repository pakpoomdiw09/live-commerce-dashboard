// Offline Chrome integration: live banking components, real local logos, mocked account APIs.
// Run after npm.cmd run build so the generated Tailwind CSS is available.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), http = require('node:http'), { spawn } = require('node:child_process')
const webpack = require('next/dist/compiled/webpack/webpack'); webpack.init()

;(async () => {
  const cwd = process.cwd(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-bank-selector-'))
  const mocks = path.join(cwd, 'scripts/fixtures/bank-selector-mocks.tsx')
  await new Promise((resolve, reject) => webpack.webpack({
    mode: 'development', devtool: false, target: 'web',
    entry: path.join(cwd, 'scripts/fixtures/bank-selector-entry.tsx'),
    output: { path: temporary, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js', '.json'], alias: { 'next/link$': mocks, 'next/navigation$': mocks, '@': cwd } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(cwd, 'scripts/inbox-browser-loader.cjs') }] },
    optimization: { minimize: false },
  }, (error, stats) => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()))
  const cssDirectory = path.join(cwd, '.next/static/css')
  const css = fs.readdirSync(cssDirectory).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(path.join(cssDirectory, name), 'utf8')).join('\n')
  fs.writeFileSync(path.join(temporary, 'index.html'), `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:"development"}};</script><script src="/bundle.js"></script></body></html>`)

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    let file, mime
    if (pathname === '/' || pathname === '/index.html') { file = path.join(temporary, 'index.html'); mime = 'text/html; charset=utf-8' }
    else if (pathname === '/bundle.js') { file = path.join(temporary, 'bundle.js'); mime = 'text/javascript; charset=utf-8' }
    else if (/^\/banks\/[a-z0-9_.-]+\.(svg|png|webp)$/i.test(pathname)) {
      file = path.join(cwd, 'public', pathname.slice(1))
      mime = pathname.endsWith('.svg') ? 'image/svg+xml' : pathname.endsWith('.png') ? 'image/png' : 'image/webp'
    }
    if (!file || !fs.existsSync(file)) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${server.address().port}`
  const debuggingPort = 19465
  const browser = spawn(process.argv[2] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + debuggingPort,
    '--user-data-dir=' + path.join(temporary, 'profile'), 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  let socket
  try {
    let target
    for (let attempt = 0; attempt < 100; attempt++) {
      try { target = (await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json()).find(item => item.type === 'page'); if (target) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!target) throw Error('Chrome unavailable')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    const pending = new Map(), errors = []; let next = 0
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
      if (message.id) { const action = pending.get(message.id); pending.delete(message.id); message.error ? action.reject(Error(message.error.message)) : action.resolve(message.result) }
    }
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 15000)
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject }); socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed')
      return result.result.value
    }
    const pause = () => new Promise(resolve => setTimeout(resolve, 150))
    const wait = async expression => {
      for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate(expression)) return; await pause() }
      throw Error('Browser wait failed: ' + expression + '\n' + JSON.stringify(errors) + '\n' + await evaluate('document.body.textContent.slice(0,1800)'))
    }
    const press = async key => {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
      await pause()
    }
    const open = async () => {
      await evaluate(`document.querySelector('[role=combobox]').focus();document.querySelector('[role=combobox]').click()`)
      await wait(`document.querySelector('[role=combobox]').getAttribute('aria-expanded')==='true'`)
    }
    const select = async code => {
      await open()
      await press('Escape'); await pause(); await open()
      await pause()
      await evaluate(`[...document.querySelectorAll('[role=option]')].find(option=>option.id.endsWith('-'+${JSON.stringify(code)})).click()`)
      await pause()
    }
    await call('Runtime.enable'); await call('Page.enable')
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false })
    await call('Page.navigate', { url: address })
    await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='เพิ่มบัญชีรับเงิน'&&!button.disabled)`)
    await evaluate(`window.fill=(selector,value)=>{const node=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))};[...document.querySelectorAll('button')].find(button=>button.textContent==='เพิ่มบัญชีรับเงิน').click()`)
    await wait(`!!document.querySelector('[role=combobox]')`)
    assert.equal(await evaluate(`document.querySelector('a[href="/banks/ATTRIBUTION.md"]').textContent`), 'ที่มาและสิทธิ์โลโก้')
    await open()
    const count = await evaluate('bankFixture.banks.length')
    assert.equal(count, 18)
    assert.equal(await evaluate(`document.querySelectorAll('[role=option]').length`), count)
    assert.equal(await evaluate(`document.querySelector('[role=option] [data-bank-code]').getBoundingClientRect().width`), 40)
    assert.equal(await evaluate(`document.querySelector('[role=combobox]').parentElement.querySelector('[data-bank-code]').getBoundingClientRect().width`), 40)
    assert.equal(await evaluate(`document.querySelector('[data-bank-code]').getBoundingClientRect().width`), 56)
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[role=option]')].slice(0,5).map(option=>option.querySelector('[data-bank-code]').dataset.bankCode)`), ['KBANK', 'SCB', 'KTB', 'BBL', 'BAY'])
    // Force actual local asset requests for lazy images, including options below the viewport.
    await evaluate(`document.querySelectorAll('[role=option] img').forEach(image=>image.loading='eager')`)
    await wait(`[...document.querySelectorAll('[role=option] img')].every(image=>image.complete&&image.naturalWidth>0)`)
    const installed = await evaluate(`bankFixture.banks.filter(bank=>bank.logoPath).length`)
    assert.equal(await evaluate(`document.querySelectorAll('[role=option] img').length`), installed)
    const logoMismatches = await evaluate(`[...document.querySelectorAll('[role=option]')].flatMap(option=>{const bank=bankFixture.banks.find(bank=>option.id.endsWith('-'+bank.code)),image=option.querySelector('img');return bank.logoPath?(image&&new URL(image.src,location.href).pathname===bank.logoPath?[]:[{code:bank.code,expected:bank.logoPath,actual:image?.getAttribute('src')}]):(!option.querySelector('svg[role=img]')?[{code:bank.code,missingFallback:true}]:[])})`)
    assert.deepEqual(logoMismatches, [])
    for (const code of await evaluate('bankFixture.banks.map(bank=>bank.code)')) {
      await select(code)
      assert.equal(await evaluate(`document.querySelector('[role=combobox]').value`), await evaluate(`bankFixture.banks.find(bank=>bank.code===${JSON.stringify(code)}).name`))
      assert.equal(await evaluate(`document.querySelector('[role=combobox]').parentElement.querySelector('[data-bank-code]').dataset.bankCode`), code)
    }
    for (const [search, expected] of [['กสิกร', 'KBANK'], ['Siam Commercial', 'SCB'], ['006', 'KTB'], ['TMB', 'TTB'], ['__no_such_bank__', null], ['SCBT', null], ['PROMPTPAY', null], ['Standard Chartered', null]]) {
      await open(); await evaluate(`fill('[role=combobox]',${JSON.stringify(search)})`); await pause()
      if (expected) assert.ok(await evaluate(`[...document.querySelectorAll('[role=option]')].some(option=>option.id.endsWith('-'+${JSON.stringify(expected)}))`))
      else assert.equal(await evaluate(`document.querySelectorAll('[role=option]').length`), 0)
      await press('Escape')
    }
    await open(); await press('End')
    assert.equal(await evaluate(`document.querySelector('[role=combobox]').getAttribute('aria-activedescendant')`), await evaluate(`document.querySelectorAll('[role=option]')[bankFixture.banks.length-1].id`))
    await press('Home'); await press('ArrowDown'); await press('Enter')
    assert.equal(await evaluate(`document.querySelector('[role=combobox]').value`), await evaluate(`bankFixture.banks[1].name`))
    assert.equal(await evaluate('bankFixture.posts.length'), 0, 'Search Enter must never submit the bank form')
    await open(); await press('Escape')
    assert.equal(await evaluate(`document.querySelector('[role=combobox]').getAttribute('aria-expanded')`), 'false')
    await open(); await press('Home'); await press('ArrowUp')
    assert.equal(await evaluate(`document.querySelector('[role=combobox]').getAttribute('aria-activedescendant')`), await evaluate(`document.querySelectorAll('[role=option]')[bankFixture.banks.length-1].id`))
    await press('Tab')
    assert.equal(await evaluate(`document.querySelector('[role=combobox]').getAttribute('aria-expanded')`), 'false')
    await open(); await evaluate(`document.querySelector('h1').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`); await pause()
    assert.equal(await evaluate(`document.querySelector('[role=combobox]').getAttribute('aria-expanded')`), 'false')
    await select('TTB')
    await evaluate(`fill('fieldset input:not([role=combobox])','บัญชีเพิ่มออฟไลน์');fill('input[inputmode=numeric]','0123456789')`); await pause()
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='บันทึกบัญชี').click()`)
    await wait('bankFixture.posts.length===1&&!document.querySelector("[role=combobox]")')
    assert.equal(await evaluate('bankFixture.posts[0].bank_code'), 'TTB')
    assert.equal(await evaluate('bankFixture.posts[0].action'), 'save')
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='แก้ไข').click()`)
    await wait(`!!document.querySelector('[role=combobox]')`)
    const replacement = 'SCB'
    await select(replacement)
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='บันทึกบัญชี').click()`)
    await wait('bankFixture.posts.length===2&&!document.querySelector("[role=combobox]")')
    assert.equal(await evaluate('bankFixture.posts[1].bank_code'), replacement)
    assert.equal(await evaluate('bankFixture.posts[1].id'), '22222222-2222-4222-8222-222222222222')
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='เพิ่มบัญชีรับเงิน').click()`)
    await wait(`!!document.querySelector('[role=combobox]')`)
    await open()
    // Broken assets must become an explicit, accessible icon rather than a broken image.
    await evaluate(`document.querySelector('[role=option] img').src='/banks/__broken.svg'`)
    await wait(`[...document.querySelectorAll('[role=option] svg[role=img]')].some(icon=>icon.getAttribute('aria-label').includes('โหลดโลโก้ไม่สำเร็จ'))`)
    fs.mkdirSync(path.join(cwd, 'docs/screenshots'), { recursive: true })
    for (const width of [375, 768, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1200, deviceScaleFactor: 1, mobile: width < 768 })
      await select('KBANK'); await open(); await pause()
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Page overflow at ' + width)
      assert.ok(await evaluate(`document.querySelector('[role=listbox]').parentElement.getBoundingClientRect().height<=420.5`))
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      fs.writeFileSync(path.join(cwd, `docs/screenshots/bank-selector-${width}.png`), Buffer.from(screenshot.data, 'base64'))
    }
    await evaluate(`document.querySelector('#fixture-mode').click()`)
    await wait(`!!document.querySelector('[role=combobox]')`)
    await open(); await evaluate(`fill('[role=combobox]','Government Savings')`); await pause()
    assert.ok(await evaluate(`[...document.querySelectorAll('[role=option]')].some(option=>option.id.endsWith('-GSB'))`))
    await press('ArrowDown'); await press('Enter')
    assert.equal(await evaluate(`document.querySelector('[role=combobox]').value`), await evaluate(`bankFixture.banks.find(bank=>bank.code==='GSB').name`))
    assert.deepEqual(errors, [])
    console.log(`PASS: live account and create-tenant forms; ${count} banks selectable, priority/search/keyboard/add/edit canonical codes; ${installed} local logos load and correct-path matching, missing/broken fallbacks; 375/768/1440px screenshots without overflow. Offline mocks only.`)
  } finally { socket?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)) }
})().catch(error => { console.error(error); process.exitCode = 1 })
