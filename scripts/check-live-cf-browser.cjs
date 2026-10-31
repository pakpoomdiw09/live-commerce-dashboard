const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process')
const w = require('next/dist/compiled/webpack/webpack')
w.init()
;(async () => {
  const cwd = process.cwd(),
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-live-cf-')),
    mock = path.join(cwd, 'scripts/fixtures/live-cf/mocks.tsx')
  await new Promise((resolve, reject) =>
    w.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(cwd, 'scripts/fixtures/live-cf/entry.tsx'),
        output: { path: root, filename: 'bundle.js' },
        resolve: {
          extensions: ['.tsx', '.ts', '.js', '.json'],
          alias: {
            '@/lib/supabase/browser$': mock,
            'next/link$': mock,
            'next/navigation$': mock,
            '@': cwd,
          },
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
  const css = fs
    .readdirSync('.next/static/css')
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join('.next/static/css', f), 'utf8'))
    .join('\n')
  fs.writeFileSync(
    path.join(root, 'index.html'),
    `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:'development'}};</script><script src="bundle.js"></script></body></html>`,
  )
  const port = 19465,
    browser = spawn(
      process.argv[2] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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
    if (!target) throw Error('Chrome unavailable')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((yes, no) => {
      socket.onopen = yes
      socket.onerror = no
    })
    let sequence = 0
    const pending = new Map(),
      errors = []
    socket.onmessage = (event) => {
      const r = JSON.parse(event.data)
      if (r.method === 'Runtime.exceptionThrown')
        errors.push(
          r.params.exceptionDetails.exception?.description || r.params.exceptionDetails.text,
        )
      if (r.id) {
        const p = pending.get(r.id)
        pending.delete(r.id)
        r.error ? p.reject(Error(r.error.message)) : p.resolve(r.result)
      }
    }
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence,
          timer = setTimeout(() => reject(Error('CDP timeout ' + method)), 15000)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        socket.send(JSON.stringify({ id, method, params }))
      })
    const evaluate = async (expression) => {
      const r = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails)
        throw Error(r.exceptionDetails.exception?.description || 'Browser expression failed')
      return r.result.value
    }
    const pause = () => new Promise((r) => setTimeout(r, 120))
    const wait = async (expression) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return
        await pause()
      }
      throw Error(
        'Browser wait ' +
          expression +
          ' ' +
          JSON.stringify(errors) +
          ' ' +
          (await evaluate('document.body.textContent.slice(-1000)')),
      )
    }
    const fill = async (selector, value) => {
      await evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
      )
      await pause()
    }
    const save = () =>
      evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='บันทึก').click()`)
    await call('Runtime.enable')
    await call('Page.enable')
    await call('Emulation.setFocusEmulationEnabled', { enabled: true })
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await call('Page.navigate', {
      url: require('node:url').pathToFileURL(path.join(root, 'index.html')).href,
    })
    await wait(`!!document.querySelector('input[name="rule-mode"]')`)
    assert.equal(await evaluate('document.querySelectorAll("textarea").length'), 1)
    await evaluate(`document.querySelector('input[name="rule-mode"][value="live_cf"]').click()`)
    await pause()
    assert.equal(await evaluate('document.querySelectorAll("textarea").length'), 0)
    await fill('input[aria-label="ชื่อชุดตอบกลับ"]', 'Live เสื้อสีขาว')
    await fill('input[aria-label="เพิ่มคีย์เวิร์ด"]', 'Z99')
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    })
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    })
    await wait(`!!document.querySelector('button[aria-label="ลบ Z99"]')`)
    await pause()
    await save()
    await wait(`document.body.textContent.includes('เลือกสินค้าของร้าน')`)
    assert.equal(await evaluate('liveCfTest.saves.length'), 0)
    await fill('select[aria-label="สินค้าจากร้านค้า / เซลเพจ"]', 'p1')
    await save()
    await wait(`document.body.textContent.includes('เลือกตัวเลือกสินค้า')`)
    await fill('select[aria-label="ตัวเลือกสินค้า"]', 'v1')
    await fill('select[aria-label="สต็อกที่ใช้ขาย"]', 'limited')
    await fill('input[aria-label="จำนวนที่ปล่อยขายในไลฟ์"]', '2')
    await fill('input[aria-label="รหัสโพสต์ / วิดีโอไลฟ์"]', '100_456')
    await evaluate(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='บันทึก');b.click();b.click();})()`,
    )
    await wait('liveCfTest.saves.length===1')
    for (const width of [375, 768, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1200,
        deviceScaleFactor: 1,
        mobile: width < 600,
      })
      await pause()
      assert.equal(
        await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),
        true,
        'no horizontal overflow ' + width,
      )
      const dimensions = await call('Page.getLayoutMetrics')
      const screenshot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height: Math.ceil(dimensions.cssContentSize.height), scale: 1 },
      })
      fs.mkdirSync('docs/screenshots', { recursive: true })
      fs.writeFileSync(
        `docs/screenshots/live-cf-mode-${width}.png`,
        Buffer.from(screenshot.data, 'base64'),
      )
    }
    const row = await evaluate('liveCfTest.saves[0]')
    assert.equal(row.mode, 'live_cf')
    assert.equal(row.live_product_id, 'p1')
    assert.equal(row.live_variant_id, 'v1')
    assert.equal(row.live_stock_limit, 2)
    assert.deepEqual(row.keywords, ['Z99'])
    await evaluate(`document.querySelector('[data-test="edit"]').click()`)
    await pause()
    assert.equal(
      await evaluate(`document.querySelector('select[aria-label="ตัวเลือกสินค้า"]').value`),
      'v1',
    )
    assert.equal(
      await evaluate(`document.querySelector('input[aria-label="จำนวนที่ปล่อยขายในไลฟ์"]').value`),
      '2',
    )
    await fill('select[aria-label="สต็อกที่ใช้ขาย"]', 'shared')
    await save()
    await wait('liveCfTest.saves.length===2')
    assert.equal(await evaluate('liveCfTest.saves[1].live_stock_limit'), null)
    await evaluate(`document.querySelector('input[name="rule-mode"][value="general"]').click()`)
    await pause()
    await fill('textarea', 'ขอบคุณที่สนใจค่ะ')
    await save()
    await wait('liveCfTest.saves.length===3')
    const general = await evaluate('liveCfTest.saves[2]')
    assert.equal(general.mode, 'general')
    assert.equal(general.live_product_id, null)
    assert.equal(general.live_variant_id, null)
    assert.equal(general.live_post_id, null)
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(
      'PASS: Live CF editor in Chrome/Strict Mode: create/edit, arbitrary alias, product/variant validation, quota/shared stock, scoped post, duplicate-click guard, general mode and 375/768/1440 layouts.',
    )
  } finally {
    socket?.close()
    browser.kill()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
