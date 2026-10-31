// Real QR UI in Chrome/Strict Mode. No environment secrets, Supabase or real payment services.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process')
const w = require('next/dist/compiled/webpack/webpack')
w.init()
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-payment-ui-')),
    cwd = process.cwd(),
    mock = path.join(cwd, 'scripts/fixtures/payment-codes/mocks.tsx'),
    payload = require('promptpay-qr')('0812345678', { amount: 125 })
  await new Promise((resolve, reject) =>
    w.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(cwd, 'scripts/fixtures/payment-codes/entry.tsx'),
        output: { path: root, filename: 'bundle.js' },
        resolve: {
          extensions: ['.tsx', '.ts', '.js', '.json'],
          alias: {
            '@/lib/supabase/browser$': mock,
            'next/link$': mock,
            'next/navigation$': mock,
            'next/image$': path.join(cwd, 'scripts/fixtures/payment-codes/bank-qr-image.tsx'),
            '@': cwd,
          },
        },
        plugins: [
          new w.webpack.DefinePlugin({ __PAYMENT_QR_FIXTURE__: JSON.stringify(payload) }),
          new w.webpack.NormalModuleReplacementPlugin(/PaymentChannelStatus$/, mock),
        ],
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
    `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:"development"}};</script><script src="bundle.js"></script></body></html>`,
  )
  const svg = require('react-dom/server').renderToStaticMarkup(
      require('react').createElement(require('qrcode.react').QRCodeSVG, {
        value: payload,
        size: 640,
        marginSize: 4,
      }),
    ),
    upload = path.join(root, 'test-only-qr.png')
  await require('sharp')(Buffer.from(svg)).png().toFile(upload)
  const port = 19464,
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
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = reject
    })
    let next = 0
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
        const id = ++next,
          timer = setTimeout(() => reject(Error('CDP timeout ' + method)), 15000)
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
      const r = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails)
        throw Error(r.exceptionDetails.exception?.description || 'Browser expression failed')
      return r.result.value
    }
    const pause = () => new Promise((r) => setTimeout(r, 200)),
      wait = async (expression) => {
        for (let i = 0; i < 60; i++) {
          if (await evaluate(expression)) return
          await pause()
        }
        throw Error(
          'Browser wait: ' +
            expression +
            ' ' +
            JSON.stringify(errors) +
            ' ' +
            (await evaluate('document.body.textContent.slice(0,1500)')),
        )
      }
    await call('Runtime.enable')
    await call('Page.enable')
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await call('Page.navigate', {
      url: require('node:url').pathToFileURL(path.join(root, 'index.html')).href + '#designer',
    })

    const openAccount = async (index = 0) => {
      await wait(
        `[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('ดู / แก้ไขบัญชี')).length>=2`,
      )
      await evaluate(
        `[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('ดู / แก้ไขบัญชี'))[${index}].click()`,
      )
      await wait(
        `!!document.querySelector('#slip-tab-panel input[type=file]')&&!document.querySelector('#slip-tab-panel input[type=file]').disabled&&!document.querySelector('#slip-tab-panel input[type=file]').closest('fieldset').disabled`,
      )
      await pause()
    }
    const closeAccount = async () => {
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='ยกเลิก').click()`,
      )
      await pause()
    }
    await wait(
      `document.body.textContent.includes('ร้านทดสอบ กรุงไทย')&&document.body.textContent.includes('ร้านทดสอบ กสิกรไทย')`,
    )
    assert.equal(
      await evaluate('document.querySelectorAll("#slip-tab-panel input[type=file]").length'),
      0,
    )
    assert.equal(
      await evaluate(`document.body.textContent.includes('QR Code บัญชีรับเงินของร้าน')`),
      false,
    )
    await openAccount()
    assert.equal(await evaluate('document.querySelectorAll("[role=tab]").length'), 4)
    assert.equal(await evaluate('document.querySelectorAll("#slip-tab-panel canvas").length'), 0)
    for (const oldText of [
      'QR ของร้าน 100 รายการล่าสุด',
      'ตัวอย่าง QR ที่บันทึก',
      'ตกแต่ง QR รับเงิน',
      'ไม่ระบุยอดเงิน',
    ])
      assert.equal(
        await evaluate(
          `document.querySelector('#slip-tab-panel').textContent.includes(${JSON.stringify(oldText)})`,
        ),
        false,
      )
    const doc = await call('DOM.getDocument'),
      node = await call('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: '#slip-tab-panel input[type=file]',
      })
    await call('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [upload] })
    await pause()
    assert.equal(
      await evaluate('document.querySelectorAll("#slip-tab-panel img[alt*=QR]").length'),
      1,
    )
    await evaluate(
      `const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='บันทึกข้อมูลและ QR');b.click();b.click();b.click()`,
    )
    await wait(`document.body.textContent.includes('บันทึกบัญชีรับเงินแล้ว')`)
    assert.equal(await evaluate('paymentTest.metrics.bankQrSaves'), 1)
    assert.equal(await evaluate('paymentTest.metrics.designSaves'), 0)
    await openAccount(1)
    assert.equal(
      await evaluate('document.querySelectorAll("#slip-tab-panel img[alt*=QR]").length'),
      0,
    )
    const secondDoc = await call('DOM.getDocument')
    const secondNode = await call('DOM.querySelector', {
      nodeId: secondDoc.root.nodeId,
      selector: '#slip-tab-panel input[type=file]',
    })
    await call('DOM.setFileInputFiles', { nodeId: secondNode.nodeId, files: [upload] })
    await pause()
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent==='บันทึกข้อมูลและ QR').click()`,
    )
    await wait(`document.body.textContent.includes('บันทึกบัญชีรับเงินแล้ว')`)
    assert.equal(await evaluate('paymentTest.metrics.bankQrSaves'), 2)
    assert.equal(
      await evaluate(
        `JSON.parse(localStorage.getItem('bank-qr-upload:11111111-1111-4111-8111-111111111111')).version`,
      ),
      1,
    )
    assert.equal(
      await evaluate(
        `JSON.parse(localStorage.getItem('bank-qr-upload:22222222-2222-4222-8222-222222222222')).version`,
      ),
      1,
    )
    await call('Page.reload')
    await openAccount()
    await wait(`document.querySelector('img[alt="QR Code ประจำบัญชีที่บันทึกไว้"]')?.complete`)
    assert.equal(
      await evaluate('document.querySelectorAll("#slip-tab-panel img[alt*=QR]").length'),
      1,
    )
    await evaluate(
      `(()=>{const zone=document.querySelector('#slip-tab-panel input[type=file]').closest('div');const transfer=new DataTransfer();transfer.items.add(new File(['bad'],'bad.svg',{type:'image/svg+xml'}));zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))})()`,
    )
    await wait(`document.body.textContent.includes('เลือกรูป PNG/JPG')`)
    await evaluate(
      `(()=>{const bytes=Uint8Array.from(atob(localStorage.getItem('bank-qr-upload-image:11111111-1111-4111-8111-111111111111').split(',')[1]),c=>c.charCodeAt(0));const zone=document.querySelector('#slip-tab-panel input[type=file]').closest('div');const transfer=new DataTransfer();transfer.items.add(new File([bytes],'dropped.png',{type:'image/png'}));zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))})()`,
    )
    await wait(`!!document.querySelector('img[alt="รูป QR ที่เลือก รอยืนยันการบันทึก"]')`)
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent==='บันทึกข้อมูลและ QR').click()`,
    )
    await wait(`document.body.textContent.includes('บันทึกบัญชีรับเงินแล้ว')`)
    await openAccount()
    fs.mkdirSync('docs/screenshots', { recursive: true })
    for (const width of [375, 768, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1200,
        deviceScaleFactor: 1,
        mobile: width < 768,
      })
      await pause()
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'))
      assert.ok(
        await evaluate(
          "document.querySelector('#slip-tab-panel form').getBoundingClientRect().width<=672",
        ),
      )
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      fs.writeFileSync(
        'docs/screenshots/bank-qr-upload-' + width + '.png',
        Buffer.from(shot.data, 'base64'),
      )
      for (const tab of ['history', 'automation', 'security', 'banks']) {
        await evaluate(`document.querySelector('#slip-tab-` + tab + `').click()`)
        await pause()
        assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'))
      }
      await openAccount()
    }
    await call('Page.navigate', {
      url: require('node:url').pathToFileURL(path.join(root, 'index.html')).href + '#banks',
    })
    await call('Page.reload')
    await openAccount()
    await wait(`document.querySelector('img[alt="QR Code ประจำบัญชีที่บันทึกไว้"]')?.complete`)
    assert.equal(await evaluate('document.querySelectorAll("#slip-tab-panel canvas").length'), 0)
    await closeAccount()
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('เพิ่มบัญชีรับเงิน')).click()",
    )
    await wait("!!document.querySelector('#slip-tab-panel form input[type=file]')")
    assert.equal(
      await evaluate(
        "document.querySelector('#slip-tab-panel form').textContent.includes('QR Code รับเงิน')",
      ),
      true,
    )
    await evaluate(
      "window.fillBank=(suffix,value)=>{const n=document.querySelector('form input[id$='+suffix+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}))};fillBank('-name','บัญชีใหม่พร้อม QR')",
    )
    await pause()
    await evaluate("fillBank('-number','5555555555')")
    await pause()
    const addDoc = await call('DOM.getDocument')
    const addNode = await call('DOM.querySelector', {
      nodeId: addDoc.root.nodeId,
      selector: '#slip-tab-panel input[type=file]',
    })
    const beforeCreate = await evaluate('paymentTest.metrics.bankQrSaves')
    await call('DOM.setFileInputFiles', { nodeId: addNode.nodeId, files: [upload] })
    await pause()
    assert.equal(await evaluate('paymentTest.metrics.bankQrSaves'), beforeCreate)
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent==='บันทึกข้อมูลและ QR').click()",
    )
    await wait(
      "!document.querySelector('#slip-tab-panel form')&&document.body.textContent.includes('บัญชีใหม่พร้อม QR')",
    )
    assert.equal(await evaluate('paymentTest.metrics.bankQrSaves'), beforeCreate + 1)
    assert.equal(
      await evaluate("document.querySelectorAll('#slip-tab-panel input[type=file]').length"),
      0,
    )
    assert.deepEqual(errors, [])
    console.log(
      'PASS: Chrome/Strict Mode: compact combined create/edit form, immediate QR attachment for new accounts, single submit, isolated images, reload, drag/drop, 375/768/1440 without overflow.',
    )
  } finally {
    socket?.close()
    browser.kill()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
