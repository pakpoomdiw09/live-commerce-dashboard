const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,deps={},env={}){const context={exports:{},process:{env},console,TextEncoder,TextDecoder,Buffer,Uint8ClampedArray,File,require:name=>{if(name in deps)return deps[name];throw Error(name)}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports}
const core=load('lib/payment-codes-core.ts'),image=load('lib/vision-image.ts',{'server-only':{}})
const account={id:'account',bank_code:'PROMPTPAY',account_name:'Offline test only',account_number:'0812345678',is_active:true}
class InboxError extends Error{constructor(message,status=400){super(message);this.status=status}}
function server(overrides={},env={}){return load('lib/payment-codes-server.ts',{'server-only':{},'./slip-bank-server':{},'./feature-access':{},'./inbox-server':{InboxError},'./vision-image':image,'sharp':{default:require('sharp')},'jsqr':{default:require('jsqr')},'promptpay-qr':{default:require('promptpay-qr')},'./payment-codes-core':core,...overrides},env)}
test('real PromptPay library produces matching open/fixed QR for supported registered identifiers',()=>{
 for(const number of ['0812345678','1234567890123','123456789012345'])for(const amount of [null,1,12500,9999999999]){const a={...account,account_number:number},payload=server().createReceivingQr(a,amount),decoded=core.codeMatchesAccount(payload,a);assert.equal(decoded.recipient,number);assert.equal(decoded.amountSatang,amount)}
 for(const a of [{...account,is_active:false},{...account,bank_code:'KBANK'}])assert.throws(()=>server().createReceivingQr(a,null))
})
test('strict satang validation never rounds and QR rejects URLs, corrupt CRC, foreign receiver and unsupported format',()=>{
 assert.equal(core.receivingAmount('0.01'),1);assert.equal(core.receivingAmount('125.50'),12550);assert.equal(core.receivingAmount(''),null)
 for(const value of ['1.001','-1','0','1e3','Infinity',NaN,{},'100000000'])assert.throws(()=>core.receivingAmount(value))
 const payload=server().createReceivingQr(account,12500)
 assert.throws(()=>core.parseReceivingQr(payload.slice(0,-1)+(payload.endsWith('0')?'1':'0')))
 assert.throws(()=>core.parseReceivingQr('https://example.test/payment'))
 assert.throws(()=>core.codeMatchesAccount(payload,{...account,account_number:'0899999999'}))
})
test('QR import really decodes PNG/JPEG, compares recipient/amount and rejects non-image/blank files',async()=>{
 const payload=server().createReceivingQr(account,12500),png=await require('sharp')(Buffer.from(require('react-dom/server').renderToStaticMarkup(require('react').createElement(require('qrcode.react').QRCodeSVG,{value:payload,size:640,marginSize:4})))).png().toBuffer(),jpeg=await require('sharp')(png).jpeg().toBuffer()
 for(const [bytes,mime]of [[png,'image/png'],[jpeg,'image/jpeg']]){const decoded=await server().decodeReceivingQr(new File([bytes],'offline-qr',{type:mime}));assert.equal(decoded,payload);assert.equal(core.codeMatchesAccount(decoded,account).amountSatang,12500)}
 await assert.rejects(server().decodeReceivingQr(new File(['<svg/>'],'spoof.png',{type:'image/png'})))
 const blank=await require('sharp')({create:{width:100,height:100,channels:4,background:'#fff'}}).png().toBuffer()
 await assert.rejects(server().decodeReceivingQr(new File([blank],'blank.png',{type:'image/png'})),/QR/)
})
test('QR guard denies anonymous/staff/cross-tenant and locked packages before any payment work',async()=>{
 for(const status of [401,403,404]){const api=server({'./slip-bank-server':{slipBankTenant:async()=>{throw new InboxError('denied',status)}}},{PAYMENT_CHANNELS_ENABLED:'true'});await assert.rejects(api.receivingCodeTenant({},'tenant'),error=>error.status===status)}
 for(const enabled of [false,true]){let calls=0;const api=server({'./slip-bank-server':{slipBankTenant:async()=>({db:{},tenantId:'tenant'})},'./feature-access':{hasFeature:async()=>{calls++;return false}}},{PAYMENT_CHANNELS_ENABLED:enabled?'true':'false'});await assert.rejects(api.receivingCodeTenant({},'tenant'),error=>error.status===(enabled?403:409));assert.equal(calls,enabled?1:0)}
})
