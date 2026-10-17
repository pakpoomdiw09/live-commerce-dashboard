// Offline Chrome integration: actual broadcast workspace, mocked APIs, no live transport.
// Run after npm.cmd run build so the generated Tailwind CSS is available.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), http = require('node:http'), { spawn } = require('node:child_process')
const webpack = require('next/dist/compiled/webpack/webpack'); webpack.init()

;(async () => {
  const cwd = process.cwd(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-commerce-'))
  const mocks = path.join(cwd, 'scripts/fixtures/bank-selector-mocks.tsx')
  await new Promise((resolve, reject) => webpack.webpack({
    mode: 'development', devtool: false, target: 'web',
    entry: path.join(cwd, 'scripts/fixtures/commerce-entry.tsx'),
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
  const debuggingPort = 19472
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

    await call('Runtime.enable');await call('Page.enable')
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
    await call('Page.navigate',{url:address});await wait('!!window.commerceFixture&&document.body.textContent.includes("ภาพรวมร้านค้า")')
    await evaluate(`window.clickText=text=>[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()===text).click();window.fill=(selector,value)=>{const node=document.querySelector(selector);Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))}`)
    const screenshots=path.join(cwd,'docs/screenshots');fs.mkdirSync(screenshots,{recursive:true})
    for(const width of [1440,768,375]){await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<500});await pause();assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Dashboard overflow '+width);const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(screenshots,'commerce-dashboard-'+width+'.png'),Buffer.from(shot.data,'base64'))}
    await evaluate(`clickText('สินค้าทั้งหมด')`);await wait('document.body.textContent.includes("สินค้าทดสอบออฟไลน์")')
    await evaluate(`clickText('เพิ่มสินค้า')`);await wait('document.body.textContent.includes("รหัสสินค้า / SKU")')
    await evaluate(`fill('fieldset input','NEW1');const inputs=[...document.querySelectorAll('fieldset input')];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[1],'สินค้าเพิ่มทดสอบ');inputs[1].dispatchEvent(new Event('input',{bubbles:true}))`);await pause()
    await evaluate(`clickText('บันทึกสินค้า')`);await wait('commerceFixture.data.products.length===2&&!document.body.textContent.includes("ต้นทุน (เห็นเฉพาะในระบบจัดการ)")')
    await evaluate(`clickText('ออกแบบเซลเพจ')`);await wait('document.body.textContent.includes("เทมเพลตร้านเรียบง่าย")')
    await evaluate(`clickText('เทมเพลตร้านเรียบง่าย')`);await pause();await evaluate(`clickText('บันทึกฉบับร่าง')`);await wait('commerceFixture.data.pages.length===1')
    await evaluate(`const select=document.querySelector('select');select.value=commerceFixture.data.pages[0].id;select.dispatchEvent(new Event('change',{bubbles:true}))`);await pause()
    await call('Page.setInterceptFileChooserDialog',{enabled:false})
    await call('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{})
    const publish=await evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='เผยแพร่ฉบับที่บันทึก')`);assert.equal(publish,true)
    await evaluate(`window.confirm=()=>true;clickText('เผยแพร่ฉบับที่บันทึก')`);await wait('!!commerceFixture.data.pages[0].published')
    await evaluate(`clickText('เปิดหน้าร้านทดสอบ')`);await wait('document.body.textContent.includes("ตะกร้าและข้อมูลจัดส่ง")')
    await evaluate(`clickText('เพิ่มลงตะกร้า')`);await pause()
    await evaluate(`fill('input[name=name]','ผู้ซื้อทดสอบ');fill('input[name=phone]','0800000000');fill('textarea[name=address]','ที่อยู่ทดสอบออฟไลน์เท่านั้น')`);await pause()
    for(const width of [1440,375]){await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<500});await pause();assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Store overflow '+width);const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(screenshots,'commerce-storefront-'+width+'.png'),Buffer.from(shot.data,'base64'))}
    await evaluate(`clickText('ยืนยันคำสั่งซื้อ')`);await wait('commerceFixture.checkoutCalls===1&&document.body.textContent.includes("TEST-OFFLINE-ONLY")')
    assert.equal(await evaluate('commerceFixture.checkoutCalls'),1);assert.deepEqual(errors,[])
    console.log('PASS: actual shop dashboard/product create/editor draft+publish/public cart+checkout at 375/768/1440px. Mock APIs only, no real orders.')
  }finally{socket?.close();browser.kill();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1})
