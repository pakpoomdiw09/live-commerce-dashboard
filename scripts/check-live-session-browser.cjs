const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const webpack = require('next/dist/compiled/webpack/webpack')

webpack.init()

async function checkInterface() {
  const allInOne = process.argv.includes('--all-in-one')
  const debugPort = allInOne ? 19479 : 19469
  const workspace = process.cwd()
  const output = path.join(
    workspace,
    allInOne ? '.tmp/all-in-one-auction-preview' : '.tmp/session-ui-preview',
  )
  fs.mkdirSync(output, { recursive: true })
  await new Promise((resolve, reject) =>
    webpack.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(workspace, 'scripts/fixtures/live-cf/session-entry.tsx'),
        output: { path: output, filename: 'bundle.js' },
        resolve: {
          extensions: ['.tsx', '.ts', '.js', '.json'],
          alias: {
            '@': workspace,
            'next/link$': path.join(workspace, 'scripts/fixtures/agent-overview/link.tsx'),
            'next/navigation$': path.join(
              workspace,
              'scripts/fixtures/design-system/navigation.ts',
            ),
            'next/image$': path.join(workspace, 'scripts/fixtures/design-system/image.tsx'),
          },
        },
        module: {
          rules: [
            {
              test: /\.tsx?$/,
              exclude: /node_modules/,
              use: path.join(workspace, 'scripts/inbox-browser-loader.cjs'),
            },
          ],
        },
      },
      (error, stats) =>
        error || stats.hasErrors()
          ? reject(error || new Error(stats.toString({ all: false, errors: true })))
          : resolve(),
    ),
  )

  const css = (
    await require('postcss')([require('@tailwindcss/postcss')({ base: workspace })]).process(
      fs.readFileSync('app/globals.css', 'utf8'),
      { from: path.join(workspace, 'app/globals.css') },
    )
  ).css
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:'development'}};</script><script src="/bundle.js"></script></body></html>`
  const server = http.createServer((request, response) => {
    if (request.url === '/' || request.url?.startsWith('/?')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(html)
      return
    }
    const files = {
      '/bundle.js': [path.join(output, 'bundle.js'), 'text/javascript'],
      '/logo-icon.png': [path.join(workspace, 'public/logo-icon.png'), 'image/png'],
    }
    const file = files[request.url]
    if (!file) {
      response.writeHead(404)
      response.end()
      return
    }
    response.setHeader('Content-Type', file[1])
    fs.createReadStream(file[0]).pipe(response)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const chrome =
    process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + debugPort,
      '--user-data-dir=' + path.join(output, 'chrome-profile'),
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  )
  let socket
  try {
    let target
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(
          (tab) => tab.type === 'page',
        )
      } catch {}
      if (target) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(target, 'Chrome debugging endpoint must be available')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = reject
    })
    const pending = new Map(),
      errors = []
    let sequence = 0
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown')
        errors.push(
          message.params.exceptionDetails.exception?.description ||
            message.params.exceptionDetails.text,
        )
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    }
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('Browser timeout: ' + method))
        }, 15000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description || result.exceptionDetails.text,
        )
      return result.result.value
    }
    const wait = async (expression) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await evaluate(expression)) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('UI condition timed out: ' + expression + '\n' + errors.join('\n'))
    }
    const resize = async (width) => {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1050,
        deviceScaleFactor: 1,
        mobile: width < 768,
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    await call('Runtime.enable')
    await call('Page.enable')
    await call('Emulation.setFocusEmulationEnabled', { enabled: true })
    await resize(1440)
    await call('Page.navigate', {
      url: 'http://127.0.0.1:' + server.address().port + (allInOne ? '/?all=1&empty=1' : '/'),
    })
    if (allInOne)
      await wait("!!document.querySelector('[data-auction-unified-form] [data-auction-zone]')")
    else {
      await wait(
        `document.querySelector('[aria-label="กำไรสุทธิของไลฟ์นี้"]')?.textContent === '325.00'`,
      )
    }
    const fill = async (selector, value) => {
      await evaluate(
        `(() => {const el=document.querySelector(${JSON.stringify(selector)});el.focus();Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`,
      )
    }
    const click = async (text) => {
      await evaluate(
        `[...document.querySelectorAll('button')].find(button=>button.textContent.includes(${JSON.stringify(text)})).click()`,
      )
    }
    if (allInOne) {
      await require('./helpers/check-unified-auction.cjs')({
        wait,
        evaluate,
        fill,
        click,
        call,
        resize,
        output,
        fs,
        assert,
        errors,
      })
      return
    }

    for (const width of [375, 768, 1024, 1440]) {
      await resize(width)
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true)
      if (allInOne) {
        const layout = await evaluate(
          "(() => {const l=document.querySelector('[data-session-customers]').getBoundingClientRect();const r=document.querySelector('[data-session-slips]').getBoundingClientRect();return {left:l.x,right:r.x,leftBottom:l.bottom,rightTop:r.top,leftWidth:l.width,rightWidth:r.width}})()",
        )
        if (width < 1280)
          assert.ok(
            layout.rightTop >= layout.leftBottom - 1 && Math.abs(layout.left - layout.right) < 2,
            'mobile/tablet stack the slip table after customers',
          )
        else
          assert.ok(
            layout.right > layout.left && layout.leftWidth > layout.rightWidth,
            'desktop uses a wider 7-column customer pane and a 5-column slip pane',
          )
      }
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })
      fs.writeFileSync(path.join(output, `session-${width}.png`), Buffer.from(shot.data, 'base64'))
    }
    await fill('input[aria-label="ต้นทุนสินค้า (บาท)"]', '100.05')
    await fill('input[aria-label="ค่าแอดโฆษณา (บาท)"]', '50.02')
    await fill('input[aria-label="ค่าจัดส่งจริง (บาท)"]', '20.03')
    await wait(
      `document.querySelector('[aria-label="กำไรสุทธิของไลฟ์นี้"]').textContent === '324.90'`,
    )
    await click('บันทึกค่าใช้จ่าย')
    await wait(`sessionQA.requests.at(-1)?.action === 'costs'`)
    assert.equal(await evaluate('sessionQA.requests.at(-1).cost'), '100.05')
    await evaluate(
      `document.querySelector('button[aria-label="ดูที่มาของยอด สมชาย ใจดี"]').click()`,
    )
    await wait(
      `document.querySelector('dialog')?.textContent.includes('260.00 + 410.00 + 2,400.00 + 50.00 = 3,120.00')`,
    )
    assert.equal(
      await evaluate(`document.querySelector('dialog').textContent.includes('22:45:39')`),
      true,
      'Bangkok comment time is visible',
    )
    await fill('input[aria-label="ยอดรายการ พระรายการ 1"]', '270')
    await fill('input[aria-label="ค่าส่งเฉพาะลูกค้า"]', '20')
    await fill('input[aria-label="เหตุผลการแก้ไขยอด"]', 'แก้ราคาที่ตรวจจากคอมเมนต์')
    await wait(`document.querySelector('dialog').textContent.includes('3,100.00')`)
    await evaluate('sessionQA.failAdjust=true')
    await click('บันทึกยอด')
    await wait(
      `document.querySelector('dialog [role=alert]')?.textContent.includes('ยอดเปลี่ยนแล้ว')`,
    )
    await click('โหลดบิลล่าสุด')
    await wait(`document.querySelector('input[aria-label="ยอดรายการ พระรายการ 1"]')?.value==='260'`)
    await evaluate('sessionQA.failAdjust=false')
    await fill('input[aria-label="ยอดรายการ พระรายการ 1"]', '270')
    await fill('input[aria-label="ค่าส่งเฉพาะลูกค้า"]', '20')
    await click('บันทึกยอด')
    await wait(`!document.querySelector('dialog')`)
    await wait(
      `document.querySelector('button[aria-label="ดูที่มาของยอด สมชาย ใจดี"]').textContent.includes('3,100.00')`,
    )
    assert.equal(await evaluate('sessionQA.requests.at(-1).items[0].amount'), 270)
    await evaluate(`document.querySelector('input[aria-label="เลือกลูกค้า สมชาย ใจดี"]').click()`)
    await click(allInOne ? 'ตามยอด' : 'ตามยอด / แจ้งยอด')
    await wait(`document.querySelector('dialog input[value=selected]')?.checked === true`)
    assert.equal(await evaluate('document.querySelectorAll("dialog tbody tr").length'), 1)
    await fill(
      'textarea[aria-label="ข้อความตามยอดค้างชำระ"]',
      'สวัสดี {name} โอนเพิ่ม {short} บาท / {due}',
    )
    await evaluate(`document.querySelector('dialog details').open=true`)
    await wait(`document.querySelector('dialog pre').textContent.includes('2,900.00')`)
    assert.equal(
      await evaluate(`document.querySelector('dialog pre').textContent.includes('9260337828')`),
      true,
    )
    await click('ส่งแจ้งยอด')
    await wait(`!document.querySelector('dialog')`)
    assert.deepEqual(await evaluate('sessionQA.requests.at(-1).tabIds'), [
      '33333333-3333-4333-8333-333333333333',
    ])
    await click(allInOne ? 'ตามยอด' : 'ตามยอด / แจ้งยอด')
    await wait(`!!document.querySelector('dialog input[value=all]')`)
    await evaluate(`document.querySelector('dialog input[value=all]').click()`)
    await wait(`document.querySelectorAll('dialog tbody tr').length===2`)
    for (const width of [375, 768, 1024]) {
      await resize(width)
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true)
      assert.equal(
        await evaluate(
          "document.querySelector('dialog').getBoundingClientRect().width<=innerWidth",
        ),
        true,
      )
      const shot = await call('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(
        path.join(output, `session-followup-${width}.png`),
        Buffer.from(shot.data, 'base64'),
      )
    }
    await click('ส่งแจ้งยอด')
    await wait(`!document.querySelector('dialog')`)
    assert.equal(await evaluate('sessionQA.requests.at(-1).tabIds'), null)
    await click('กำหนดผู้ชนะ')
    await wait(`!document.querySelector('select[aria-label="เลือกผู้ชนะใหม่"]')?.disabled`)
    await fill('input[aria-label="ค้นหาผู้เสนอราคา"]', 'เอก')
    await wait(`!document.querySelector('select[aria-label="เลือกผู้ชนะใหม่"]').disabled`)
    await fill('select[aria-label="เลือกผู้ชนะใหม่"]', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    await wait(`document.querySelector('dialog').textContent.includes('ชนะที่ราคา ฿240.00')`)
    await click('บันทึกผู้ชนะใหม่')
    await wait(`!document.querySelector('dialog')`)
    assert.equal(await evaluate('sessionQA.requests.at(-1).action'), 'winner')
    assert.equal(
      await evaluate('sessionQA.requests.at(-1).bidId'),
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    )
    await evaluate(
      `document.querySelector('button[aria-label="ดูที่มาของยอด เอก ผู้สะสม"]').click()`,
    )
    await wait(`!!document.querySelector('input[aria-label="เหตุผลการแก้ไขยอด"]')`)
    await fill('input[aria-label="เหตุผลการแก้ไขยอด"]', 'ยกเลิกรายการตามที่ตรวจสอบ')
    await click('ลบยอด')
    await wait(`!document.querySelector('dialog')`)
    assert.equal(
      await evaluate('sessionQA.requests.at(-1).items.every(item=>item.cancelled)'),
      true,
    )
    assert.deepEqual(errors, [])
    console.log(
      'PASS: Session metrics/profit, responsive tables, proof adjustments/conflicts, winner selection and selected/all reminder previews; no real external calls.',
    )
  } finally {
    socket?.close()
    browser.kill()
    await new Promise((resolve) => server.close(resolve))
  }
}
checkInterface().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
