// Real QR UI in Chrome/Strict Mode. No environment secrets, Supabase or real payment services.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process')
const w=require('next/dist/compiled/webpack/webpack');w.init()
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'snapbot-payment-ui-')),cwd=process.cwd(),mock=path.join(cwd,'scripts/fixtures/payment-codes/mocks.tsx'),payload=require('promptpay-qr')('0812345678',{amount:125})
 await new Promise((resolve,reject)=>w.webpack({mode:'development',devtool:false,target:'web',entry:path.join(cwd,'scripts/fixtures/payment-codes/entry.tsx'),output:{path:root,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.json'],alias:{'@/lib/supabase/browser$':mock,'next/link$':mock,'next/navigation$':mock,'@':cwd}},plugins:[new w.webpack.DefinePlugin({__PAYMENT_QR_FIXTURE__:JSON.stringify(payload)}),new w.webpack.NormalModuleReplacementPlugin(/PaymentChannelStatus$/,mock)],module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(cwd,'scripts/inbox-browser-loader.cjs')}]},optimization:{minimize:false}},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()))
 const css=fs.readdirSync('.next/static/css').filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join('.next/static/css',f),'utf8')).join('\n')
 fs.writeFileSync(path.join(root,'index.html'),`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:"development"}};</script><script src="bundle.js"></script></body></html>`)
 const svg=require('react-dom/server').renderToStaticMarkup(require('react').createElement(require('qrcode.react').QRCodeSVG,{value:payload,size:640,marginSize:4})),upload=path.join(root,'test-only-qr.png');await require('sharp')(Buffer.from(svg)).png().toFile(upload)
 const port=19463,browser=spawn(process.argv[2]||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+path.join(root,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'})
 let socket
 try{
  let target;for(let i=0;i<100;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(target)break}catch{}await new Promise(r=>setTimeout(r,100))}if(!target)throw Error('Chrome unavailable')
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let next=0;const pending=new Map(),errors=[]
  socket.onmessage=event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails.exception?.description||r.params.exceptionDetails.text);if(r.id){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}}
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(Error('CDP timeout '+method)),15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject});socket.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'Browser expression failed');return r.result.value}
  const pause=()=>new Promise(r=>setTimeout(r,200)),wait=async expression=>{for(let i=0;i<60;i++){if(await evaluate(expression))return;await pause()}throw Error('Browser wait: '+expression+' '+JSON.stringify(errors)+' '+await evaluate('document.body.textContent.slice(0,1500)'))}
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:require('node:url').pathToFileURL(path.join(root,'index.html')).href})
  await wait(`document.querySelector('select[aria-label="บัญชีพร้อมเพย์"]')?.options.length>1`)
  await evaluate(`window.fill=(selector,value)=>{const node=document.querySelector(selector);Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}))};window.tab=id=>document.querySelector('#slip-tab-'+id).click()`)
  await evaluate(`fill('select[aria-label="บัญชีพร้อมเพย์"]','11111111-1111-4111-8111-111111111111');fill('input[aria-label="ชื่อ QR"]','QR ทดสอบออฟไลน์')`);await pause()
  await evaluate(`document.querySelector('input[type=checkbox]').click()`);await pause()
  await evaluate(`const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='สร้างและบันทึก QR');button.click();button.click();button.click()`)
  await wait('!!document.querySelector("canvas")');assert.equal(await evaluate('paymentTest.metrics.saves'),1)
  // Inspect the downloaded preview itself using the real QR decoder in Node.
  const png=Buffer.from((await evaluate('document.querySelector("canvas").toDataURL("image/png")')).split(',')[1],'base64'),raw=await require('sharp')(png).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  assert.equal(require('jsqr')(new Uint8ClampedArray(raw.data),raw.info.width,raw.info.height).data,payload)
  const downloads=path.join(root,'downloads');fs.mkdirSync(downloads)
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='ดาวน์โหลด PNG').click()`)
  for(let i=0;i<40&&!fs.readdirSync(downloads).some(file=>file.endsWith('.png'));i++)await pause()
  assert.ok(fs.readdirSync(downloads).some(file=>file.endsWith('.png')))
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='คัดลอกข้อมูล QR').click()`);await pause();assert.equal(await evaluate('paymentTest.metrics.copied'),payload)
  await evaluate(`fill('select[aria-label="วิธีเพิ่ม QR"]','import')`);await pause()
  const doc=await call('DOM.getDocument'),node=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});await call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[upload]})
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='อ่านและบันทึก QR').click()`);await wait('paymentTest.metrics.imports===1');await pause()
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='คู่มือการใช้งาน').click();[...document.querySelectorAll('button')].find(b=>b.textContent==='คู่มือการใช้งาน').click()`);assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'),1);await evaluate('document.querySelector("dialog[open]").close()')
  fs.mkdirSync('docs/screenshots',{recursive:true})
  for(const width of [375,768,1440]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:1200,deviceScaleFactor:1,mobile:width<768})
   for(const tab of ['qr','banks','history','automation','security','advanced']){
    await evaluate(`tab('${tab}')`);await pause();const dimensions=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');assert.ok(dimensions.scroll<=dimensions.width,`${tab}: ${JSON.stringify(dimensions)}`)
   }
   await evaluate(`tab('qr')`);await pause();await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('QR ทดสอบออฟไลน์')).click()`);await pause()
   const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(`docs/screenshots/payment-codes-${width}.png`,Buffer.from(screenshot.data,'base64'))
  }
  assert.deepEqual(errors,[])
  console.log('PASS: Chrome/React Strict Mode: six tabs at 375/768/1440px without page overflow, single create on triple click, image upload form, decodable QR preview, and one guide dialog. Offline mocks; no payments/messages.')
 }finally{socket?.close();browser.kill()}
})().catch(error=>{console.error(error);process.exitCode=1})
