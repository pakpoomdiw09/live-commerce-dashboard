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
        `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));button.focus();button.click()})()`,
      )
      await pause()
    }
    const enterCode = async (value) => {
      await fill('input[aria-label="เพิ่มรหัสสั่งซื้อ"]', value)
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
    const productSelect = 'select[aria-label="สินค้าจากร้านค้า / เซลเพจ"]'
    const assertNoProductSelected = async () => {
      assert.equal(
        await evaluate(`document.querySelector(${JSON.stringify(productSelect)}).value`),
        '',
      )
      assert.equal(
        await evaluate(
          `document.querySelector(${JSON.stringify(productSelect)}).selectedOptions[0].textContent`,
        ),
        'เลือกสินค้า',
      )
      assert.equal(
        await evaluate(
          `document.querySelector(${JSON.stringify(productSelect)}).closest('section').querySelector('img') === null`,
        ),
        true,
      )
      assert.equal(await evaluate(`document.querySelector('aside img') === null`), true)
      assert.equal(
        await evaluate(
          `document.querySelector('aside').textContent.includes('กรุณาเลือกสินค้าเพื่อดูสรุป')`,
        ),
        true,
      )
    }
    await assertNoProductSelected()
    assert.equal(
      await evaluate(
        `document.querySelectorAll('[aria-label="รหัสสั่งซื้อที่เพิ่มแล้ว"] button').length`,
      ),
      0,
    )
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('h2')).some(h=>h.textContent.includes('กำหนดคีย์เวิร์ดดูดออเดอร์ (Keywords)'))`,
      ),
      true,
    )
    await fill(productSelect, '33333333-3333-4333-8333-333333333333')
    assert.equal(
      await evaluate(`document.querySelector('aside').textContent.includes('159.00')`),
      true,
    )
    assert.equal(await evaluate(`document.querySelector('aside img').complete`), true)
    assert.equal(
      await evaluate(
        `document.querySelector('aside dl').textContent.includes('คีย์เวิร์ดคำสั่งซื้อ')`,
      ),
      true,
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside dl').textContent.includes('ตรวจจับที่มีคีย์เวิร์ด (Contains)')`,
      ),
      true,
    )
    await fill(productSelect, '')
    await assertNoProductSelected()
    await fill(productSelect, '33333333-3333-4333-8333-333333333333')
    const link = 'input[aria-label="ลิงก์หรือรหัสไลฟ์สด Facebook"]'
    const liveSelector = '[role="combobox"][aria-label="ไลฟ์สด Facebook"]'
    await wait(`document.querySelector(${JSON.stringify(liveSelector)})?.dataset.selectedVideoId === '456'`)
    await evaluate('liveCfTest.liveExtra=true')
    await click('โหลดรายการใหม่')
    await wait(`!document.querySelector(${JSON.stringify(liveSelector)}).disabled`)
    await evaluate(`document.querySelector(${JSON.stringify(liveSelector)}).click()`)
    await wait(`document.querySelectorAll('[role=listbox] [role=option]').length===2`)
    assert.ok(await evaluate(`document.querySelector('[role=listbox]').textContent.includes('⚪ สิ้นสุดแล้ว')`))
    assert.ok(await evaluate(`document.querySelector('[role=listbox]').textContent.includes('987654…5432')`))
    for (const width of [375, 768, 1440]) {
      await resize(width)
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
      assert.ok(await evaluate(`document.querySelector('[role=listbox]').getBoundingClientRect().right<=innerWidth`))
      await screenshot('live-dropdown-'+width)
    }
    for (const key of ['End','Enter'])
      await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='End'?35:13})
    await wait(`document.querySelector(${JSON.stringify(liveSelector)}).dataset.selectedVideoId==='987654321098765432'`)
    await evaluate(`document.querySelector(${JSON.stringify(liveSelector)}).click()`)
    await evaluate(`document.querySelector('[role=listbox] [role=option]').click()`)
    await wait(`document.querySelector(${JSON.stringify(liveSelector)}).dataset.selectedVideoId==='456'`)
    await evaluate(`document.querySelector(${JSON.stringify(liveSelector)}).click()`)
    await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
    await wait(`!document.querySelector('[role=listbox]')`)
    await evaluate('liveCfTest.liveExtra=false')
    assert.equal(
      await evaluate(`!!document.querySelector('button[aria-label="ลบรหัส 159"]')`),
      true,
      'Selecting a product automatically supplies its SKU',
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="ตัวอย่างคำสั่งซื้อ"]').textContent.includes('รับ 159')`,
      ),
      true,
    )
    await evaluate(`document.querySelector('button[aria-label="ลบรหัส 159"]').click()`)
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(link)}).readOnly`), true)
    await evaluate('liveCfTest.liveFailure=true')
    await click('โหลดรายการใหม่')
    await wait(`document.querySelector('[role="alert"]')?.textContent.includes('กรุณาเชื่อมต่อเพจใหม่')`)
    assert.equal(
      await evaluate(
        `document.querySelector('[role="alert"]').textContent.includes('กรุณาเชื่อมต่อเพจใหม่')`,
      ),
      true,
    )
    await evaluate('liveCfTest.liveFailure=false;liveCfTest.liveEmpty=true')
    await click('โหลดรายการใหม่')
    await wait(`document.body.textContent.includes('ยังไม่พบไลฟ์ที่กำลังออกอากาศ')`)
    assert.equal(
      await evaluate(`document.body.textContent.includes('ยังไม่พบไลฟ์ที่กำลังออกอากาศ')`),
      true,
    )
    await evaluate('liveCfTest.liveEmpty=false')
    await click('โหลดรายการใหม่')
    await wait(`!document.querySelector(${JSON.stringify(liveSelector)}).disabled`)
    assert.equal(
      await evaluate(`document.body.textContent.includes('ดูภาพตัวอย่างไลฟ์')`),
      false,
    )
    await evaluate(`document.querySelector(${JSON.stringify(liveSelector)}).click()`)
    await wait(`document.querySelectorAll('[role=listbox] [role=option]').length===1`)
    for (const width of [375, 768, 1440]) {
      await resize(width)
      await pause()
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true)
      assert.equal(
        await evaluate(
          `document.querySelector('[role=listbox]').getBoundingClientRect().right<=innerWidth`,
        ),
        true,
      )
      await screenshot('live-picker-' + width)
    }
    await evaluate(`document.querySelector('[role=listbox] [role=option]').click()`)
    await wait(`document.querySelector(${JSON.stringify(liveSelector)}).dataset.selectedVideoId==='456'`)
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(link)}).value`), '456')
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="ไลฟ์สดที่เลือก"]').textContent.includes('ไลฟ์เสื้อผ้าวันนี้')`,
      ),
      true,
    )
    assert.equal(
      await evaluate(
        `(()=>{const trigger=document.querySelector('[role="combobox"][aria-label="ไลฟ์สด Facebook"]');const thumb=trigger?.querySelector('span.h-8.w-8');return !!thumb&&(!!thumb.querySelector('img')||!!thumb.querySelector('svg.lucide-video'))})()`,
      ),
      true,
    )
    await fill('select[aria-label="เลือกเพจ Facebook"]', '200')
    await wait(`!document.querySelector(${JSON.stringify(liveSelector)}).disabled`)
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(link)}).value`), '654')
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="ไลฟ์สดที่เลือก"]').textContent.includes('ไลฟ์สดเพจที่สอง')`,
      ),
      true,
    )
    await evaluate(`document.querySelector(${JSON.stringify(liveSelector)}).click()`)
    await wait(`document.querySelector('[role=listbox]').textContent.includes('ไลฟ์สดเพจที่สอง')`)
    await evaluate(`document.querySelector('[role=listbox] [role=option]').click()`)
    await wait(`document.querySelector(${JSON.stringify(liveSelector)}).dataset.selectedVideoId==='654'`)
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(link)}).value`), '654')
    await fill('select[aria-label="เลือกเพจ Facebook"]', '')
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('เลือกจากไลฟ์สดปัจจุบัน')).disabled`,
      ),
      true,
    )
    await fill('select[aria-label="เลือกเพจ Facebook"]', '100')
    await wait(`!document.querySelector(${JSON.stringify(liveSelector)}).disabled`)
    await evaluate(`document.querySelector(${JSON.stringify(liveSelector)}).click()`)
    await wait(`!!document.querySelector('[role=listbox]')`)
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
    await wait(`!document.querySelector('[role=listbox]')`)
    assert.equal(
      await evaluate(`document.querySelector(${JSON.stringify(link)}).value`),
      '456',
      'Closing the dropdown preserves the automatically selected live',
    )
    await click('กรอกรหัสด้วยตนเอง')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(link)}).readOnly`), false)
    await evaluate('liveCfTest.liveFallback=true')
    await click('โหลดรายการใหม่')
    await wait(`!document.querySelector(${JSON.stringify(liveSelector)}).disabled`)
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('ยังไม่พบไลฟ์ที่กำลังออกอากาศ เลือกวิดีโอล่าสุดได้จากรายการ')`,
      ),
      true,
    )
    await evaluate(`document.querySelector(${JSON.stringify(liveSelector)}).click()`)
    await wait(`document.querySelector('[role=listbox] [role=option]').textContent.includes('⚪ สิ้นสุดแล้ว')`)
    await evaluate(`document.querySelector('[role=listbox] [role=option]').click()`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="ไลฟ์สดที่เลือก"]').textContent.includes('ไลฟ์เสื้อผ้าวันนี้')`,
      ),
      true,
    )
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(link)}).value`), '456')
    await evaluate('liveCfTest.liveFallback=false')
    await click('กรอกรหัสด้วยตนเอง')
    await evaluate(
      `(()=>{const data=new DataTransfer();data.setData('text','https://www.facebook.com/shop/videos/123456789012345678/');document.querySelector(${JSON.stringify(link)}).dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`,
    )
    await wait(`document.querySelector(${JSON.stringify(link)}).value==='123456789012345678'`)
    await fill(link, 'https://wrong.example/videos/123')
    await click('เริ่มเปิดระบบดูดออเดอร์')
    assert.equal(
      await evaluate(`liveCfTest.requests.filter(r=>r.url==='/api/live-cf/setup').length`),
      0,
    )
    await fill(link, 'https://facebook.com/watch/live/?v=456')
    await evaluate(`document.querySelector(${JSON.stringify(link)}).blur()`)
    await wait(`document.querySelector(${JSON.stringify(link)}).value==='456'`)
    const tagCount = `document.querySelectorAll('[aria-label="รหัสสั่งซื้อที่เพิ่มแล้ว"] button').length`
    assert.equal(await evaluate(tagCount), 0, 'New rules start without a prefilled product code')
    assert.equal(
      await evaluate(`document.querySelector('input[aria-label="เพิ่มรหัสสั่งซื้อ"]').value`),
      '',
    )
    assert.equal(
      await evaluate(`document.querySelector('input[aria-label="ทดลองพิมพ์คอมเมนต์"]').value`),
      '',
    )
    const exampleTexts = `Array.from(document.querySelectorAll('[aria-label="ตัวอย่างคำสั่งซื้อ"] button'), b=>b.textContent.trim())`
    assert.deepEqual(await evaluate(exampleTexts), [])
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="ตัวอย่างคำสั่งซื้อ"]').textContent.includes('กรุณากรอกรหัสสินค้าเพื่อดูตัวอย่าง')`,
      ),
      true,
    )
    await fill('input[aria-label="เพิ่มรหัสสั่งซื้อ"]', 'A1')
    assert.deepEqual(await evaluate(exampleTexts), [
      'A1',
      'รับ A1',
      'จอง A1',
      'เอา A1',
      'A1 ครับ',
      'A1 ค่ะ',
    ])
    assert.equal(await evaluate(tagCount), 0, 'Preview must work before committing the draft tag')
    for (const comment of ['A1', 'รับA1', 'จองA1', 'เอาA1', 'ปิดA1', 'A1ครับ', 'A1ค่ะ']) {
      await fill('input[aria-label="ทดลองพิมพ์คอมเมนต์"]', comment)
      assert.equal(
        await evaluate(
          `document.querySelector('aside').textContent.includes('ระบบพร้อมสร้างออเดอร์')`,
        ),
        true,
        comment,
      )
    }
    await fill('input[aria-label="เพิ่มรหัสสั่งซื้อ"]', '')
    assert.deepEqual(await evaluate(exampleTexts), [])
    for (const keyword of ['CF159', '159']) {
      await fill('input[aria-label="เพิ่มรหัสสั่งซื้อ"]', keyword)
      const comments =
        keyword === 'CF159'
          ? ['cf159?', 'เอา cf 159', 'ข้อความก่อนCF159ข้อความหลัง!']
          : ['cf159?', 'รับ 159 ครับ', 'เอา cf 159', '1590!']
      for (const comment of comments) {
        await fill('input[aria-label="ทดลองพิมพ์คอมเมนต์"]', comment)
        assert.equal(
          await evaluate(
            `document.querySelector('aside').textContent.includes('ระบบพร้อมสร้างออเดอร์')`,
          ),
          true,
          `${keyword}: ${comment}`,
        )
      }
      await evaluate(`document.querySelector('input[name="matchMode"][value="strict"]').click()`)
      await pause()
      assert.equal(
        await evaluate(
          `document.querySelector('aside').textContent.includes('ระบบพร้อมสร้างออเดอร์')`,
        ),
        false,
      )
      await fill('input[aria-label="ทดลองพิมพ์คอมเมนต์"]', keyword.toLowerCase())
      assert.equal(
        await evaluate(
          `document.querySelector('aside').textContent.includes('ระบบพร้อมสร้างออเดอร์')`,
        ),
        true,
      )
      await evaluate(`document.querySelector('input[name="matchMode"][value="flexible"]').click()`)
      await pause()
    }
    await fill('input[aria-label="เพิ่มรหัสสั่งซื้อ"]', '')
    await enterCode('')
    assert.equal(await evaluate(tagCount), 0)
    await enterCode('159')
    assert.equal(await evaluate(tagCount), 1)
    await fill('input[aria-label="เพิ่มรหัสสั่งซื้อ"]', 'A1')
    await click('เพิ่มรหัส')
    assert.equal(await evaluate(tagCount), 2)
    await enterCode('a1')
    assert.equal(await evaluate(tagCount), 2)
    assert.equal(
      await evaluate(
        `document.querySelector('#live-cf-code-status').textContent.includes('รหัสนี้มีอยู่แล้ว')`,
      ),
      true,
    )
    await enterCode('B2')
    await fill('input[aria-label="เพิ่มรหัสสั่งซื้อ"]', 'จอง')
    await evaluate(
      `document.querySelector('input[aria-label="เพิ่มรหัสสั่งซื้อ"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))`,
    )
    assert.equal(await evaluate(tagCount), 3, 'IME confirmation must not add a partial tag')
    await enterCode('จอง')
    await enterCode('รับ1')
    assert.equal(await evaluate(tagCount), 5)
    assert.equal(
      await evaluate(`document.querySelector('input[aria-label="เพิ่มรหัสสั่งซื้อ"]').disabled`),
      true,
    )
    assert.equal(
      await evaluate(
        `document.querySelector('#live-cf-code-status').textContent.includes('เพิ่มได้สูงสุด 5 รหัส')`,
      ),
      true,
    )
    for (const code of ['A1', '159', 'จอง', 'B2', 'รับ1']) {
      await fill('input[aria-label="ทดลองพิมพ์คอมเมนต์"]', `รับ ${code}`)
      assert.equal(
        await evaluate(
          `document.querySelector('aside').textContent.includes('ระบบพร้อมสร้างออเดอร์')`,
        ),
        true,
        code,
      )
      assert.equal(
        await evaluate(
          `document.querySelector('[aria-label="ตัวอย่างคำสั่งซื้อ"]').textContent.includes(${JSON.stringify(code)})`,
        ),
        true,
      )
    }
    assert.equal(
      await evaluate(
        `/(CF|FC)/i.test(document.querySelector('[aria-label="ตัวอย่างคำสั่งซื้อ"]').textContent)`,
      ),
      false,
    )
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
    while (await evaluate(tagCount)) {
      await evaluate(
        `document.querySelector('[aria-label="รหัสสั่งซื้อที่เพิ่มแล้ว"] button').click()`,
      )
      await pause()
    }
    await click('เริ่มเปิดระบบดูดออเดอร์')
    assert.equal(await evaluate(`liveCfTest.requests.some(r=>r.url==='/api/live-cf/setup')`), false)
    await enterCode('159')
    await fill('input[aria-label="ทดลองพิมพ์คอมเมนต์"]', 'รับ 159')
    await evaluate(`document.querySelector('input[name="matchMode"][value="strict"]').click()`)
    await pause()
    assert.equal(
      await evaluate(
        `document.querySelector('aside dl').textContent.includes('ตรงตามคีย์เวิร์ด (Exact Match)')`,
      ),
      true,
    )
    assert.equal(
      await evaluate(`document.body.textContent.includes('พิมพ์ติดคำอื่นก็ดูดได้')`),
      false,
    )
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
    assert.equal(
      await evaluate(`document.querySelectorAll('dialog input[type="checkbox"]').length`),
      0,
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
    assert.ok(
      await evaluate(`document.querySelector('dialog img').getBoundingClientRect().width<=81`),
    )
    await click('เพิ่มตัวเลือก')
    await fill('input[name="option_name_0"]', 'สี')
    await fill('input[name="option_values_0"]', 'ขาว, ดำ')
    await click('เพิ่มค่า')
    await click('เพิ่มตัวเลือก')
    await fill('input[name="option_name_1"]', 'ขนาด')
    await fill('input[name="option_values_1"]', 'S, M')
    await evaluate(
      `document.querySelector('input[name="option_values_1"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`,
    )
    await wait(`document.querySelectorAll('input[name^="variant_price_"]').length===4`)
    assert.equal(
      await evaluate(`document.querySelector('input[name="variant_price_0"]').required`),
      false,
    )
    assert.equal(
      await evaluate(`document.querySelector('input[name="variant_stock_0"]').required`),
      false,
    )
    assert.equal(await evaluate(`!!document.querySelector('input[name^="variant_code_"]')`), false)
    await fill('input[name="variant_price_0"]', '299.50')
    await fill('input[name="variant_stock_0"]', '0')
    assert.equal(await evaluate(`document.querySelector('dialog input[name="stock"]').value`), '12')
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="stock"]').disabled`),
      false,
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
        `document.querySelector('[aria-label="รหัสสั่งซื้อที่เพิ่มแล้ว"]').textContent.trim()`,
      ),
      'A1',
    )
    assert.equal(
      await evaluate(
        `document.querySelector('aside').textContent.includes('259.50')&&document.querySelector('aside').textContent.includes('12 ชิ้น')`,
      ),
      true,
    )
    const product = await evaluate('liveCfTest.requests.find(r=>r.url==="/api/commerce").body')
    assert.equal(product.tenantId, '11111111-1111-4111-8111-111111111111')
    assert.equal(product.action, 'product')
    assert.equal(product.value.code, 'A1')
    assert.equal(product.value.is_active, true)
    assert.equal(product.value.featured, false)
    assert.equal(product.value.category_id, '77777777-7777-4777-8777-777777777777')
    assert.deepEqual(product.value.images, ['https://storage.example/commerce/test/product.webp'])
    assert.equal(product.value.description, 'รายละเอียดสินค้าใหม่ พร้อมรูปและตัวเลือก')
    assert.equal(product.value.stock, 12)
    assert.equal(product.value.variants.length, 4)
    assert.equal(product.value.variants[0].stock, 0)
    assert.equal(product.value.variants[1].price, 259.5)
    assert.ok(product.value.variants.every((v) => v.variant_code === null))
    await enterCode('159')
    await enterCode('จอง')
    for (const code of ['A1', '159', 'จอง']) {
      await fill('input[aria-label="ทดลองพิมพ์คอมเมนต์"]', code)
      assert.equal(
        await evaluate(
          `document.querySelector('aside').textContent.includes('ระบบพร้อมสร้างออเดอร์')`,
        ),
        true,
      )
    }
    await fill('input[aria-label="ทดลองพิมพ์คอมเมนต์"]', 'รับ 159')
    assert.equal(
      await evaluate(
        `document.querySelector('aside').textContent.includes('ระบบพร้อมสร้างออเดอร์')`,
      ),
      false,
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="ตัวอย่างคำสั่งซื้อ"]').querySelectorAll('button').length`,
      ),
      3,
    )
    await fill('input[aria-label="เพิ่มรหัสสั่งซื้อ"]', 'B2')
    await evaluate("liveCfTest.liveId='789'")
    await click('โหลดรายการใหม่')
    await wait(`!document.querySelector('[role=combobox][aria-label="ไลฟ์สด Facebook"]').disabled`)
    await evaluate(`document.querySelector('[role=combobox][aria-label="ไลฟ์สด Facebook"]').click()`)
    await wait(`document.querySelector('[role=listbox]').textContent.includes('รหัสวิดีโอ 789')`)
    await evaluate(`document.querySelector('[role=listbox] [role=option]').click()`)
    await wait(`document.querySelector('[role=combobox][aria-label="ไลฟ์สด Facebook"]').dataset.selectedVideoId==='789'`)
    await click('เริ่มเปิดระบบดูดออเดอร์')
    await wait(
      `liveCfTest.requests.some(r=>r.url==='/api/live-cf/setup')&&liveCfTest.refreshes===1`,
    )
    const setup = await evaluate('liveCfTest.requests.find(r=>r.url==="/api/live-cf/setup").body')
    assert.equal(
      setup.livePostId,
      '789',
      'The picked video ID replaces the old manually entered scope',
    )
    assert.equal(setup.productId, await evaluate('liveCfTest.newProductId'))
    assert.equal(setup.matchMode, 'strict')
    assert.deepEqual(
      setup.codes,
      ['A1', '159', 'จอง', 'B2'],
      'Save includes all tags and any typed pending tag',
    )
    assert.equal(Object.hasOwn(setup, 'code'), false)
    assert.equal(setup.variantId, null)
    assert.equal(setup.customerSelectVariant, true)
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
    await call('Page.navigate', { url: address + '/?aliases=1' })
    await wait(
      `document.querySelectorAll('[aria-label="รหัสสั่งซื้อที่เพิ่มแล้ว"] button').length===3`,
    )
    await assertNoProductSelected()
    await click('หยุดชั่วคราว')
    assert.equal(await evaluate(`liveCfTest.requests.some(r=>r.url==='/api/live-cf/setup')`), false)
    assert.equal(
      await evaluate(`document.body.textContent.includes('กรุณาเลือกสินค้าก่อนเปลี่ยนสถานะระบบ')`),
      true,
    )
    for (const code of ['a1', '159', 'จอง'])
      assert.equal(
        await evaluate(`!!document.querySelector('button[aria-label="ลบรหัส ${code}"]')`),
        true,
      )
    assert.equal(
      await evaluate(`document.querySelector('input[name="matchMode"][value="flexible"]').checked`),
      true,
    )
    await fill('input[aria-label="ทดลองพิมพ์คอมเมนต์"]', 'เอา cf 159?')
    assert.equal(
      await evaluate(
        `document.querySelector('aside').textContent.includes('ระบบพร้อมสร้างออเดอร์')`,
      ),
      true,
    )
    await call('Page.navigate', { url: address + '/?payment=1' })
    await wait(`!!document.querySelector('select[aria-label="เลือกรูปแบบสินค้าเพื่อชำระเงิน"]')`)
    assert.equal(
      await evaluate(`document.body.textContent.includes('1234567890')`),
      false,
      'Bank details remain hidden until selection confirmation',
    )
    assert.equal(
      await evaluate(
        `document.querySelector('option[value="88888888-8888-4888-8888-888888888888"]').disabled`,
      ),
      true,
    )
    await fill(
      'select[aria-label="เลือกรูปแบบสินค้าเพื่อชำระเงิน"]',
      '99999999-9999-4999-8999-999999999999',
    )
    await evaluate('liveCfTest.failure=true')
    await click('ยืนยันตัวเลือกและดูข้อมูลชำระเงิน')
    await wait(`!!document.querySelector('[role="alert"]')`)
    assert.equal(await evaluate(`document.body.textContent.includes('1234567890')`), false)
    await evaluate('liveCfTest.failure=false')
    await evaluate(
      `(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('ยืนยันตัวเลือกและดูข้อมูลชำระเงิน'));button.click();button.click()})()`,
    )
    await wait(`document.body.textContent.includes('1234567890')`)
    assert.equal(await evaluate(`document.body.textContent.includes('259.00')`), true)
    assert.equal(
      await evaluate(
        `liveCfTest.requests.filter(r=>r.url==='/api/live-cf/payment-variant').length`,
      ),
      2,
    )
    assert.equal(
      await evaluate(
        `!!document.querySelector('select[aria-label="เลือกรูปแบบสินค้าเพื่อชำระเงิน"]')`,
      ),
      false,
    )
    for (const width of [375, 768, 1440]) {
      await resize(width)
      await pause()
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true)
      await screenshot('payment-' + width)
    }
    await call('Page.navigate', { url: address + '/?editing=1' })
    await wait('!!document.querySelector(' + JSON.stringify(productSelect) + ')')
    await assertNoProductSelected()
    await fill(productSelect, '33333333-3333-4333-8333-333333333333')
    await enterCode('CUSTOM')
    await fill(productSelect, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="รหัสสั่งซื้อที่เพิ่มแล้ว"]').textContent.trim()`,
      ),
      '01',
      'SKU takes precedence over code and replaces prior aliases',
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="ตัวอย่างคำสั่งซื้อ"]').textContent.includes('รับ 01')`,
      ),
      true,
    )
    await fill(productSelect, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    assert.equal(
      await evaluate(
        `document.querySelectorAll('[aria-label="รหัสสั่งซื้อที่เพิ่มแล้ว"] button').length`,
      ),
      0,
      'Products without a code leave keywords empty',
    )
    await fill(productSelect, '33333333-3333-4333-8333-333333333333')
    await evaluate('liveCfTest.detailFailure=true')
    await click('แก้ไขสินค้านี้')
    await wait(`document.querySelector('dialog')?.textContent.includes('ลองโหลดสินค้าใหม่')`)
    assert.equal(
      await evaluate(`document.querySelector('dialog button[type="submit"]').disabled`),
      true,
    )
    await evaluate('liveCfTest.detailFailure=false')
    await click('ลองโหลดสินค้าใหม่')
    await wait(`document.querySelector('dialog input[name="variant_stock_0"]')?.value==='3'`)
    assert.equal(
      await evaluate(`document.querySelector('dialog h2').textContent.trim()`),
      'แก้ไขข้อมูลสินค้า',
    )
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="cf_code"]').value`),
      '159',
    )
    assert.equal(
      await evaluate(`document.querySelector('dialog select[name="category_id"]').value`),
      '77777777-7777-4777-8777-777777777777',
    )
    assert.equal(
      await evaluate(`document.querySelector('dialog textarea[name="description"]').value`),
      'รายละเอียดเดิม',
    )
    assert.equal(await evaluate(`document.querySelectorAll('dialog img').length`), 2)
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="option_name_0"]').value`),
      'สี',
    )
    const fillEdit = async () => {
      await fill('dialog input[name="cf_code"]', 'EDIT1')
      await fill('dialog input[name="name"]', 'เสื้อยืดแก้ไขแล้ว')
      await fill('dialog input[name="price"]', '189.50')
      await fill('dialog input[name="variant_price_0"]', '219.50')
      await fill('dialog input[name="variant_stock_0"]', '4')
    }
    await fillEdit()
    await evaluate('liveCfTest.editStale=true')
    await click('บันทึกการแก้ไข')
    await wait(`document.querySelector('dialog')?.textContent.includes('โหลดข้อมูลสินค้าล่าสุด')`)
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="name"]').value`),
      'เสื้อยืดแก้ไขแล้ว',
    )
    await evaluate('liveCfTest.editStale=false')
    await click('โหลดข้อมูลสินค้าล่าสุด')
    await wait(`document.querySelector('dialog input[name="cf_code"]')?.value==='159'`)
    await fillEdit()
    for (const width of [375, 768, 1440]) {
      await resize(width)
      await pause()
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true)
      await screenshot('edit-modal-' + width)
    }
    await click('บันทึกการแก้ไข')
    await wait(`!document.querySelector('dialog')`)
    const edited = await evaluate(
      `liveCfTest.requests.filter(r=>r.url==='/api/commerce'&&r.body.id).at(-1).body`,
    )
    assert.equal(edited.id, '33333333-3333-4333-8333-333333333333')
    assert.equal(edited.version, 8, 'Reload uses the current version after a stock conflict')
    assert.equal(edited.value.cost, 65)
    assert.equal(edited.value.compare_price, 399)
    assert.equal(edited.value.featured, true)
    assert.equal(edited.value.stock, 9)
    assert.deepEqual(edited.value.images, [
      'https://storage.example/one.webp',
      'https://storage.example/two.webp',
    ])
    assert.deepEqual(
      edited.value.variants.map((v) => v.id),
      ['88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999'],
    )
    assert.deepEqual(
      edited.value.variants.map((v) => v.variant_code),
      ['WHITE', 'BLACK'],
    )
    assert.equal(await evaluate('liveCfTest.refreshes'), 0)
    assert.equal(
      await evaluate(
        `document.querySelector('aside').textContent.includes('เสื้อยืดแก้ไขแล้ว')&&document.querySelector('aside').textContent.includes('189.50')`,
      ),
      true,
    )
    assert.equal(
      await evaluate(
        `document.querySelectorAll('select[aria-label="สินค้าจากร้านค้า / เซลเพจ"] option[value="33333333-3333-4333-8333-333333333333"]').length`,
      ),
      1,
    )
    assert.equal(
      await evaluate(`document.querySelector('button[aria-label="ลบรหัส EDIT1"]')!==null`),
      true,
    )
    await fill(productSelect, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    await fill(productSelect, '33333333-3333-4333-8333-333333333333')
    assert.equal(
      await evaluate(`document.querySelector('button[aria-label="ลบรหัส EDIT1"]')!==null`),
      true,
      'Switching back uses the edited SKU',
    )
    await evaluate(`document.querySelector('button[aria-label="ลบรหัส EDIT1"]').click()`)
    await enterCode('CUSTOM')
    await click('แก้ไขสินค้านี้')
    await wait(
      `document.querySelector('dialog input[name="cf_code"]')?.value==='EDIT1'&&!document.querySelector('dialog button[type="submit"]').disabled`,
    )
    await fill('dialog input[name="name"]', 'สินค้าแก้ไขรอบสอง')
    await click('บันทึกการแก้ไข')
    await wait(`!document.querySelector('dialog')`)
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="รหัสสั่งซื้อที่เพิ่มแล้ว"]').textContent.trim()`,
      ),
      'CUSTOM',
      'Editing an unchanged SKU preserves manual aliases',
    )
    assert.equal(
      await evaluate(`document.querySelector('aside').textContent.includes('สินค้าแก้ไขรอบสอง')`),
      true,
    )
    assert.equal(await evaluate('liveCfTest.refreshes'), 0)
    // Reuse the exported modal without a parent key: product identity must own
    // its form state even when callers only change initialData.
    await call('Page.navigate', { url: address + '/?modal-isolation=1' })
    await wait(
      `document.querySelector('dialog input[name="variant_stock_0"]')?.value==='3'&&!document.querySelector('dialog button[type="submit"]').disabled`,
    )
    await fill('dialog input[name="variant_price_0"]', '111')
    await fill('dialog input[name="variant_stock_0"]', '1')
    await evaluate(`selectModalProduct('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`)
    await wait(
      `document.querySelector('dialog input[name="variant_price_0"]')?.value==='599'&&!document.querySelector('dialog button[type="submit"]').disabled`,
    )
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="variant_stock_0"]').value`),
      '6',
    )
    assert.equal(await evaluate(`document.querySelector('dialog input[name="stock"]').value`), '13')
    assert.equal(
      await evaluate(`document.querySelector('dialog').textContent.includes('น้ำเงิน')`),
      true,
    )
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="price"]').value`),
      '499',
    )
    await fill('dialog input[name="variant_price_0"]', '625')
    await fill('dialog input[name="variant_stock_0"]', '2')
    await click('บันทึกการแก้ไข')
    await wait(`liveCfTest.savedCallbacks.length===1`)
    const secondSave = await evaluate(
      `liveCfTest.requests.filter(r=>r.url==='/api/commerce').at(-1).body`,
    )
    assert.equal(secondSave.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    assert.deepEqual(
      secondSave.value.variants.map((v) => [v.id, v.price, v.stock]),
      [
        ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 625, 2],
        ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', 699, 7],
      ],
    )
    assert.equal(
      await evaluate(
        `liveCfTest.details['33333333-3333-4333-8333-333333333333'].variants[0].stock`,
      ),
      3,
    )
    await evaluate(`selectModalProduct('33333333-3333-4333-8333-333333333333')`)
    await wait(
      `document.querySelector('dialog input[name="variant_stock_0"]')?.value==='3'&&!document.querySelector('dialog button[type="submit"]').disabled`,
    )
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="variant_price_0"]').value`),
      '199',
    )
    // Edit -> create must clear all fields, refs, variants and overrides.
    await evaluate(`selectModalProduct(null)`)
    await wait(`document.querySelector('dialog h2')?.textContent==='เพิ่มสินค้า'`)
    assert.equal(
      await evaluate(`document.querySelectorAll('dialog input[name^="variant_price_"]').length`),
      0,
    )
    assert.equal(await evaluate(`document.querySelector('dialog input[name="price"]').value`), '')
    assert.equal(await evaluate(`document.querySelector('dialog input[name="stock"]').value`), '0')
    // A response arriving after switching products must not replace the new grid.
    await evaluate(
      `liveCfTest.detailDelays['33333333-3333-4333-8333-333333333333']=700;selectModalProduct('33333333-3333-4333-8333-333333333333')`,
    )
    await wait(`liveCfTest.requests.at(-1).url.includes('/api/commerce/')`)
    await evaluate(`selectModalProduct('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`)
    await wait(`document.querySelector('dialog input[name="variant_price_0"]')?.value==='625'`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="cf_code"]').value`),
      'SECOND',
    )
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="variant_stock_0"]').value`),
      '2',
    )
    // Changing tenants while creating must also start a fresh form.
    await evaluate(`selectModalProduct(null)`)
    await wait(`document.querySelector('dialog input[name="name"]')?.value===''`)
    await fill('dialog input[name="name"]', 'UNSAVED OTHER SHOP')
    await evaluate(`selectModalTenant('22222222-2222-4222-8222-222222222222')`)
    await wait(`document.querySelector('dialog input[name="name"]')?.value===''`)
    // A late save can commit only its captured product; it cannot fire onSaved
    // into the product opened next, even if transport ignores cancellation.
    await evaluate(
      `liveCfTest.detailDelays={};liveCfTest.saveDelay=700;selectModalProduct('33333333-3333-4333-8333-333333333333')`,
    )
    await wait(
      `document.querySelector('dialog input[name="variant_stock_0"]')?.value==='3'&&!document.querySelector('dialog button[type="submit"]').disabled`,
    )
    await click('บันทึกการแก้ไข')
    await evaluate(`selectModalProduct('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`)
    await wait(`document.querySelector('dialog input[name="variant_price_0"]')?.value==='625'`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.equal(await evaluate(`liveCfTest.savedCallbacks.length`), 1)
    assert.equal(
      await evaluate(`document.querySelector('dialog input[name="cf_code"]').value`),
      'SECOND',
    )
    assert.deepEqual(errors, [])
    console.log(
      'PASS: Product/tenant state isolation, per-product save payloads, late load/save fencing, minimal product modal, Live CF tags and customer variant confirmation at 375/768/1440px. Offline APIs only.',
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
