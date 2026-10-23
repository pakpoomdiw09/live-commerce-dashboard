// Offline Chrome integration: actual broadcast workspace, mocked APIs, no live transport.
// Run after npm.cmd run build so the generated Tailwind CSS is available.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os')
const assert = require('node:assert/strict'),
  http = require('node:http'),
  { spawn } = require('node:child_process')
const webpack = require('next/dist/compiled/webpack/webpack')
webpack.init()

;(async () => {
  const cwd = process.cwd(),
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-broadcast-'))
  const mocks = path.join(cwd, 'scripts/fixtures/bank-selector-mocks.tsx')
  await new Promise((resolve, reject) =>
    webpack.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(cwd, 'scripts/fixtures/broadcast-entry.tsx'),
        output: { path: temporary, filename: 'bundle.js' },
        resolve: {
          extensions: ['.tsx', '.ts', '.js', '.json'],
          alias: { 'next/link$': mocks, 'next/navigation$': mocks, '@': cwd },
        },
        module: {
          rules: [
            {
              test: /\.tsx?$/,
              exclude: /node_modules/,
              use: path.join(cwd, 'scripts/inbox-browser-loader.cjs'),
            },
          ],
        },
        optimization: { minimize: false },
      },
      (error, stats) =>
        error || stats.hasErrors()
          ? reject(error || Error(stats.toString({ all: false, errors: true })))
          : resolve(),
    ),
  )
  const cssDirectory = path.join(cwd, '.next/static/css')
  const css = fs
    .readdirSync(cssDirectory)
    .filter((name) => name.endsWith('.css'))
    .map((name) => fs.readFileSync(path.join(cssDirectory, name), 'utf8'))
    .join('\n')
  fs.writeFileSync(
    path.join(temporary, 'index.html'),
    `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:"development"}};</script><script src="/bundle.js"></script></body></html>`,
  )

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    let file, mime
    if (pathname === '/' || pathname === '/index.html') {
      file = path.join(temporary, 'index.html')
      mime = 'text/html; charset=utf-8'
    } else if (pathname === '/bundle.js') {
      file = path.join(temporary, 'bundle.js')
      mime = 'text/javascript; charset=utf-8'
    } else if (/^\/banks\/[a-z0-9_.-]+\.(svg|png|webp)$/i.test(pathname)) {
      file = path.join(cwd, 'public', pathname.slice(1))
      mime = pathname.endsWith('.svg')
        ? 'image/svg+xml'
        : pathname.endsWith('.png')
          ? 'image/png'
          : 'image/webp'
    }
    if (!file || !fs.existsSync(file)) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, { 'Content-Type': mime })
    fs.createReadStream(file).pipe(response)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${server.address().port}`
  const debuggingPort = 19468
  const browser = spawn(
    process.argv[2] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + debuggingPort,
      '--user-data-dir=' + path.join(temporary, 'profile'),
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  )
  let socket
  try {
    let target
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json()).find(
          (item) => item.type === 'page',
        )
        if (target) break
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!target) throw Error('Chrome unavailable')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = reject
    })
    const pending = new Map(),
      errors = []
    let next = 0
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown')
        errors.push(
          message.params.exceptionDetails.exception?.description ||
            message.params.exceptionDetails.text,
        )
      if (message.id) {
        const action = pending.get(message.id)
        pending.delete(message.id)
        message.error ? action.reject(Error(message.error.message)) : action.resolve(message.result)
      }
    }
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++next,
          timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 15000)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject,
        })
        socket.send(JSON.stringify({ id, method, params }))
      })
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result.exceptionDetails)
        throw Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed')
      return result.result.value
    }
    const pause = () => new Promise((resolve) => setTimeout(resolve, 150))
    const wait = async (expression) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await evaluate(expression)) return
        await pause()
      }
      throw Error(
        'Browser wait failed: ' +
          expression +
          '\n' +
          JSON.stringify(errors) +
          '\n' +
          (await evaluate('document.body.textContent.slice(0,1800)')),
      )
    }
    const press = async (key) => {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
      await pause()
    }
    await call('Runtime.enable')
    await call('Page.enable')
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await call('Page.navigate', { url: address })
    await wait('!!document.querySelector("#broadcast-name")')
    await evaluate(
      `window.fill=(selector,value)=>{const node=document.querySelector(selector);Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))};window.clickText=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text).click()`,
    )
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("h2")].some(h=>h.textContent.includes("เกิน 24 ชั่วโมง"))',
      ),
      false,
    )
    assert.equal(await evaluate('/API|webhook|HTTP|Meta/.test(document.body.textContent)'), false)
    const buttons = await evaluate(
      `[...document.querySelectorAll('button')].map(b=>b.textContent.trim())`,
    )

    await evaluate(
      `fill('#broadcast-name','แจ้งข่าวร้านทดสอบ');fill('#broadcast-message','ขอบคุณที่สนใจสินค้าของร้านค่ะ สอบถามรายละเอียดเพิ่มเติมได้ทางแชทนี้')`,
    )
    await pause()
    const checkLabel = buttons.find((text) => text.includes('ตรวจ') && text.includes('ผู้รับ'))
    await evaluate('clickText(' + JSON.stringify(checkLabel) + ')')
    await wait(
      'document.body.textContent.includes("ยังไม่มีผู้รับที่ส่งได้ บันทึกฉบับร่างไว้ก่อนได้")',
    )
    assert.equal(await evaluate('broadcastFixture.calls.some(c=>c.url.endsWith("/send"))'), false)
    await evaluate('broadcastFixture.eligible=true;clickText(' + JSON.stringify(checkLabel) + ')')
    await wait(
      `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='ตรวจทานและยืนยันส่ง'&&!b.disabled)`,
    )
    await pause()
    await evaluate(`clickText('วิธีใช้งาน')`)
    await wait('!!document.querySelector("dialog[open]")')
    await evaluate(`clickText('ปิดคู่มือ')`)
    await wait('!document.querySelector("dialog[open]")')
    await evaluate(
      `for(const row of broadcastFixture.drafts.values()){row.message='ข้อความล่าสุดจากฉบับร่าง';row.audience_segment='pending_payment';row.audience_tags=['สนใจสินค้า']}clickText('เปิดฉบับร่าง')`,
    )
    await pause()
    assert.equal(
      await evaluate('document.querySelector("#broadcast-name").value'),
      'แจ้งข่าวร้านทดสอบ',
    )
    assert.equal(
      await evaluate('document.querySelector("#broadcast-message").value'),
      'ข้อความล่าสุดจากฉบับร่าง',
    )
    assert.equal(
      await evaluate('document.querySelector("#broadcast-segment").value'),
      'pending_payment',
    )
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("input[type=checkbox]")].filter(i=>i.checked).length',
      ),
      1,
    )
    await evaluate('clickText(' + JSON.stringify(checkLabel) + ')')
    await pause()
    await pause()
    assert.equal(
      await evaluate('document.querySelectorAll("select[aria-label]").length'),
      0,
      'The active Page must not be switchable',
    )
    assert.equal(
      await evaluate('broadcastFixture.calls.some(c=>c.url.includes("tenants/active"))'),
      false,
    )
    const screenshots = path.join(cwd, 'docs/screenshots')
    fs.mkdirSync(screenshots, { recursive: true })
    for (const width of [1440, 768, 375]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: width < 500,
      })
      await pause()
      assert.ok(
        await evaluate('document.documentElement.scrollWidth<=innerWidth'),
        'Horizontal overflow at ' + width,
      )
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })
      fs.writeFileSync(
        path.join(screenshots, 'broadcast-' + width + '.png'),
        Buffer.from(shot.data, 'base64'),
      )
    }
    const ready = await evaluate(
      `[...document.querySelectorAll('button')].filter(b=>!b.disabled).map(b=>b.textContent.trim())`,
    )
    const reviewLabel = ready.find((text) => text.includes('ตรวจทาน') || text.includes('ยืนยัน'))
    await evaluate('clickText(' + JSON.stringify(reviewLabel) + ')')
    await wait('!!document.querySelector("dialog[open]")')
    assert.equal(await evaluate('broadcastFixture.calls.some(c=>c.url.endsWith("/send"))'), false)
    await evaluate(`clickText('กลับไปแก้ไข')`)
    await wait('!document.querySelector("dialog[open]")')
    await evaluate(`fill('#broadcast-message','แก้ข้อความแล้ว ต้องตรวจผู้รับใหม่')`)
    await pause()
    assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), false)
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(reviewLabel)})?.disabled`,
      ),
      true,
    )
    await evaluate('clickText(' + JSON.stringify(checkLabel) + ')')
    await pause()
    await pause()
    await evaluate('clickText(' + JSON.stringify(reviewLabel) + ')')
    await wait('!!document.querySelector("dialog[open]")')
    await evaluate(`clickText('ยืนยันส่งข้อความจริง')`)
    await wait(
      'broadcastFixture.calls.some(c=>c.url.endsWith("/send"))&&!document.querySelector("dialog[open]")',
    )
    assert.equal(
      await evaluate('broadcastFixture.calls.filter(c=>c.url.endsWith("/send")).length'),
      1,
    )
    await evaluate(`clickText('บันทึกฉบับร่าง')`)
    await pause()
    await pause()
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('ลบฉบับร่าง ')).click()`,
    )
    await wait('!!document.querySelector("dialog[open]")')
    const beforeDelete = await evaluate('broadcastFixture.drafts.size')
    await evaluate(`clickText('ยกเลิก')`)
    await wait('!document.querySelector("dialog[open]")')
    assert.equal(await evaluate('broadcastFixture.drafts.size'), beforeDelete)
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('ลบฉบับร่าง ')).click()`,
    )
    await wait('!!document.querySelector("dialog[open]")')
    await evaluate(`clickText('ยืนยันลบ')`)
    await wait(
      '!document.querySelector("dialog[open]")&&document.querySelector("#broadcast-name").value===""',
    )
    assert.equal(await evaluate('broadcastFixture.drafts.size'), beforeDelete - 1)
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="เปิดฉบับร่าง")',
      ),
      false,
    )
    assert.deepEqual(errors, [])
    console.log(
      'PASS: actual BroadcastWorkspace; zero eligible draft/preview, confirmation, edit invalidation, mocked send once; 375/768/1440px without overflow. No live transport.',
    )
  } finally {
    socket?.close()
    browser.kill()
    await new Promise((resolve) => server.close(resolve))
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
