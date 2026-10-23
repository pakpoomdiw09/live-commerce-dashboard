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

    await wait(
      `[...document.querySelectorAll('button')].some(b=>b.textContent==='ตกแต่ง QR / อัปเดตรูป')`,
    )
    await evaluate(
      `window.confirm=()=>true;window.fill=(selector,value)=>{const n=document.querySelector(selector);Object.getOwnPropertyDescriptor(n instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event(n instanceof HTMLSelectElement?'change':'input',{bubbles:true}))};[...document.querySelectorAll('button')].find(b=>b.textContent==='ตกแต่ง QR / อัปเดตรูป').click()`,
    )
    await wait(
      `!!document.querySelector('aside canvas')&&!document.querySelector('aside fieldset').disabled`,
    )
    assert.equal(await evaluate('document.querySelectorAll("[role=tab]").length'), 4)
    for (let i = 0; i < 5; i++) {
      await evaluate(`fill('aside select','` + i + `')`)
      await pause()
      const png = Buffer.from(
          (await evaluate('document.querySelector("aside canvas[aria-label]").toDataURL()')).split(
            ',',
          )[1],
          'base64',
        ),
        raw = await require('sharp')(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      assert.equal(
        require('jsqr')(new Uint8ClampedArray(raw.data), raw.info.width, raw.info.height).data,
        payload,
      )
    }
    const doc = await call('DOM.getDocument'),
      node = await call('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: 'aside input[type=file]',
      })
    await call('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [upload] })
    await pause()
    assert.ok(await evaluate('!!document.querySelector("aside img")'))
    await evaluate(
      `const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='บันทึกการตกแต่ง');b.click();b.click();b.click()`,
    )
    await wait(`document.body.textContent.includes('บันทึกรูปและการตกแต่งแล้ว')`)
    assert.equal(await evaluate('paymentTest.metrics.designSaves'), 1)
    const downloads = path.join(root, 'downloads')
    fs.mkdirSync(downloads)
    await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent==='ดาวน์โหลด PNG').click()`,
    )
    for (let i = 0; i < 40 && !fs.readdirSync(downloads).some((f) => f.endsWith('.png')); i++)
      await pause()
    assert.ok(fs.readdirSync(downloads).some((f) => f.endsWith('.png')))
    await call('Page.reload')
    await wait(
      `[...document.querySelectorAll('button')].some(b=>b.textContent==='ตกแต่ง QR / อัปเดตรูป')`,
    )
    await evaluate(
      `window.confirm=()=>true;[...document.querySelectorAll('button')].find(b=>b.textContent==='ตกแต่ง QR / อัปเดตรูป').click()`,
    )
    await wait(`document.body.textContent.includes('ดูรูป QR ต้นฉบับที่บันทึก')`)
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
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      fs.writeFileSync(
        'docs/screenshots/qr-designer-' + width + '.png',
        Buffer.from(shot.data, 'base64'),
      )
      for (const tab of ['history', 'automation', 'security', 'banks']) {
        await evaluate(`document.querySelector('#slip-tab-` + tab + `').click()`)
        await pause()
        assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'))
      }
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='ตกแต่ง QR / อัปเดตรูป').click()`,
      )
      await pause()
    }
    assert.deepEqual(errors, [])
    console.log(
      'PASS: offline Chrome: four tabs, five templates decode unchanged, upload preview, single save, PNG export, reload persistence fixture, 375/768/1440 without overflow.',
    )
  } finally {
    socket?.close()
    browser.kill()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
