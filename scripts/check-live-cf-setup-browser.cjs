// Exercise the real React setup page in offline Chrome; all API calls are mocked.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const compiler = require('next/dist/compiled/webpack/webpack')
compiler.init()

;(async () => {
  const cwd = process.cwd()
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-live-setup-'))
  const mocks = path.join(cwd, 'scripts/fixtures/live-cf/setup-mocks.tsx')
  await new Promise((resolve, reject) =>
    compiler.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(cwd, 'scripts/fixtures/live-cf/setup-entry.tsx'),
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
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: cwd })]).process(
    fs.readFileSync('app/globals.css', 'utf8'),
    { from: path.join(cwd, 'app/globals.css') },
  )
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:'development'}};</script><script src="/bundle.js"></script></body></html>`
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript')
      fs.createReadStream(path.join(temporary, 'bundle.js')).pipe(response)
    } else if (url.pathname === '/sample-product.svg') {
      response.setHeader('Content-Type', 'image/svg+xml')
      response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ffedd5"/><path d="M60 40 25 70 45 95 60 85V160H140V85L155 95 175 70 140 40 120 55H80Z" fill="#fb923c"/></svg>',
      )
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(html)
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${server.address().port}`
  const port = 19477
  const browser = spawn(
    process.argv[2] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + path.join(temporary, 'profile'),
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  )
  let socket
  try {
    let target
    for (let i = 0; i < 100 && !target; i++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
          (t) => t.type === 'page',
        )
      } catch {}
      if (!target) await new Promise((r) => setTimeout(r, 100))
    }
    if (!target) throw Error('Chrome unavailable')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((yes, no) => {
      socket.onopen = yes
      socket.onerror = no
    })
    let id = 0
    const pending = new Map(),
      errors = []
    socket.onmessage = (event) => {
      const result = JSON.parse(event.data)
      if (result.method === 'Fetch.requestPaused') {
        void call('Fetch.fulfillRequest', {
          requestId: result.params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
          body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=',
        }).catch((error) => errors.push(error.message))
      }
      if (result.method === 'Runtime.exceptionThrown')
        errors.push(
          result.params.exceptionDetails.exception?.description ||
            result.params.exceptionDetails.text,
        )
      if (result.id) {
        const promise = pending.get(result.id)
        pending.delete(result.id)
        if (result.error) promise.reject(Error(result.error.message))
        else promise.resolve(result.result)
      }
    }
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const requestId = ++id
        const timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 15000)
        pending.set(requestId, {
          resolve: (r) => {
            clearTimeout(timer)
            resolve(r)
          },
          reject: (e) => {
            clearTimeout(timer)
            reject(e)
          },
        })
        socket.send(JSON.stringify({ id: requestId, method, params }))
      })
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result.exceptionDetails)
        throw Error(result.exceptionDetails.exception?.description || 'Evaluation failed')
      return result.result.value
    }
    const pause = () => new Promise((r) => setTimeout(r, 100))
    const wait = async (expression) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return
        await pause()
      }
      throw Error('Timeout: ' + expression + '\n' + errors.join('\n'))
    }
    const fill = async (selector, value) => {
      await evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
      )
      await pause()
    }
    const click = async (text) => {
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`,
      )
      await pause()
    }
    const resize = (width) =>
      call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 600,
      })
    const screenshot = async (name) => {
      const result = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })
      fs.mkdirSync('.tmp/live-cf-ui', { recursive: true })
      fs.writeFileSync(`.tmp/live-cf-ui/${name}.png`, Buffer.from(result.data, 'base64'))
    }
    await call('Runtime.enable')
    await call('Page.enable')
    await call('Fetch.enable', { patterns: [{ urlPattern: 'https://storage.example/*' }] })
    await call('Emulation.setFocusEmulationEnabled', { enabled: true })
    await resize(1440)
    await call('Page.navigate', { url: address })
    await wait(`!!document.querySelector('input[aria-label="ลิงก์หรือรหัสไลฟ์สด Facebook"]')`)
    assert.equal(
      await evaluate(`document.querySelector('aside').textContent.includes('159.00')`),
      true,
    )
    assert.equal(await evaluate(`document.querySelector('aside img').complete`), true)
    const link = 'input[aria-label="ลิงก์หรือรหัสไลฟ์สด Facebook"]'
    await evaluate(
      `(()=>{const data=new DataTransfer();data.setData('text','https://www.facebook.com/shop/videos/123456789012345678/');document.querySelector(${JSON.stringify(link)}).dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`,
    )
    await wait(`document.querySelector(${JSON.stringify(link)}).value==='123456789012345678'`)
    await fill(link, 'https://wrong.example/videos/123')
    await click('เริ่มเปิดระบบดูดออเดอร์')
    assert.equal(await evaluate('liveCfTest.requests.length'), 0)
    await fill(link, 'https://facebook.com/watch/live/?v=456')
    await evaluate(`document.querySelector(${JSON.stringify(link)}).blur()`)
    await wait(`document.querySelector(${JSON.stringify(link)}).value==='456'`)
    for (const width of [375, 768, 1440]) {
      await resize(width)
      await pause()
      assert.equal(
        await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),
        true,
        'Page overflow ' + width,
      )
      await screenshot('page-' + width)
    }
    await evaluate(`document.querySelector('input[name="matchMode"][value="strict"]').click()`)
    await pause()
    assert.equal(
      await evaluate(`document.body.textContent.includes('ไม่สร้างออเดอร์ — ข้อความไม่ตรง')`),
      true,
    )
    await click('เพิ่มสินค้าใหม่เข้าเซลล์เพจ')
    await wait(`!!document.querySelector('dialog[open]')`)
    assert.equal(await evaluate(`document.activeElement.name`), 'cf_code')
    assert.equal(
      await evaluate(
        `document.querySelector('dialog').textContent.includes('ต้นทุน')||document.querySelector('dialog').textContent.includes('ราคาเปรียบเทียบ')`,
      ),
      false,
    )
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })
    await wait(`!document.querySelector('dialog')`)
    await evaluate('liveCfTest.categoryFailure=true')
    await click('เพิ่มสินค้าใหม่เข้าเซลล์เพจ')
    await wait(`!!document.querySelector('dialog[open]')`)
    await wait(`!!document.querySelector('#quick-category-error')`)
    assert.equal(
      await evaluate(`document.querySelector('dialog button[type="submit"]').disabled`),
      true,
    )
    await evaluate('liveCfTest.categoryFailure=false')
    await click('ลองโหลดใหม่')
    await wait(`!document.querySelector('select[name="category_id"]').disabled`)
    await fill('dialog input[name="name"]', 'สินค้าใหม่จากไลฟ์')
    await fill('dialog input[name="price"]', '259.50')
    await fill('dialog input[name="stock"]', '12')
    await fill('dialog input[name="cf_code"]', 'A1')
    await fill('dialog select[name="category_id"]', '77777777-7777-4777-8777-777777777777')
    await fill('dialog textarea[name="description"]', 'รายละเอียดสินค้าใหม่ พร้อมรูปและตัวเลือก')
    await evaluate(`document.querySelector('dialog input[name="featured"]').click()`)
    const attachImage = () =>
      evaluate(
        `(()=>{const data=new DataTransfer();const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));data.items.add(new File([bytes],'product.png',{type:'image/png'}));const input=document.querySelector('input[aria-label="อัปโหลดรูปสินค้า"]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      )
    await evaluate('liveCfTest.uploadFailure=true')
    await attachImage()
    await wait(`document.querySelector('dialog').textContent.includes('อัปโหลดรูปไม่สำเร็จ')`)
    await evaluate('liveCfTest.uploadFailure=false')
    await attachImage()
    await evaluate(`document.querySelector('dialog form').requestSubmit()`)
    await wait(`!!document.querySelector('dialog img')`)
    assert.equal(
      await evaluate('liveCfTest.requests.filter(r=>r.url==="/api/commerce").length'),
      0,
      'Cannot save while uploading',
    )
    await wait(`document.querySelector('dialog img').naturalWidth>0`)
    await click('เพิ่มตัวเลือก')
    await fill('input[name="variant_label_0"]', 'พิมพ์ใหญ่ / เนื้อเงิน')
    await fill('input[name="variant_code_0"]', 'A1-L')
    await fill('input[name="variant_price_0"]', '299.50')
    await fill('input[name="variant_stock_0"]', '3')
    await click('เพิ่มตัวเลือก')
    await fill('input[name="variant_label_1"]', 'พิมพ์เล็ก / เนื้อทองแดง')
    await fill('input[name="variant_price_1"]', '259.50')
    await fill('input[name="variant_stock_1"]', '2')
    assert.equal(await evaluate(`document.querySelector('dialog input[name="stock"]').value`), '5')
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="stock"]').disabled`),
      true,
    )
    for (const width of [375, 768, 1440]) {
      await resize(width)
      await pause()
      assert.equal(
        await evaluate(
          `(()=>{const d=document.querySelector('dialog');const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&d.scrollWidth<=d.clientWidth+1})()`,
        ),
        true,
        'Modal overflow ' + width,
      )
      await screenshot('modal-' + width)
    }
    await evaluate('liveCfTest.failure=true')
    await click('บันทึกและเลือกสินค้านี้')
    await wait(`!!document.querySelector('dialog [role="alert"]')`)
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="cf_code"]').value`),
      'A1',
    )
    await evaluate('liveCfTest.failure=false')
    await evaluate(
      `(()=>{const form=document.querySelector('dialog form');form.requestSubmit();form.requestSubmit()})()`,
    )
    await wait(`!document.querySelector('dialog')`)
    assert.equal(
      await evaluate('liveCfTest.requests.filter(r=>r.url==="/api/commerce").length'),
      2,
      'one rejected attempt plus one successful request',
    )
    assert.equal(
      await evaluate('liveCfTest.refreshes'),
      0,
      'No page refresh after creating a product',
    )
    assert.equal(
      await evaluate(
        `document.querySelector('select[aria-label="สินค้าจากร้านค้า / เซลเพจ"]').value`,
      ),
      await evaluate('liveCfTest.newProductId'),
    )
    assert.equal(
      await evaluate(
        `document.querySelector('input[aria-label="รหัสสินค้าที่ให้ลูกค้าพิมพ์จอง"]').value`,
      ),
      'A1',
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside').textContent.includes('299.50')&&document.querySelector('aside').textContent.includes('3 ชิ้น')`,
      ),
      true,
    )
    const product = await evaluate('liveCfTest.requests.find(r=>r.url==="/api/commerce").body')
    assert.equal(product.tenantId, '11111111-1111-4111-8111-111111111111')
    assert.equal(product.action, 'product')
    assert.equal(product.value.code, 'A1')
    assert.equal(product.value.is_active, true)
    assert.equal(product.value.featured, true)
    assert.equal(product.value.category_id, '77777777-7777-4777-8777-777777777777')
    assert.deepEqual(product.value.images, ['https://storage.example/commerce/test/product.webp'])
    assert.equal(product.value.description, 'รายละเอียดสินค้าใหม่ พร้อมรูปและตัวเลือก')
    assert.equal(product.value.stock, 5)
    assert.equal(product.value.variants.length, 2)
    assert.equal(
      await evaluate(`document.querySelector('select[aria-label="ตัวเลือกสินค้า"]').value`),
      product.value.variants[0].id,
    )
    await fill('select[aria-label="ตัวเลือกสินค้า"]', product.value.variants[1].id)
    await click('เริ่มเปิดระบบดูดออเดอร์')
    await wait(
      `liveCfTest.requests.some(r=>r.url==='/api/live-cf/setup')&&liveCfTest.refreshes===1`,
    )
    const setup = await evaluate('liveCfTest.requests.find(r=>r.url==="/api/live-cf/setup").body')
    assert.equal(setup.livePostId, '456')
    assert.equal(setup.productId, await evaluate('liveCfTest.newProductId'))
    assert.equal(setup.matchMode, 'strict')
    assert.equal(setup.variantId, product.value.variants[1].id)
    assert.ok(setup.privateText.includes('{product_name}'))
    assert.ok(setup.privateText.includes('{payment_link}'))
    assert.equal(setup.privateText.includes('{ชื่อสินค้า}'), false)
    await call('Page.navigate', { url: address + '/?empty=1' })
    await wait(`!!document.querySelector('select[aria-label="สินค้าจากร้านค้า / เซลเพจ"]')`)
    await click('เพิ่มสินค้าใหม่เข้าเซลล์เพจ')
    await wait(`!!document.querySelector('dialog[open]')`)
    await fill('dialog input[name="name"]', 'สินค้าแรกของร้าน')
    await fill('dialog input[name="price"]', '99')
    await fill('dialog input[name="stock"]', '2')
    await fill('dialog input[name="cf_code"]', 'FIRST')
    await click('บันทึกและเลือกสินค้านี้')
    await wait(`!document.querySelector('dialog')`)
    assert.equal(
      await evaluate(
        `document.querySelector('a[href="/s/test-shop"]').textContent.includes('เปิดดู')`,
      ),
      true,
    )
    assert.equal(await evaluate('liveCfTest.refreshes'), 0)
    await call('Page.navigate', { url: address + '/?empty=1' })
    await wait(`!!document.querySelector('select[aria-label="สินค้าจากร้านค้า / เซลเพจ"]')`)
    await click('เพิ่มสินค้าใหม่เข้าเซลล์เพจ')
    await wait(`!!document.querySelector('dialog[open]')`)
    await fill('dialog input[name="name"]', 'สินค้ายังไม่เปิดขาย')
    await fill('dialog input[name="price"]', '99')
    await fill('dialog input[name="cf_code"]', 'DRAFT')
    await evaluate(`document.querySelector('dialog input[name="is_active"]').click()`)
    await wait(`!document.querySelector('select[name="category_id"]').disabled`)
    await click('บันทึกและเลือกสินค้านี้')
    await wait(`!document.querySelector('dialog')`)
    await click('เริ่มเปิดระบบดูดออเดอร์')
    assert.equal(await evaluate(`liveCfTest.requests.some(r=>r.url==='/api/live-cf/setup')`), false)
    assert.equal(await evaluate(`document.body.textContent.includes('ยังไม่เปิดขาย')`), true)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: Live CF full product modal: categories/retry, image upload/retry, variants with stable IDs and stock totals, sale/featured flags, no cost/compare fields, immediate selection, no refresh, duplicate-submit guard, and 375/768/1440 layouts. Offline APIs only.',
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
