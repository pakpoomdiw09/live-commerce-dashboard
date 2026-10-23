// Real React/Chrome offline integration. Every API and Supabase operation uses test fixtures.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process')
const webpackModule = require('next/dist/compiled/webpack/webpack')
webpackModule.init()
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapbot-inbox-pro-')),
    cwd = process.cwd(),
    mock = path.join(cwd, 'scripts/fixtures/inbox-pro/mocks.tsx')
  await new Promise((resolve, reject) =>
    webpackModule.webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        entry: path.join(cwd, 'scripts/fixtures/inbox-pro/entry.tsx'),
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
      (error, stats) => {
        if (error || stats.hasErrors())
          reject(error || Error(stats.toString({ all: false, errors: true })))
        else resolve()
      },
    ),
  )
  const css = fs
    .readdirSync('.next/static/css')
    .filter((name) => name.endsWith('.css'))
    .map((name) => fs.readFileSync(path.join('.next/static/css', name), 'utf8'))
    .join('\n')
  fs.writeFileSync(
    path.join(root, 'index.html'),
    `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root" style="display:flex;flex-direction:column;height:100dvh;min-height:0;overflow:hidden"></div><script>window.process={env:{NODE_ENV:"development"}};</script><script src="bundle.js"></script></body></html>`,
  )
  const port = 19453,
    exe = process.argv[2] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const browser = spawn(
    exe,
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
      const value = JSON.parse(event.data)
      if (value.method === 'Runtime.exceptionThrown')
        errors.push(
          value.params.exceptionDetails.exception?.description ||
            value.params.exceptionDetails.text,
        )
      if (value.id) {
        const handler = pending.get(value.id)
        pending.delete(value.id)
        if (value.error) handler.reject(Error(value.error.message))
        else handler.resolve(value.result)
      }
    }
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++next
        const timer = setTimeout(() => reject(Error('CDP timeout ' + method)), 15000)
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
      }).catch((error) => {
        throw Error(error.message + ' expression: ' + expression.slice(0, 180))
      })
      if (result.exceptionDetails)
        throw Error(result.exceptionDetails.exception?.description || 'Browser expression failed')
      return result.result.value
    }
    const pause = () => new Promise((r) => setTimeout(r, 200))
    const wait = async (expression) => {
      for (let i = 0; i < 60; i++) {
        if (await evaluate(expression)) return
        await pause()
      }
      throw Error(
        'Browser assertion timeout: ' +
          expression +
          ' ' +
          JSON.stringify(errors) +
          ' body=' +
          (await evaluate('(document.body?.textContent??"").slice(0,1500)')),
      )
    }
    await call('Runtime.enable')
    await call('Page.enable')
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await call('Page.navigate', {
      url:
        require('node:url').pathToFileURL(path.join(root, 'index.html')).href +
        (process.env.INBOX_V2_TEST === '1' ? '#v2' : ''),
    })
    await wait('(document.body?.textContent??"").includes(' + JSON.stringify('รวมแชท') + ')')
    await evaluate(
      `window.pick=name=>[...document.querySelectorAll('aside[aria-label="รายชื่อแชท"] button')].find(button=>button.textContent.includes(name)).click()`,
    )
    await pause()
    await evaluate(
      `[...document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] button')].find(b=>b.textContent.startsWith('ยังไม่ได้อ่าน')).click()`,
    )
    await pause()
    assert.equal(
      await evaluate(
        `document.querySelectorAll('aside[aria-label="รายชื่อแชท"] button[aria-current]').length`,
      ),
      0,
    )
    await evaluate(
      `[...document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] button')].find(b=>b.textContent.startsWith('ทั้งหมด')).click()`,
    )
    await pause()
    await evaluate(
      `var search=document.querySelector('input[aria-label="ค้นหาแชท"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'ลูกค้า A');search.dispatchEvent(new Event('input',{bubbles:true}))`,
    )
    await new Promise((r) => setTimeout(r, 500))
    assert.equal(
      await evaluate(
        `document.querySelectorAll('aside[aria-label="รายชื่อแชท"] ul button[aria-current]').length`,
      ),
      1,
    )
    await evaluate(
      `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('input[aria-label="ค้นหาแชท"]'),'');document.querySelector('input[aria-label="ค้นหาแชท"]').dispatchEvent(new Event('input',{bubbles:true}))`,
    )
    await pause()
    const reads = await evaluate('inboxTest.metrics.threadReads')
    await evaluate(`pick('ลูกค้า B');pick('ลูกค้า B');pick('ลูกค้า B')`)
    await pause()
    assert.equal(await evaluate('inboxTest.metrics.threadReads'), reads + 1)
    assert.equal(
      await evaluate(
        `document.querySelectorAll('aside[aria-label="รายชื่อแชท"] button[aria-current="true"]').length`,
      ),
      1,
    )
    await evaluate(`pick('ลูกค้า A');new Promise(resolve=>setTimeout(resolve,10))`)
    await evaluate(`pick('ลูกค้า B');new Promise(resolve=>setTimeout(resolve,10))`)
    await evaluate(`pick('ลูกค้า C')`)
    await pause()
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-testid="inbox-thread"] h2')[0].textContent`),
      'ลูกค้า C',
    )
    assert.ok(
      !(
        await evaluate(`document.querySelector('[data-testid="inbox-thread"]').textContent`)
      ).includes('ข้อความของ ลูกค้า A'),
    )
    await evaluate('inboxTest.replay();inboxTest.replay();inboxTest.reconnect()')
    await pause()
    assert.equal(
      await evaluate(
        `document.querySelector('[data-testid="inbox-thread"]').textContent.split('ข้อความของ ลูกค้า C').length-1`,
      ),
      1,
    )
    assert.equal(await evaluate('inboxTest.metrics.channels.size'), 2)
    await wait(
      `document.querySelector('[data-chat-header]').textContent.includes('AI ตอบอัตโนมัติเปิดอยู่')`,
    )
    await evaluate(
      `var aiOff=document.querySelector('button[aria-label="ปิด AI ให้แอดมินดูแล"]');aiOff.click();aiOff.click();aiOff.click()`,
    )
    await pause()
    assert.equal(await evaluate('inboxTest.metrics.mutations'), 1)
    await wait(`document.querySelector('[data-chat-header]').textContent.includes('AI ปิดอยู่')`)
    assert.equal(
      await evaluate(`document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').disabled`),
      false,
      'AI off must let the assigned admin reply',
    )
    await evaluate(
      `inboxTest.conversationControl.failNext=true;document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]').click()`,
    )
    await wait(
      `document.querySelector('[data-chat-header]').textContent.includes('ทดสอบเปลี่ยนสถานะ AI ไม่สำเร็จ')`,
    )
    assert.equal(
      await evaluate(
        `document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]').getAttribute('aria-pressed')`,
      ),
      'false',
      'Failed save must not pretend AI is enabled',
    )
    const failedAutomationKey = await evaluate(
      'inboxTest.metrics.conversationWrites.at(-1).requestId',
    )
    await evaluate(
      `const on=document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]');on.click();on.click();on.click()`,
    )
    await pause()
    assert.equal(await evaluate('inboxTest.metrics.mutations'), 2)
    assert.equal(
      await evaluate('inboxTest.metrics.conversationWrites.at(-1).requestId'),
      failedAutomationKey,
    )
    await wait(
      `document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]').getAttribute('aria-pressed')==='true'`,
    )
    assert.equal(
      await evaluate(`document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').disabled`),
      true,
    )
    await evaluate(
      `var aiOff=document.querySelector('button[aria-label="ปิด AI ให้แอดมินดูแล"]');aiOff.click();aiOff.click();aiOff.click()`,
    )
    await pause()
    assert.equal(await evaluate('inboxTest.metrics.mutations'), 3)
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('[data-chat-header] button,[data-chat-header] summary')].some(button=>['ปิดแชท','จัดการแชท'].includes(button.textContent))`,
      ),
      false,
    )
    await evaluate(
      `inboxTest.conversationControl.masterEnabled=false;window.dispatchEvent(new Event('online'))`,
    )
    await wait(`document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]').disabled`)
    assert.ok(
      await evaluate(
        `document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]').title.includes('ร้านปิดอยู่')`,
      ),
    )
    await evaluate(
      `inboxTest.conversationControl.masterEnabled=true;inboxTest.conversationControl.aiAllowed=false;window.dispatchEvent(new Event('online'))`,
    )
    await wait(
      `document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]').title.includes('แพ็กเกจ')`,
    )
    await evaluate(
      `inboxTest.conversationControl.aiAllowed=true;inboxTest.customers[2].assigned_user_id='other-admin';window.dispatchEvent(new Event('online'))`,
    )
    await wait(
      `document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]').title.includes('ผู้ดูแลคนอื่น')`,
    )
    assert.equal(
      await evaluate(
        `document.querySelector('button[aria-label="ปิด AI ให้แอดมินดูแล"]').disabled`,
      ),
      true,
    )
    await evaluate(
      `inboxTest.customers[2].assigned_user_id='admin';window.dispatchEvent(new Event('online'))`,
    )
    await wait(`!document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]').disabled`)
    assert.deepEqual(
      await evaluate(
        `[...document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] button')].map(button=>button.firstChild.textContent)`,
      ),
      ['ทั้งหมด', 'ยังไม่ได้อ่าน', 'ผลติดตามดาว', 'ชำระเงินแล้ว', 'เสร็จสิ้น'],
    )
    await evaluate(
      `[...document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] button')].find(button=>button.textContent.startsWith('ชำระเงินแล้ว')).click()`,
    )
    await wait(
      `document.querySelectorAll('aside[aria-label="รายชื่อแชท"] li.relative > button').length===1`,
    )
    assert.ok(
      await evaluate(
        `document.querySelector('aside[aria-label="รายชื่อแชท"] li.relative > button').textContent.includes('ลูกค้า B')`,
      ),
    )
    await evaluate(
      `[...document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] button')].find(button=>button.textContent.startsWith('ทั้งหมด')).click()`,
    )
    await pause()
    await evaluate(
      `document.querySelector('button[aria-label="คู่มือการใช้งาน"]').click();document.querySelector('button[aria-label="คู่มือการใช้งาน"]').click()`,
    )
    assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 1)
    assert.equal(
      await evaluate(
        `document.querySelector('dialog[open]').textContent.includes('ระบบอัตโนมัติจะหยุดทำงานทันทีเมื่อแอดมินกดรับช่วงดูแลแชท')`,
      ),
      true,
    )
    assert.equal(
      await evaluate(
        `/บอท|Smart Inbox|Messenger|Facebook|\\bAPI\\b/.test(document.body.textContent)`,
      ),
      false,
      'System copy must use Thai wording apart from the requested AI status',
    )
    await evaluate('document.querySelector("dialog[open]").close()')
    assert.equal(
      await evaluate('document.querySelectorAll("[data-testid=inbox-thread]").length'),
      1,
    )
    assert.equal(
      await evaluate(
        `document.querySelectorAll('aside[aria-label="รายละเอียดลูกค้าและสลิป"]').length`,
      ),
      1,
    )
    assert.equal(
      await evaluate('inboxTest.metrics.requests.some(url=>url.startsWith("/api/inbox/pro?"))'),
      false,
      'Chat workspace must not load dashboard metrics',
    )
    assert.equal(
      await evaluate(
        `document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] a').length`,
      ),
      0,
    )
    assert.ok(
      await evaluate(
        `document.querySelector('[data-testid="inbox-thread"]').textContent.includes('แอดมินรับช่วงแล้ว')`,
      ),
    )
    assert.equal(
      await evaluate(`document.querySelector('summary[aria-label="เครื่องมือตอบแชท"]')`),
      null,
    )
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('aside[aria-label="รายละเอียดลูกค้าและสลิป"]')).display`,
      ),
      'none',
    )
    const wideChat = await evaluate(
      `document.querySelector('[data-testid="inbox-thread"]').getBoundingClientRect().width`,
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[role="toolbar"][aria-label="เครื่องมือข้อความ"]').children.length`,
      ),
      5,
    )
    const headerHeight = await evaluate(
      `document.querySelector('[data-chat-header]').getBoundingClientRect().height`,
    )
    assert.ok(headerHeight <= 72, 'Desktop chat header should fit in a slim row: ' + headerHeight)
    assert.ok(
      (await evaluate(
        `document.querySelector('[data-message-list]').getBoundingClientRect().height/document.querySelector('[data-testid="inbox-thread"]').getBoundingClientRect().height`,
      )) > 0.5,
    )
    await evaluate(`document.querySelector('button[aria-label="คำตอบด่วน"]').click()`)
    await pause()
    assert.equal(
      await evaluate(
        `document.querySelector('dialog[aria-label="การตอบกลับที่บันทึกไว้"]').matches(':modal')`,
      ),
      true,
    )
    const modalRect = await evaluate(
      `(()=>{const r=document.querySelector('dialog[aria-label="การตอบกลับที่บันทึกไว้"]').getBoundingClientRect();return {width:r.width,center:r.left+r.width/2}})()`,
    )
    assert.ok(modalRect.width >= 700)
    assert.ok(Math.abs(modalRect.center - 720) < 2)
    await evaluate(
      `document.querySelector('[role="dialog"][aria-label="การตอบกลับที่บันทึกไว้"] ul button').click()`,
    )
    await pause()
    assert.equal(
      await evaluate(
        `document.querySelector('[role="dialog"][aria-label="การตอบกลับที่บันทึกไว้"]')`,
      ),
      null,
    )
    assert.equal(
      await evaluate(
        `document.activeElement===document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]')`,
      ),
      true,
    )
    assert.equal(
      await evaluate(`document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').value`),
      'สวัสดีค่ะ ยินดีให้บริการ',
    )
    await evaluate(
      `var composer=document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(composer,'ก่อน | หลัง');composer.dispatchEvent(new Event('input',{bubbles:true}))`,
    )
    await pause()
    await evaluate(
      `var composer=document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]');composer.focus();var at=composer.value.indexOf('|');composer.setSelectionRange(at,at+1);document.querySelector('button[aria-label="คำตอบด่วน"]').click()`,
    )
    await pause()
    await evaluate(
      `document.querySelector('[role="dialog"][aria-label="การตอบกลับที่บันทึกไว้"] ul button').click()`,
    )
    await pause()
    assert.equal(
      await evaluate(`document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').value`),
      'ก่อน สวัสดีค่ะ ยินดีให้บริการ หลัง',
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[role="dialog"][aria-label="การตอบกลับที่บันทึกไว้"]')`,
      ),
      null,
    )
    await evaluate(`document.querySelector('button[aria-label="เลือกอีโมจิ"]').click()`)
    await evaluate(`document.querySelector('button[aria-label="😊"]').click()`)
    await pause()
    assert.ok(
      await evaluate(
        `document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').value.endsWith('😊')`,
      ),
    )
    assert.equal(
      await evaluate(
        `document.querySelector('button[aria-label="เลือกอีโมจิ"]').getAttribute('aria-expanded')`,
      ),
      'false',
    )
    await evaluate(`document.querySelector('button[aria-label="เลือกอีโมจิ"]').click()`)
    await pause()
    await evaluate(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    )
    await pause()
    assert.equal(
      await evaluate(
        `document.querySelector('button[aria-label="เลือกอีโมจิ"]').getAttribute('aria-expanded')`,
      ),
      'false',
    )
    await evaluate(`document.querySelector('button[aria-label="ผู้ช่วยร่างข้อความ"]').click()`)
    await wait(
      `document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').value==='ข้อความร่างสำหรับทดสอบ'`,
    )
    const uploadPath = path.join(root, 'attachment.png')
    fs.writeFileSync(
      uploadPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=',
        'base64',
      ),
    )
    const dom = await call('DOM.getDocument')
    const fileNode = await call('DOM.querySelector', {
      nodeId: dom.root.nodeId,
      selector: 'input[type="file"]',
    })
    await call('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [uploadPath] })
    await wait(`document.querySelector('button[aria-label="นำไฟล์ออก"]')!==null`)
    await evaluate(`document.querySelector('button[aria-label="นำไฟล์ออก"]').click()`)
    assert.equal(
      await evaluate(`inboxTest.metrics.requests.some(url=>url==='/api/messages/send')`),
      false,
    )
    await evaluate(`document.querySelector('button[aria-label="คำตอบด่วน"]').click()`)
    await pause()
    await evaluate(
      `[...document.querySelectorAll('[role="dialog"][aria-label="การตอบกลับที่บันทึกไว้"] button')].find(b=>b.textContent.includes('เพิ่มคำตอบด่วนใหม่')).click()`,
    )
    await pause()
    await evaluate(
      `var shortcut=document.querySelector('input[aria-label="ทางลัด"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(shortcut,'ขอบคุณ');shortcut.dispatchEvent(new Event('input',{bubbles:true}))`,
    )
    await pause()
    await evaluate(
      `var saved=document.querySelector('textarea[aria-label="ข้อความคำตอบด่วนใหม่"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(saved,'ขอบคุณที่อุดหนุนร้านค่ะ');saved.dispatchEvent(new Event('input',{bubbles:true}))`,
    )
    await pause()
    assert.ok(
      await evaluate(
        `document.querySelector('dialog[aria-label="การตอบกลับที่บันทึกไว้"]').textContent.includes(' / 2,000 ตัวอักษร')`,
      ),
    )
    fs.mkdirSync('docs/screenshots', { recursive: true })
    var modalShot = await call('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    fs.writeFileSync(
      'docs/screenshots/inbox-saved-replies-modal-1440.png',
      Buffer.from(modalShot.data, 'base64'),
    )
    await call('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: true,
    })
    await pause()
    assert.ok(
      await evaluate(
        `(()=>{const d=document.querySelector('dialog[aria-label="การตอบกลับที่บันทึกไว้"]');return d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth})()`,
      ),
    )
    modalShot = await call('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    fs.writeFileSync(
      'docs/screenshots/inbox-saved-replies-modal-375.png',
      Buffer.from(modalShot.data, 'base64'),
    )
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await pause()
    await evaluate(
      `[...document.querySelectorAll('[role="dialog"][aria-label="การตอบกลับที่บันทึกไว้"] button')].find(b=>b.textContent==='บันทึก').click()`,
    )
    await wait(
      `[...document.querySelectorAll('[role="dialog"][aria-label="การตอบกลับที่บันทึกไว้"] ul button')].some(b=>b.dataset.replyBody==='ขอบคุณที่อุดหนุนร้านค่ะ')`,
    )
    await evaluate(
      `[...document.querySelectorAll('[role="dialog"][aria-label="การตอบกลับที่บันทึกไว้"] ul button')].find(b=>b.dataset.replyBody==='ขอบคุณที่อุดหนุนร้านค่ะ').click()`,
    )
    await pause()
    assert.ok(
      await evaluate(
        `document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').value.includes('ขอบคุณที่อุดหนุนร้านค่ะ')`,
      ),
    )
    assert.equal(
      await evaluate('inboxTest.metrics.mutations'),
      3,
      'Tool selection must not send or change ownership',
    )
    {
      await wait(`document.querySelector('button[aria-label="ติดดาวแชท"]:not(:disabled)')!==null`)
      await evaluate(`document.querySelector('button[aria-label="ติดดาวแชท"]').click()`)
      await wait(
        `document.querySelector('button[aria-label="ติดดาวแชท"]').getAttribute('aria-pressed')==='true'`,
      )
      assert.equal(
        await evaluate(
          `document.querySelectorAll('[data-chat-header] button[aria-label="ติดดาวแชท"]').length`,
        ),
        1,
      )
      await wait(`document.querySelector('button[aria-label="ติดตามผลแชท"]:not(:disabled)')!==null`)
      const beforeFlag = await evaluate('inboxTest.metrics.workspaceWrites.length')
      await evaluate(
        `var flag=document.querySelector('button[aria-label="ติดตามผลแชท"]');flag.click();flag.click();flag.click()`,
      )
      await wait(
        `document.querySelector('button[aria-label="ติดตามผลแชท"]').getAttribute('aria-pressed')==='true'`,
      )
      assert.equal(
        await evaluate('inboxTest.metrics.workspaceWrites.length'),
        beforeFlag + 1,
        'Triple click must save the flag once',
      )
      assert.equal(
        await evaluate(
          `document.querySelector('button[aria-label="ติดดาวแชท"]').getAttribute('aria-pressed')`,
        ),
        'true',
        'Follow-up must preserve the star',
      )
      await evaluate(`pick('ลูกค้า A')`)
      await pause()
      await wait(`document.querySelector('button[aria-label="ติดตามผลแชท"]:not(:disabled)')!==null`)
      assert.equal(
        await evaluate(
          `document.querySelector('button[aria-label="ติดตามผลแชท"]').getAttribute('aria-pressed')`,
        ),
        'false',
      )
      await evaluate(`document.querySelector('button[aria-label="ติดตามผลแชท"]').click()`)
      await wait(
        `document.querySelector('button[aria-label="ติดตามผลแชท"]').getAttribute('aria-pressed')==='true'`,
      )
      await evaluate(
        `[...document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] button')].find(button=>button.textContent.startsWith('ผลติดตามดาว')).click()`,
      )
      await wait(
        `document.querySelectorAll('aside[aria-label="รายชื่อแชท"] li.relative > button').length===2`,
      )
      assert.equal(
        await evaluate(
          `[...document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] button')].find(button=>button.textContent.startsWith('ผลติดตามดาว')).querySelector('span').textContent`,
        ),
        '2',
        'Stars and follow-up flags must form a distinct union',
      )
      await evaluate(`document.querySelector('button[aria-label="ติดตามผลแชท"]').click()`)
      await wait(
        `document.querySelectorAll('aside[aria-label="รายชื่อแชท"] li.relative > button').length===1`,
      )
      await evaluate(
        `[...document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] button')].find(button=>button.textContent.startsWith('ทั้งหมด')).click()`,
      )
      await pause()
      await evaluate(`pick('ลูกค้า C')`)
      await pause()
      await wait(
        `document.querySelector('button[aria-label="ติดตามผลแชท"]').getAttribute('aria-pressed')==='true'`,
      )
      await evaluate(`document.querySelector('button[aria-label="ติดตามผลแชท"]').click()`)
      await wait(
        `document.querySelector('button[aria-label="ติดตามผลแชท"]').getAttribute('aria-pressed')==='false'`,
      )
      await wait(`document.querySelector('button[aria-label="ติดตามผลแชท"]:not(:disabled)')!==null`)
      await evaluate(
        `inboxTest.workspaceControl.failNext=true;document.querySelector('button[aria-label="ติดตามผลแชท"]').click()`,
      )
      await wait(
        `document.querySelector('[data-chat-header]').textContent.includes('ทดสอบบันทึกไม่สำเร็จ')`,
      )
      assert.equal(
        await evaluate(
          `document.querySelector('button[aria-label="ติดตามผลแชท"]').getAttribute('aria-pressed')`,
        ),
        'false',
      )
      const failedKey = await evaluate('inboxTest.metrics.workspaceWrites.at(-1).requestId')
      await evaluate(`document.querySelector('button[aria-label="ติดตามผลแชท"]').click()`)
      await wait(
        `document.querySelector('button[aria-label="ติดตามผลแชท"]').getAttribute('aria-pressed')==='true'`,
      )
      assert.equal(
        await evaluate('inboxTest.metrics.workspaceWrites.at(-1).requestId'),
        failedKey,
        'A failed save must retain its idempotency key',
      )
      await wait(`document.querySelector('button[aria-label="ติดตามผลแชท"]:not(:disabled)')!==null`)
      await evaluate(`document.querySelector('button[aria-label="ติดตามผลแชท"]').click()`)
      await wait(
        `document.querySelector('button[aria-label="ติดตามผลแชท"]').getAttribute('aria-pressed')==='false'`,
      )
      await evaluate(
        `document.querySelector('button[aria-label="รายละเอียดลูกค้าและสลิป"]').click()`,
      )
      await pause()
      assert.ok(
        (await evaluate(
          `document.querySelector('[data-testid="inbox-thread"]').getBoundingClientRect().width`,
        )) < wideChat,
      )
      await evaluate(
        `[...document.querySelectorAll('nav[aria-label="ข้อมูลลูกค้า"] button')].find(b=>b.textContent==='โน้ต').click()`,
      )
      await wait(`document.querySelector('textarea[aria-label="โน้ตภายใน"]')!==null`)
      await evaluate(
        `const textarea=document.querySelector('textarea[aria-label="โน้ตภายใน"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'โน้ตทดสอบเฉพาะทีม');textarea.dispatchEvent(new Event('input',{bubbles:true}))`,
      )
      await pause()
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='บันทึกโน้ต').click()`,
      )
      await wait(
        `[...document.querySelectorAll('article')].some(n=>n.textContent.includes('โน้ตทดสอบเฉพาะทีม'))`,
      )
      assert.equal(
        await evaluate('inboxTest.metrics.mutations'),
        3,
        'Notes and stars must never send a message or alter ownership',
      )
      await evaluate(
        `var filter=document.querySelector('select[aria-label="กรองตามสถานะ"]');filter.value='starred';filter.dispatchEvent(new Event('change',{bubbles:true}))`,
      )
      await pause()
      assert.equal(
        await evaluate(
          `document.querySelectorAll('aside[aria-label="รายชื่อแชท"] li.relative > button').length`,
        ),
        1,
      )
      await evaluate(
        `var filter=document.querySelector('select[aria-label="กรองตามสถานะ"]');filter.value='all';filter.dispatchEvent(new Event('change',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent==='มอบหมายแชท').click()`,
      )
      await pause()
      await evaluate(
        `document.querySelector('input[aria-label="เลือก ลูกค้า A"]').click();document.querySelector('input[aria-label="เลือก ลูกค้า B"]').click()`,
      )
      await pause()
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='ยืนยันดำเนินการ').click()`,
      )
      await wait(`(document.body?.textContent??"").includes('สำเร็จ 2/2 แชท')`)
      assert.equal(
        await evaluate('inboxTest.metrics.mutations'),
        5,
        'Bulk claim must perform exactly one authorized mutation per selected conversation',
      )
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='ยกเลิกการเลือก').click()`,
      )
      await evaluate(`document.querySelector('button[aria-label="ปิดรายละเอียดลูกค้า"]').click()`)
      await pause()
      assert.equal(
        await evaluate(
          `getComputedStyle(document.querySelector('aside[aria-label="รายละเอียดลูกค้าและสลิป"]')).display`,
        ),
        'none',
      )
      await evaluate(
        `document.querySelector('button[aria-label="รายละเอียดลูกค้าและสลิป"]').click()`,
      )
      await pause()
    }
    await evaluate('inboxTest.threadChange("fill")')
    await pause()
    await wait(
      `(()=>{const el=document.querySelector('[data-message-list]');return el.scrollHeight>el.clientHeight*2&&el.scrollHeight-el.scrollTop-el.clientHeight<3})()`,
    )
    await evaluate(
      `var el=document.querySelector('[data-message-list]');el.scrollTop=el.scrollHeight/3;el.dispatchEvent(new Event('scroll'))`,
    )
    await pause()
    const readAnchor = await evaluate(
      `(()=>{const el=document.querySelector('[data-message-list]'),top=el.getBoundingClientRect().top;const node=[...el.querySelectorAll('[data-message-id]')].find(n=>n.getBoundingClientRect().bottom>top);return {id:node.dataset.messageId,offset:node.getBoundingClientRect().top-top,top:el.scrollTop,outer:scrollY}})()`,
    )
    await evaluate('inboxTest.threadChange("append")')
    await pause()
    assert.ok(
      Math.abs(
        (await evaluate(`document.querySelector('[data-message-list]').scrollTop`)) -
          readAnchor.top,
      ) < 3,
      'Incoming message must preserve reading position',
    )
    await evaluate('inboxTest.threadChange("prepend")')
    await pause()
    const afterAnchor = await evaluate(
      `(()=>{const el=document.querySelector('[data-message-list]');const node=[...el.querySelectorAll('[data-message-id]')].find(n=>n.dataset.messageId===${JSON.stringify(readAnchor.id)});return node.getBoundingClientRect().top-el.getBoundingClientRect().top})()`,
    )
    assert.ok(
      Math.abs(afterAnchor - readAnchor.offset) < 3,
      'Older messages must preserve visible anchor',
    )
    assert.equal(
      await evaluate('scrollY'),
      readAnchor.outer,
      'Message updates must not scroll the outer page',
    )
    await evaluate(
      `var el=document.querySelector('[data-message-list]');el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))`,
    )
    await pause()
    await evaluate('inboxTest.threadChange("append")')
    await pause()
    assert.ok(
      (await evaluate(
        `(()=>{const el=document.querySelector('[data-message-list]');return el.scrollHeight-el.scrollTop-el.clientHeight})()`,
      )) < 3,
      'Follow newest messages while at bottom',
    )
    await evaluate(`pick('ลูกค้า A')`)
    await pause()
    await evaluate(`pick('ลูกค้า C')`)
    await pause()
    await wait(
      `(()=>{const el=document.querySelector('[data-message-list]');return el.scrollHeight>el.clientHeight*2&&el.scrollHeight-el.scrollTop-el.clientHeight<3})()`,
    )
    assert.equal(
      await evaluate(`document.getElementById('root').scrollTop`),
      0,
      'Opening a conversation must not move its outer container',
    )
    fs.mkdirSync('docs/screenshots', { recursive: true })
    for (const width of [375, 768, 1024, 1280, 1440, 1920]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 768,
      })
      await pause()
      if (width < 1280) {
        await evaluate(`document.querySelector('button[aria-label="ปิดรายละเอียดลูกค้า"]').click()`)
        await pause()
      }
      if (width < 768) {
        await evaluate(`document.querySelector('button[aria-label="กลับไปรายชื่อแชท"]').click()`)
        await pause()
      }
      if (width >= 1280) {
        await evaluate(
          `var toggle=document.querySelector('button[aria-label="รายละเอียดลูกค้าและสลิป"]');if(toggle.getAttribute('aria-expanded')!=='true')toggle.click()`,
        )
        await pause()
      }
      assert.equal(await evaluate(`document.body.textContent.includes('เลือกหลายแชท')`), false)
      assert.equal(
        await evaluate(`document.querySelector('input[aria-label="ค้นหาแชท"]').placeholder`),
        'ค้นหาชื่อ',
      )
      const layout = await evaluate(
        `(()=>{const list=document.querySelector('aside[aria-label="รายชื่อแชท"]');const grid=list.parentElement;const thread=document.querySelector('[data-testid="inbox-thread"]');const details=document.querySelector('aside[aria-label="รายละเอียดลูกค้าและสลิป"]');return {gridWidth:grid.clientWidth,listWidth:list.getBoundingClientRect().width,threadWidth:thread.getBoundingClientRect().width,detailWidth:getComputedStyle(details).position==='static'&&getComputedStyle(details).display!=='none'?details.getBoundingClientRect().width:0,gridOverflow:grid.scrollWidth>grid.clientWidth+1,threadOverflow:thread.scrollWidth>thread.clientWidth+1,detailOverflow:details.scrollWidth>details.clientWidth+1}})()`,
      )
      assert.equal(layout.gridOverflow, false, 'Grid overflow at ' + width)
      if (width >= 768) {
        assert.equal(layout.threadOverflow, false, 'Thread overflow at ' + width)
        assert.ok(
          Math.abs(layout.gridWidth - layout.listWidth - layout.threadWidth - layout.detailWidth) <
            2,
          'Columns must fill the grid at ' + width,
        )
      }
      if (width >= 1280)
        assert.equal(layout.detailOverflow, false, 'Customer details overflow at ' + width)
      if (width < 768)
        assert.equal(layout.listWidth, layout.gridWidth, 'Mobile list must fit its container')
      const alignment = await evaluate(
        `(()=>{const list=document.querySelector('aside[aria-label="รายชื่อแชท"]').getBoundingClientRect();const search=document.querySelector('input[aria-label="ค้นหาแชท"]').getBoundingClientRect();const tabs=document.querySelector('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"]').getBoundingClientRect();return {list:list.left,search:search.left,tabs:tabs.left}})()`,
      )
      assert.ok(
        Math.abs(alignment.list - alignment.tabs) < 1,
        'List and tabs must align at ' + width,
      )
      assert.ok(
        Math.abs(alignment.search - alignment.tabs) < 1,
        'Search and tabs must align at ' + width,
      )
      const dimensions = await evaluate(
        '({width:innerWidth,scroll:document.documentElement.scrollWidth})',
      )
      assert.ok(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions))
      const screenshot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      const screenshotDirectory = [375, 768, 1440].includes(width)
        ? 'docs/screenshots'
        : '.tmp/inbox-fit-preview'
      fs.mkdirSync(screenshotDirectory, { recursive: true })
      fs.writeFileSync(
        path.join(screenshotDirectory, `inbox-v2-${width}.png`),
        Buffer.from(screenshot.data, 'base64'),
      )
    }
    await evaluate(
      `pick('ลูกค้า C');inboxTest.customers[2].assigned_user_id=null;inboxTest.customers[2].bot_enabled=true;inboxTest.workspaceControl.lastInboundAt=new Date(Date.now()-86400000+2500).toISOString();window.dispatchEvent(new Event('online'));window.dispatchEvent(new CustomEvent('inbox:workspace',{detail:inboxTest.customers[2].id}))`,
    )
    await wait(`document.querySelector('[data-messenger-window]').textContent.includes('24 ชม.')`)
    await wait(
      `document.querySelector('button[aria-label="เปิด AI ตอบอัตโนมัติ"]').disabled&&!document.querySelector('[data-messenger-window]').textContent.includes('24 ชม.')`,
    )
    assert.equal(
      await evaluate(`document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').disabled`),
      true,
      'Expiry must lock the composer without a reload',
    )
    await evaluate(
      `inboxTest.workspaceControl.lastInboundAt=new Date(Date.now()-2*86400000).toISOString();inboxTest.workspaceControl.humanAgentAvailable=true;window.dispatchEvent(new CustomEvent('inbox:workspace',{detail:inboxTest.customers[2].id}));[...document.querySelectorAll('[data-chat-header] button')].find(button=>button.textContent==='ส่งแชทให้แอดมิน').click()`,
    )
    await wait(`!document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').disabled`)
    assert.equal(
      await evaluate(`!!document.querySelector('button[aria-label="ผู้ช่วยร่างข้อความ"]')`),
      false,
      'Human Agent must not expose AI drafting',
    )
    await evaluate(
      `var humanComposer=document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(humanComposer,'ตอบปัญหาลูกค้าด้วยตนเอง');humanComposer.dispatchEvent(new Event('input',{bubbles:true}))`,
    )
    await pause()
    assert.equal(
      await evaluate(`document.querySelector('button[aria-label="ส่งข้อความ"]').disabled`),
      true,
    )
    await evaluate(`document.querySelector('form label input[type="checkbox"]').click()`)
    await wait(`!document.querySelector('button[aria-label="ส่งข้อความ"]').disabled`)
    await evaluate(
      `inboxTest.workspaceControl.lastInboundAt=new Date(Date.now()-7*86400000).toISOString();window.dispatchEvent(new CustomEvent('inbox:workspace',{detail:inboxTest.customers[2].id}))`,
    )
    await wait(
      `document.querySelector('[data-messenger-window]').textContent==='หมดเวลาตอบกลับ'&&document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').disabled`,
    )
    await evaluate(
      `inboxTest.workspaceControl.lastInboundAt=new Date().toISOString();window.dispatchEvent(new CustomEvent('inbox:workspace',{detail:inboxTest.customers[2].id}))`,
    )
    await wait(
      `document.querySelector('[data-messenger-window]').textContent.includes('24 ชม.')&&!document.querySelector('textarea[aria-label="ข้อความตอบกลับ"]').disabled`,
    )
    assert.equal(await evaluate('document.querySelectorAll("[data-inbox-version=v2]").length'), 1)
    await call('Page.navigate', {
      url: require('node:url').pathToFileURL(path.join(root, 'index.html')).href + '#state-error',
    })
    await wait("location.hash==='#state-error'")
    await call('Page.reload')
    await wait(`(document.body?.textContent??"").includes('โหลดสถานะแชททดสอบไม่สำเร็จ')`)
    assert.equal(
      await evaluate(`document.querySelector('h1').textContent.includes('ศูนย์ดูแลลูกค้า')`),
      true,
      'V2 header must remain visible when state API fails',
    )
    await evaluate(
      `location.hash='';[...document.querySelectorAll('button')].find(b=>b.textContent==='ลองโหลดสถานะอีกครั้ง').click()`,
    )
    await wait(`document.querySelector('header').textContent.includes('ยังไม่อ่าน')`)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: real Chrome/React Strict Mode: live 24-hour expiry, human handover/confirmation, seven-day lock, inbound renewal, AI/ownership controls, stars/follow-up, realtime/races, bulk assignment, scroll anchors, and fitted 375/768/1024/1280/1440/1920px layouts. Offline fixtures only.',
    )
  } finally {
    socket?.close()
    browser.kill()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
