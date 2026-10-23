// Actual components in Chrome. API fixtures only: no credentials, provider or outbound send.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process')
const webpack = require('next/dist/compiled/webpack/webpack')
webpack.init()
;(async () => {
  const cwd = process.cwd(),
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-store-rules-recovery-'))
  await new Promise((resolve, reject) =>
    webpack.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(cwd, 'scripts/fixtures/store-rules-recovery.tsx'),
        output: { path: root, filename: 'bundle.js' },
        resolve: {
          extensions: ['.tsx', '.ts', '.js', '.json'],
          alias: {
            'next/link$': path.join(cwd, 'scripts/fixtures/agent-overview/link.tsx'),
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
    .filter((name) => name.endsWith('.css'))
    .map((name) => fs.readFileSync(path.join('.next/static/css', name), 'utf8'))
    .join('\n')
  fs.writeFileSync(
    path.join(root, 'index.html'),
    `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body style="margin:0;background:#fffaf8"><div id="root"></div><script>window.process={env:{NODE_ENV:'development'}};</script><script src="bundle.js"></script></body></html>`,
  )
  const port = 19461,
    browser = spawn(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--no-first-run',
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
      const v = JSON.parse(event.data)
      if (v.method === 'Runtime.exceptionThrown')
        errors.push(
          v.params.exceptionDetails.exception?.description || v.params.exceptionDetails.text,
        )
      if (v.id) {
        const p = pending.get(v.id)
        pending.delete(v.id)
        if (v.error) p.reject(Error(v.error.message))
        else p.resolve(v.result)
      }
    }
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++next,
          timer = setTimeout(() => reject(Error('Timeout ' + method)), 15000)
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
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description)
      return result.result.value
    }
    const wait = async (expression) => {
      for (let i = 0; i < 60; i++) {
        if (await evaluate(expression)) return
        await new Promise((r) => setTimeout(r, 150))
      }
      throw Error('Timeout ' + expression + ' ' + JSON.stringify(errors))
    }
    await call('Runtime.enable')
    await call('Page.enable')
    await call('Emulation.setFocusEmulationEnabled', { enabled: true })
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await call('Page.navigate', {
      url: require('node:url').pathToFileURL(path.join(root, 'index.html')).href,
    })
    await wait(`document.querySelector('textarea[aria-label="ข้อมูลกฎต้นฉบับ"]')!==null`)
    assert.equal(await evaluate('storeRulesRecoveryTest.writes'), 0)
    assert.equal(
      await evaluate(
        `document.querySelector('textarea[aria-label="ข้อมูลกฎต้นฉบับ"]').value===storeRulesRecoveryTest.original`,
      ),
      true,
    )
    assert.equal(await evaluate(`window.rulesInjected===undefined`), true)
    await evaluate(
      `[...document.querySelectorAll('button')].find(button=>button.textContent==='ดาวน์โหลดข้อมูลเดิม').click()`,
    )
    await wait(`storeRulesRecoveryTest.backup===storeRulesRecoveryTest.original`)
    for (const width of [375, 768, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width === 375,
      })
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true)
    }
    const edit = `[...document.querySelectorAll('button')].find(button=>button.textContent==='แก้ไขข้อมูลเพื่อกู้คืน').click()`
    const fill = `(()=>{const input=document.querySelector('textarea[aria-label="ข้อมูลกฎที่แก้ไข"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'กฎที่แก้ไขแล้ว');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`
    const save = `[...document.querySelectorAll('button')].find(button=>button.textContent==='ยืนยันบันทึกข้อมูลที่แก้ไข')`
    await evaluate(edit)
    await evaluate(fill)
    assert.equal(await evaluate(save + '.disabled'), true)
    await evaluate(`document.querySelector('input[type="checkbox"]').click()`)
    await wait(save + '.disabled===false')
    await evaluate(`storeRulesRecoveryTest.raw='กฎที่เปลี่ยนจากอีกหน้าต่าง';${save}.click()`)
    await wait(`document.body.textContent.includes('กฎของร้านมีการเปลี่ยนแปลง')`)
    assert.equal(await evaluate('storeRulesRecoveryTest.writes'), 0)
    assert.equal(
      await evaluate(`document.querySelector('textarea[aria-label="ข้อมูลกฎที่แก้ไข"]').value`),
      'กฎที่แก้ไขแล้ว',
    )
    await evaluate(
      `[...document.querySelectorAll('button')].find(button=>button.textContent==='ยกเลิก').click();storeRulesRecoveryTest.raw=storeRulesRecoveryTest.original;storeRulesRecoveryTest.reload()`,
    )
    await evaluate(edit)
    await evaluate(fill)
    await evaluate(`document.querySelector('input[type="checkbox"]').click()`)
    await wait(save + '.disabled===false')
    await evaluate(save + '.click()')
    await wait(`document.querySelector('table')!==null&&storeRulesRecoveryTest.writes===1`)
    assert.equal(await evaluate(`document.querySelector('tbody textarea').value`), 'กฎที่แก้ไขแล้ว')
    await evaluate('storeRulesRecoveryTest.failRender()')
    await wait(`document.getElementById('boundary-fallback')!==null`)
    assert.equal(await evaluate(`document.querySelector('h1').textContent`), 'แดชบอร์ดยังใช้งานได้')
    await evaluate('storeRulesRecoveryTest.recoverRender()')
    await wait(`document.getElementById('healthy-child')!==null`)
    const unexpected = errors.filter((error) => !error.includes('StoreRulesBoundaryTestFault'))
    assert.deepEqual(unexpected, [])
    console.log(
      'PASS: malformed rules remain readable and downloadable, no automatic writes or script execution, responsive recovery UI, confirmation, conflict preservation, explicit save and isolated error boundary recovery',
    )
  } finally {
    socket?.close()
    browser.kill()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
