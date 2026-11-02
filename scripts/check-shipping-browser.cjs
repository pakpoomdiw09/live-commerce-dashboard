const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const webpack = require('next/dist/compiled/webpack/webpack')

webpack.init()

async function checkInterface() {
  const workspace = process.cwd()
  const output = path.join(workspace, '.tmp/shipping-ui-preview')
  fs.mkdirSync(output, { recursive: true })
  await new Promise((resolve, reject) =>
    webpack.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(workspace, 'scripts/fixtures/live-cf/shipping-entry.tsx'),
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
    if (request.url === '/' || request.url.startsWith('/shipping/print/')) {
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
      '--remote-debugging-port=19470',
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
        target = (await (await fetch('http://127.0.0.1:19470/json/list')).json()).find(
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
      }).catch((error) => {
        throw new Error(expression + '\n' + error.message)
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
    await call('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: path.join(output, 'downloads'),
    })
    const origin = 'http://127.0.0.1:' + server.address().port
    await resize(1440)
    await call('Page.navigate', { url: origin + '/' })
    const fill = async (selector, value) => {
      await evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`,
      )
    }
    const click = async (text) => {
      await evaluate(
        `[...document.querySelectorAll('button')].find(button=>button.textContent.includes(${JSON.stringify(text)})).click()`,
      )
    }
    await wait(`document.querySelectorAll('tbody tr').length===6`)
    for (const width of [375, 768, 1024, 1440]) {
      await resize(width)
      assert.equal(
        await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),
        true,
        'dashboard fits ' + width,
      )
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })
      fs.writeFileSync(path.join(output, `shipping-${width}.png`), Buffer.from(shot.data, 'base64'))
    }
    await fill('select[aria-label="สถานะการจัดส่ง"]', 'pending_address')
    await wait(`document.querySelectorAll('tbody tr').length===1`)
    await click('แก้ไขผู้รับ')
    await wait(`!!document.querySelector('dialog input[aria-label="ชื่อผู้รับ"]')`)
    await fill('input[aria-label="ชื่อผู้รับ"]', 'มานี ใจดี')
    await fill('input[aria-label="เบอร์โทรศัพท์ผู้รับ"]', '0821234567')
    await fill(
      'textarea[aria-label="ที่อยู่จัดส่งฉบับเต็ม"]',
      '100/2 ตำบลบางรัก อำเภอเมือง จังหวัดนนทบุรี 11000',
    )
    await evaluate(
      `document.querySelector('input[aria-label="ตรวจสอบที่อยู่ถูกต้องแล้ว"]').click()`,
    )
    await click('บันทึกข้อมูลผู้รับ')
    await wait(`!document.querySelector('dialog')`)
    assert.equal(await evaluate('shippingQA.requests.at(-1).address.phone_number'), '0821234567')
    assert.equal(await evaluate('shippingQA.requests.at(-1).confirmed'), true)
    await fill('select[aria-label="สถานะการจัดส่ง"]', 'all')
    await wait(`document.querySelectorAll('tbody tr').length===6`)
    await click('ตั้งค่าผู้ส่ง')
    await wait(`!!document.querySelector('dialog')`)
    assert.equal(
      await evaluate(
        `document.querySelector('input[aria-label="Bee Move API Key ในอนาคต"]').disabled`,
      ),
      true,
    )
    await click('ยกเลิก')
    await evaluate(
      `document.querySelector('input[aria-label="เลือกพัสดุ ลูกค้า Facebook 1"]').click()`,
    )
    await click('ส่งผ่าน Bee Move')
    await wait(`document.querySelector('dialog')?.textContent.includes('ยังไม่เรียก API')`)
    await click('ดาวน์โหลด CSV')
    await wait(`shippingQA.csvText.includes('0812345678')`)
    assert.equal(await evaluate('shippingQA.requests.at(-1).ids.length'), 1)
    assert.equal(await evaluate(`shippingQA.csvText.includes('ยอดเก็บเงินปลายทาง COD')`), true)
    await evaluate(`document.querySelector('dialog button[aria-label="ปิดหน้าต่าง"]').click()`)
    await click('พิมพ์สติกเกอร์')
    await wait(`shippingQA.opened.includes('/shipping/print/')`)
    assert.equal(await evaluate('shippingQA.requests.at(-1).format'), 'thermal')
    await fill('input[aria-label="Tracking ลูกค้า Facebook 1"]', 'TH123456789')
    await click('บันทึกเลขพัสดุ')
    await wait(`shippingQA.requests.at(-1)?.tracking==='TH123456789'`)
    await click('อัปเดตเป็นส่งพัสดุแล้ว')
    await wait(`shippingQA.requests.at(-1)?.action==='dispatch'`)
    await wait(`shippingQA.shipments[0].fulfillment_status==='shipped'`)
    for (const format of ['thermal', 'a4']) {
      await call('Page.navigate', { url: origin + '/shipping/print/test?format=' + format })
      await wait(`document.querySelectorAll('.shipping-label').length===5`)
      await evaluate('document.fonts.ready.then(()=>true)')
      assert.equal(
        await evaluate(`document.querySelectorAll('.shipping-sheet').length`),
        format === 'a4' ? 2 : 5,
      )
      assert.equal(
        await evaluate(
          `[...document.querySelectorAll('.shipping-label')].every(label=>label.scrollHeight<=label.clientHeight+2)`,
        ),
        true,
        'labels do not clip in ' + format,
      )
      assert.equal(
        await evaluate('shippingQA.readQr()'),
        'SNAPBOT-PARCEL:22222222-2222-4222-8222-222222222220',
      )
      await evaluate('shippingQA.failPrint=true')
      await click('พิมพ์ / บันทึก PDF')
      await wait(`document.querySelector('[role=alert]')?.textContent.includes('ที่อยู่เปลี่ยน')`)
      assert.equal(await evaluate('shippingQA.prints'), 0, 'stale batch cannot print')
      await evaluate('shippingQA.failPrint=false')
      await click('พิมพ์ / บันทึก PDF')
      await wait(`shippingQA.prints===1 && !!document.querySelector('.print-authorized')`)
      assert.equal(await evaluate('shippingQA.requests.at(-1).action'), 'mark_print')
      const pdf = await call('Page.printToPDF', {
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      })
      const bytes = Buffer.from(pdf.data, 'base64'),
        text = bytes.toString('latin1')
      const pageCount = (text.match(/\/Type\s*\/Page\b/g) || []).length
      const box = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/)
      assert.equal(pageCount, format === 'a4' ? 2 : 5, 'correct PDF page count for ' + format)
      assert.ok(box, 'PDF MediaBox exists')
      const expected = format === 'a4' ? [595.28, 841.89] : [283.46, 425.2]
      assert.ok(
        Math.abs(Number(box[1]) - expected[0]) < 2 && Math.abs(Number(box[2]) - expected[1]) < 2,
        'PDF paper dimensions match ' + format,
      )
      fs.writeFileSync(
        path.join(output, format === 'a4' ? 'shipping-A4-four-up.pdf' : 'shipping-100x150mm.pdf'),
        bytes,
      )
      console.log(format + ': ' + pageCount + ' pages, ' + box[1] + ' x ' + box[2] + ' pt')
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })
      fs.writeFileSync(path.join(output, `print-${format}.png`), Buffer.from(shot.data, 'base64'))
    }
    assert.deepEqual(errors, [])
    console.log(
      'PASS: Shipping dashboard, address edits, tracking, CSV and real Chromium PDFs (100x150 mm / A4 four-up), QR decoding, no clipping and stale-print guard. No real courier/Messenger calls.',
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
