// Real React/Chrome offline integration. Every API and Supabase operation uses test fixtures.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process')
const webpackModule=require('next/dist/compiled/webpack/webpack');webpackModule.init()
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'snapbot-inbox-pro-')),cwd=process.cwd(),mock=path.join(cwd,'scripts/fixtures/inbox-pro/mocks.tsx')
 await new Promise((resolve,reject)=>webpackModule.webpack({mode:'development',devtool:false,target:'web',entry:path.join(cwd,'scripts/fixtures/inbox-pro/entry.tsx'),output:{path:root,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.json'],alias:{'@/lib/supabase/browser$':mock,'next/link$':mock,'next/navigation$':mock,'@':cwd}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(cwd,'scripts/inbox-browser-loader.cjs')}]},optimization:{minimize:false}},(error,stats)=>{if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve()}))
 const css=fs.readdirSync('.next/static/css').filter(name=>name.endsWith('.css')).map(name=>fs.readFileSync(path.join('.next/static/css',name),'utf8')).join('\n')
 fs.writeFileSync(path.join(root,'index.html'),`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root" style="height:100dvh"></div><script src="bundle.js"></script></body></html>`)
 const port=19453,exe=process.argv[2]||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
 const browser=spawn(exe,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+path.join(root,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'})
 let socket
 try{
  let target
  for(let i=0;i<100;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(target)break}catch{}await new Promise(r=>setTimeout(r,100))}
  if(!target)throw Error('Chrome unavailable')
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let next=0;const pending=new Map(),errors=[]
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);if(value.id){const handler=pending.get(value.id);pending.delete(value.id);if(value.error)handler.reject(Error(value.error.message));else handler.resolve(value.result)}}
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>reject(Error('CDP timeout '+method)),15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject});socket.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||'Browser expression failed');return result.result.value}
  const pause=()=>new Promise(r=>setTimeout(r,200))
  const wait=async expression=>{for(let i=0;i<60;i++){if(await evaluate(expression))return;await pause()}throw Error('Browser assertion timeout: '+expression)}
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  await call('Page.navigate',{url:require('node:url').pathToFileURL(path.join(root,'index.html')).href})
  await wait('document.body.textContent.includes("ศูนย์บริหารแชทและทีมแอดมิน")')
  await evaluate(`window.pick=name=>[...document.querySelectorAll('aside[aria-label="รายชื่อแชท"] button')].find(button=>button.textContent.includes(name)).click()`)
  await pause()
  const reads=await evaluate('inboxTest.metrics.threadReads')
  await evaluate(`pick('ลูกค้า B');pick('ลูกค้า B');pick('ลูกค้า B')`);await pause()
  assert.equal(await evaluate('inboxTest.metrics.threadReads'),reads+1)
  assert.equal(await evaluate(`document.querySelectorAll('aside[aria-label="รายชื่อแชท"] button[aria-current="true"]').length`),1)
  await evaluate(`pick('ลูกค้า A');new Promise(resolve=>setTimeout(resolve,10))`)
  await evaluate(`pick('ลูกค้า B');new Promise(resolve=>setTimeout(resolve,10))`)
  await evaluate(`pick('ลูกค้า C')`);await pause()
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="inbox-thread"] h2')[0].textContent`),'ลูกค้า C')
  assert.ok(!(await evaluate(`document.querySelector('[data-testid="inbox-thread"]').textContent`)).includes('ข้อความของ ลูกค้า A'))
  await evaluate('inboxTest.replay();inboxTest.replay();inboxTest.reconnect()');await pause()
  assert.equal(await evaluate(`document.querySelector('[data-testid="inbox-thread"]').textContent.split('ข้อความของ ลูกค้า C').length-1`),1)
  assert.equal(await evaluate('inboxTest.metrics.channels.size'),2)
  await evaluate(`const claim=[...document.querySelectorAll('[data-testid="inbox-thread"] button')].find(button=>button.textContent==='รับแชท');claim.click();claim.click();claim.click()`);await pause()
  assert.equal(await evaluate('inboxTest.metrics.mutations'),1)
  await evaluate(`[...document.querySelectorAll('[data-testid="inbox-thread"] button')].find(button=>button.textContent==='ปิดแชท').click()`)
  await pause()
  await evaluate(`const reason=document.querySelector('textarea[aria-label="เหตุผลปิดแชท"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(reason,'ปิดงานทดสอบเท่านั้น');reason.dispatchEvent(new Event('input',{bubbles:true}))`)
  await pause()
  await evaluate(`const close=[...document.querySelectorAll('button')].find(button=>button.textContent==='ยืนยันปิดแชท');close.click();close.click();close.click()`);await pause()
  assert.equal(await evaluate('inboxTest.metrics.mutations'),2)
  await evaluate(`const reopen=[...document.querySelectorAll('button')].find(button=>button.textContent==='เปิดแชทใหม่');reopen.click();reopen.click();reopen.click()`);await pause()
  assert.equal(await evaluate('inboxTest.metrics.mutations'),3)
  assert.equal(await evaluate(`[...document.querySelectorAll('[data-testid="inbox-thread"] button')].some(button=>button.textContent==='ปิดแชท')`),true)
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="status"]')].filter(node=>node.textContent==='บันทึกสถานะแชทแล้ว').length`),1)
  assert.equal(await evaluate(`document.querySelectorAll('nav[aria-label="ส่วนการทำงานของกล่องข้อความ"] button').length`),9)
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='คู่มือการใช้งาน').click();[...document.querySelectorAll('button')].find(button=>button.textContent==='คู่มือการใช้งาน').click()`)
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'),1)
  await evaluate('document.querySelector("dialog[open]").close()')
  assert.equal(await evaluate('document.querySelectorAll("[data-testid=inbox-thread]").length'),1)
  assert.equal(await evaluate(`document.querySelectorAll('aside[aria-label="รายละเอียดลูกค้าและสลิป"]').length`),1)
  fs.mkdirSync('docs/screenshots',{recursive:true})
  for(const width of [375,768,1440]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<768});await pause()
   const dimensions=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');assert.ok(dimensions.scroll<=dimensions.width,JSON.stringify(dimensions))
   const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(`docs/screenshots/inbox-pro-${width}.png`,Buffer.from(screenshot.data,'base64'))
  }
  assert.deepEqual(errors,[])
  console.log('PASS: real Chrome/React Strict Mode: repeated selection, rapid A-B-C, stale responses, event replay, reconnect, channel cleanup, triple claim, single guide dialog, and 375/768/1440px layouts. Offline fixtures only.')
 }finally{socket?.close();browser.kill()}
})().catch(error=>{console.error(error);process.exitCode=1})
