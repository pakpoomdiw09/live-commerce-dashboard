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

    await wait(
      'window.auctionQA && document.body.textContent.includes(window.auctionQA.auctions[0].leading_bidder_name)',
    )
    for (const width of [375, 768, 1440]) {
      await resize(width)
      assert.ok(
        await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
        'No horizontal page overflow at ' + width,
      )
      const screenshot = await call('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(
        path.join(output, 'auction-' + width + '.png'),
        Buffer.from(screenshot.data, 'base64'),
      )
    }
    await evaluate("document.querySelector('section[aria-label] header button').click()")
    await wait('document.querySelector(\'input[maxlength="200"]\') !== null')
    await evaluate(`(() => {
      const fields=document.querySelectorAll('form input:not([type=number])');
      const set=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
      set(fields[0],window.auctionQA.auctions[0].item_name+' QA');set(fields[1],'456');
    })()`)
    await evaluate("document.querySelector('form').requestSubmit()")
    await wait(
      'window.auctionQA.requests.length > 0 && document.querySelector(\'input[maxlength="200"]\') === null',
    )
    assert.equal(await evaluate('window.auctionQA.requests[0].body.startPrice'), 200)
    assert.equal(await evaluate('window.auctionQA.requests[0].body.minStep'), 20)
    await evaluate("document.querySelector('section[aria-label] button.bg-orange-500').click()")
    await wait("document.querySelector('section[aria-label] .space-y-1') !== null")
    assert.equal(
      await evaluate("document.querySelector('section[aria-label] button.bg-orange-500') === null"),
      true,
    )
    await evaluate(
      `(() => {const input=document.querySelector('input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([255,216,255,224])],'slip.jpg',{type:'image/jpeg'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));input.closest('form').requestSubmit()})()`,
    )
    await wait("document.querySelector('[role=status]') !== null")
    assert.deepEqual(errors, [])
    console.log(
      'PASS: auction UI at 375/768/1440px, open form, numeric payload, close, delivery status and signed-link slip form; no browser exceptions.',
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
