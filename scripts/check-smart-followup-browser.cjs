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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-follow-ups-'))
  await new Promise((resolve, reject) =>
    webpack.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(cwd, 'scripts/fixtures/follow-ups/entry.tsx'),
        output: { path: root, filename: 'bundle.js' },
        resolve: {
          extensions: ['.tsx', '.ts', '.js', '.json'],
          alias: {
            'next/link$': path.join(cwd, 'scripts/fixtures/agent-overview/link.tsx'),
            'next/navigation$': path.join(cwd, 'scripts/fixtures/follow-ups/stubs.ts'),
            '@/lib/supabase/browser$': path.join(cwd, 'scripts/fixtures/follow-ups/stubs.ts'),
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
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await call('Page.navigate', {
      url: require('node:url').pathToFileURL(path.join(root, 'index.html')).href,
    })

    await wait(`document.querySelector('fieldset')!==null`)
    assert.equal(await evaluate(`document.querySelectorAll('input[type="time"]').length`), 0)
    assert.equal(await evaluate(`document.querySelectorAll('fieldset .lucide-save').length`), 3)
    assert.equal(await evaluate(`!!document.querySelector('[role="status"].bg-emerald-50')`), true)
    const setInput = async (selector, value) =>
      evaluate(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      )
    await setInput('[aria-label="Delay step 1 (minutes)"]', '')
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Delay step 1 (minutes)"]').value`),
      '',
    )
    await setInput('[aria-label="Delay step 1 (minutes)"]', '2')
    await setInput('textarea', 'Edited first step')
    await setInput('[aria-label="Delay step 2 (minutes)"]', '222')
    await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Delay step 1 (minutes)"]').value`),
      '2',
    )
    const clickSave = () =>
      evaluate(`document.querySelector('fieldset .lucide-save').closest('button').click()`)
    await clickSave()
    await wait('followUpTest.saves.length===1')
    await wait(`!document.querySelector('fieldset').disabled`)
    assert.equal(await evaluate('followUpTest.saves[0].index'), 0)
    assert.equal(await evaluate('followUpTest.saves[0].steps.length'), 1)
    assert.equal(await evaluate('followUpTest.saves[0].steps[0].delay_minutes'), 2)
    assert.equal(await evaluate('followUpTest.saves[0].steps[0].text'), 'Edited first step')
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Delay step 2 (minutes)"]').value`),
      '222',
    )
    await evaluate(
      `document.querySelectorAll('fieldset .lucide-save')[1].closest('button').click()`,
    )
    await wait('followUpTest.saves.length===2')
    await wait(`!document.querySelector('fieldset').disabled`)
    assert.equal(await evaluate('followUpTest.saves[1].index'), 1)
    assert.equal(await evaluate('followUpTest.saves[1].version'), 2)
    await setInput('[aria-label="Delay step 1 (minutes)"]', '')
    await clickSave()
    await wait(`document.querySelector('[role="alert"]')!==null`)
    assert.equal(await evaluate('followUpTest.saves.length'), 2)
    await setInput('[aria-label="Delay step 1 (minutes)"]', '2')
    for (const width of [375, 768, 1440, 1920]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 768,
      })
      await new Promise((r) => setTimeout(r, 150))
      assert.ok(
        await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),
        'horizontal overflow at ' + width,
      )
      assert.ok(
        await evaluate(
          "document.querySelector('#root > div').getBoundingClientRect().width>=document.documentElement.clientWidth-1",
        ),
        'page fills viewport at ' + width,
      )
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      fs.writeFileSync(`.tmp/follow-up-settings-${width}.png`, Buffer.from(shot.data, 'base64'))
    }
    assert.deepEqual(await evaluate('followUpTest.unexpected'), [])
    assert.deepEqual(errors, [])
    console.log(
      'PASS: actual React/Chrome, no contact-policy inputs, live indicator, per-step numeric/text persistence, preserved unsaved steps, updated version, invalid empty input, responsive layouts',
    )
  } finally {
    socket?.close()
    browser.kill()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
