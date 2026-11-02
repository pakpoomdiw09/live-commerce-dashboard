const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const webpack = require('next/dist/compiled/webpack/webpack')

webpack.init()

async function checkInterface() {
  const workspace = process.cwd()
  const output = path.join(workspace, '.tmp/auction-ui-preview')
  fs.mkdirSync(output, { recursive: true })
  await new Promise((resolve, reject) =>
    webpack.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(workspace, 'scripts/fixtures/live-cf/auction-entry.tsx'),
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
    if (request.url === '/') {
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
      '--remote-debugging-port=19468',
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
        target = (await (await fetch('http://127.0.0.1:19468/json/list')).json()).find(
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
    await resize(1440)
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` })

    await wait("window.auctionQA && document.querySelector('#live-mode-auction') !== null")
    assert.equal(
      await evaluate("document.querySelector('#live-mode-cf').getAttribute('aria-selected')"),
      'true',
    )
    assert.equal(await evaluate('window.auctionQA.reads'), 0, 'hidden auction tab does not poll')
    await evaluate("document.querySelector('#live-mode-auction').click()")
    await wait(
      "document.querySelector('[data-auction-leader]')?.textContent.includes(window.auctionQA.auctions[0].leading_bidder_name)",
    )
    assert.equal(
      await evaluate("document.querySelector('#live-mode-auction').getAttribute('aria-selected')"),
      'true',
    )
    assert.equal(await evaluate("new URL(location.href).searchParams.get('mode')"), 'auction')
    assert.equal(await evaluate("document.querySelector('#live-panel-cf').hidden"), true)
    assert.ok(
      await evaluate('document.querySelector(\'input[maxlength="200"]\') !== null'),
      'opening form is visible on entry',
    )
    assert.deepEqual(
      await evaluate("[...document.querySelectorAll('input[type=number]')].map(i=>i.value)"),
      ['200', '20', '50'],
    )
    await wait(`document.querySelector('select[aria-label="ไลฟ์สด Facebook"]')?.value === '456'`)
    assert.equal(
      await evaluate(
        `document.querySelector('input[placeholder^="https://www.facebook.com"]') === null`,
      ),
      true,
    )
    assert.equal(
      await evaluate(
        `document.querySelector('select[aria-label="เลือกเพจ Facebook"]').selectedOptions[0].textContent`,
      ),
      'ดิว ไลฟ์สดพระเครื่อง',
    )
    await evaluate(`(() => {
      const editor=document.querySelector('textarea[aria-label="ข้อความสรุปยอดผู้ชนะประมูล"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,'Winner: ');
      editor.dispatchEvent(new Event('input',{bubbles:true}));
    })()`)
    await wait(
      `document.querySelector('textarea[aria-label="ข้อความสรุปยอดผู้ชนะประมูล"]').value === 'Winner: '`,
    )
    await evaluate(`(() => {
      const editor=document.querySelector('textarea[aria-label="ข้อความสรุปยอดผู้ชนะประมูล"]');
      editor.focus();editor.setSelectionRange(8,8);
      editor.parentElement.querySelector('button[title="ใส่ชื่อสินค้าในข้อความ"]').click();
    })()`)
    await wait(
      `document.querySelector('textarea[aria-label="ข้อความสรุปยอดผู้ชนะประมูล"]').value === 'Winner: {ชื่อสินค้า}'`,
    )
    await evaluate(
      `document.querySelector('[role=switch][aria-label="ตอบกลับใต้คอมเมนต์ประมูล"]').click()`,
    )
    await wait(`!document.querySelector('textarea[aria-label="ข้อความยืนยันผู้นำประมูล"]')`)
    await evaluate(
      `document.querySelector('[role=switch][aria-label="ตอบกลับใต้คอมเมนต์ประมูล"]').click()`,
    )
    await wait(`!!document.querySelector('textarea[aria-label="ข้อความประกาศผู้ชนะประมูล"]')`)
    for (const width of [375, 768, 1440]) {
      await resize(width)
      assert.ok(
        await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
        'Setup form fits ' + width,
      )
      const screenshot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })
      fs.writeFileSync(
        path.join(output, 'auction-setup-' + width + '.png'),
        Buffer.from(screenshot.data, 'base64'),
      )
    }
    assert.ok(
      await evaluate(
        "document.querySelector('section[data-auction-panel]').getBoundingClientRect().height > 400",
      ),
      'auction controls cannot collapse inside the fixed dashboard flex layout',
    )
    const flexRegression = await evaluate(`(() => {
      const frame=document.createElement('div');frame.style.cssText='position:fixed;visibility:hidden;display:flex;flex-direction:column;width:600px;height:400px';
      const content=document.createElement('div');content.style.cssText='display:flex;flex:1;min-height:0;flex-direction:column';
      const panel=document.querySelector('section[data-auction-panel]').cloneNode(true);panel.style.flexShrink='1';
      const cf=document.createElement('div');cf.style.cssText='height:1800px;flex-shrink:0';
      content.append(panel,cf);frame.append(content);document.body.append(frame);
      const before=panel.getBoundingClientRect().height;panel.style.flexShrink='0';const after=panel.getBoundingClientRect().height;frame.remove();return {before,after};
    })()`)
    assert.ok(
      flexRegression.before < 1 && flexRegression.after > 400,
      'reproduce the original flex collapse and verify its fix',
    )
    // Hide the form to inspect the leader, count and history at each viewport size.
    await evaluate("document.querySelector('section[data-auction-panel] header button').click()")
    for (const width of [375, 768, 1440]) {
      await resize(width)
      assert.ok(
        await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
        'No horizontal page overflow at ' + width,
      )
      assert.ok(
        await evaluate(
          "document.querySelector('[data-live-cf-workspace]').getBoundingClientRect().height > 400",
        ),
        'dashboard content stays expanded at ' + width,
      )
      const screenshot = await call('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(
        path.join(output, 'auction-' + width + '.png'),
        Buffer.from(screenshot.data, 'base64'),
      )
    }
    await evaluate(
      "window.auctionQA.auctions[0].current_price = 220; window.auctionQA.auctions[0].leading_bidder_name = 'New bidder'",
    )
    await wait(
      "document.querySelector('[data-auction-price]')?.textContent.includes('220') && document.querySelector('[data-auction-leader]')?.textContent.includes('New bidder')",
    )
    for (const count of ['3', '2', '1']) {
      await evaluate(`document.querySelector('[data-auction-action="${count}"]').click()`)
      await wait(`document.querySelector('[data-auction-count]')?.textContent === '${count}'`)
      assert.equal(await evaluate('window.auctionQA.requests.at(-1).body.action'), count)
      assert.ok(await evaluate(`document.querySelector('table').textContent.includes('${count}')`))
    }
    await evaluate('window.auctionQA.loadFailure = true')
    await wait(
      "document.querySelector('[role=alert]')?.textContent.includes('temporarily unavailable')",
    )
    assert.ok(
      await evaluate(
        "document.querySelector('#live-mode-auction') !== null && !document.querySelector('#live-panel-auction').hidden",
      ),
      'API errors never hide the auction tab',
    )
    await evaluate('window.auctionQA.loadFailure = false')
    await wait("document.querySelector('[role=alert]') === null")
    await evaluate("document.querySelector('#live-mode-cf').click()")
    await new Promise((resolve) => setTimeout(resolve, 100))
    const inactiveReads = await evaluate('window.auctionQA.reads')
    await new Promise((resolve) => setTimeout(resolve, 3200))
    assert.equal(
      await evaluate('window.auctionQA.reads'),
      inactiveReads,
      'switching to CF stops auction polling',
    )
    assert.equal(await evaluate("document.querySelector('#live-panel-cf').hidden"), false)
    await evaluate("document.querySelector('#live-mode-auction').click()")
    await evaluate("document.querySelector('section[data-auction-panel] header button').click()")
    await wait('document.querySelector(\'input[maxlength="200"]\') !== null')
    await evaluate(`(() => {
      const fields=document.querySelectorAll('form input:not([type=number])');
      const set=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
      set(fields[0],window.auctionQA.auctions[0].item_name+' QA');
    })()`)
    await evaluate("document.querySelector('form').requestSubmit()")
    await wait(
      'window.auctionQA.requests.length > 0 && document.querySelector(\'input[maxlength="200"]\') === null',
    )
    assert.equal(await evaluate('window.auctionQA.requests.at(-1).body.startPrice'), 200)
    assert.equal(await evaluate('window.auctionQA.requests.at(-1).body.minStep'), 20)
    assert.equal(await evaluate('window.auctionQA.requests.at(-1).body.pageId'), '100')
    assert.equal(await evaluate('window.auctionQA.requests.at(-1).body.livePostId'), '456')
    assert.equal(await evaluate('window.auctionQA.requests.at(-1).body.privateReply'), true)
    assert.equal(await evaluate('window.auctionQA.requests.at(-1).body.publicReply'), true)
    assert.equal(
      await evaluate('window.auctionQA.requests.at(-1).body.privateText'),
      'Winner: {ชื่อสินค้า}',
    )
    await evaluate("document.querySelector('[data-auction-action=close]').click()")
    await wait("document.querySelector('[data-auction-action=close]') === null")
    assert.equal(
      await evaluate("document.querySelector('[data-auction-action=close]') === null"),
      true,
    )
    await evaluate(
      `(() => {const input=document.querySelector('input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([255,216,255,224])],'slip.jpg',{type:'image/jpeg'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));input.closest('form').requestSubmit()})()`,
    )
    await wait("document.querySelector('input[type=file]') === null")
    await wait(
      "document.querySelector('[aria-label=\"บิลสะสมและยอดคงเหลือ\"]')?.textContent.includes('800.00')",
    )
    await evaluate(
      'window.auctionQA.customerTabs[0].paid_amount=500; window.auctionQA.customerTabs[0].remaining_amount=500',
    )
    await wait(
      "document.querySelector('[aria-label=\"บิลสะสมและยอดคงเหลือ\"]')?.textContent.includes('500.00') && !document.querySelector('[aria-label=\"บิลสะสมและยอดคงเหลือ\"]')?.textContent.includes('800.00')",
    )
    await evaluate(
      "document.querySelector('[data-customer-tab-fixture]').scrollIntoView();document.querySelector('[data-customer-tab-fixture] article button').click()",
    )
    await wait("window.auctionQA.selectedSlipId === 'verified-slip'")
    await evaluate(
      "document.querySelector('[data-customer-tab-fixture] article button.bg-orange-500').click()",
    )
    await wait("window.auctionQA.requests.at(-1)?.path === '/api/messages/send'")
    assert.ok(
      await evaluate(
        "window.auctionQA.requests.at(-1).body.text.includes('1,000.00') && window.auctionQA.requests.at(-1).body.text.includes('500.00')",
      ),
      'manual bill summary uses the current total and net balance',
    )
    await evaluate(
      `[...document.querySelectorAll('[data-customer-tab-fixture] button')].find(button=>button.textContent.includes('ส่งข้อความทวงยอด')).click()`,
    )
    await wait(`window.auctionQA.requests.at(-1)?.body.action === 'remind'`)
    const billScreenshot = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(
      path.join(output, 'customer-tabs.png'),
      Buffer.from(billScreenshot.data, 'base64'),
    )
    assert.deepEqual(errors, [])
    console.log(
      'PASS: CF/auction tabs, visible opening form, 375/768/1440px layouts, polled leader updates, 3/2/1/close shortcuts, API error visibility, inactive polling, numeric payload and slip form; no browser exceptions.',
    )
    console.log('Screenshots: .tmp/auction-ui-preview/')
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
