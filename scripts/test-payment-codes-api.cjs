const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,deps={}){const context={exports:{},console,TextEncoder,TextDecoder,File,FormData,require:name=>{if(name in deps)return deps[name];throw Error(name)}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);return context.exports}
const core=load('lib/payment-codes-core.ts'),id='11111111-1111-4111-8111-111111111111',orderId='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333'
class InboxError extends Error{constructor(message,status=400){super(message);this.status=status}}
function fixture({deny=0,paid=false}={}){
 const calls=[],queries=[];let decodes=0
 const account={id,bank_code:'PROMPTPAY',account_name:'Offline owner',account_number:'0812345678',is_active:true},payload=require('promptpay-qr')('0812345678',{amount:125})
 const db={rpc:async(name,args)=>{calls.push({name,args});return {data:key,error:null}},from(table){const filters=[];queries.push({table,filters});const q={select:()=>q,eq:(...args)=>{filters.push(args);return q},order:()=>q,limit:()=>q,in:()=>q,maybeSingle:async()=>({data:table==='bank_accounts'?account:{id:orderId,amount:125,status:paid?'paid':'pending_payment'},error:null}),then(resolve,reject){const rows=table==='bank_accounts'?[account]:table==='payment_receiving_codes'?[{id:key,account_id:id,label:'Test',payload,recipient_snapshot:account.account_number,amount_satang:12500,order_id:orderId,is_active:true}]:table==='orders'?[{id:orderId,amount:125,status:paid?'paid':'pending_payment'}]:[];return Promise.resolve({data:rows,error:null}).then(resolve,reject)}};return q}}
 const route=load('app/api/payment-codes/route.ts',{'next/server':{NextResponse:{json:body=>({status:200,body})}},'@/lib/payment-codes-server':{receivingCodeTenant:async()=>{if(deny)throw new InboxError('denied',deny);return {db,tenantId:'server-shop',actor:{id:'server-owner'}}},createReceivingQr:(a,amount)=>{const p=require('promptpay-qr')(a.account_number,amount===null?{}:{amount:amount/100});core.codeMatchesAccount(p,a);return p},decodeReceivingQr:async()=>{decodes++;return payload}},'@/lib/payment-codes-core':core,'@/lib/inbox-server':{InboxError,inboxError:error=>({status:error.status??503,body:{error:error.message}}),checkRpc:error=>{if(error)throw error}},'@/lib/utils':{UUID:/^[a-f0-9-]{36}$/}})
 const request=(body={},origin='https://test.local')=>({nextUrl:new URL('https://test.local/api/payment-codes?tenantId=server-shop'),headers:new Headers({origin,'Content-Type':'application/json'}),json:async()=>body})
 const body={accountId:id,requestId:key,label:'Offline QR',mode:'generate',amount:'999',orderId,confirmed:true,tenantId:'forged',actor:'forged',status:'paid'}
 return {route,calls,queries,request,body,payload,decodes:()=>decodes}
}
test('anonymous, staff, foreign tenant and locked plans cannot read/create/toggle codes before any DB or decoding',async()=>{
 for(const deny of [401,403,404,409]){const f=fixture({deny});for(const method of ['GET','POST','PATCH'])assert.equal((await f.route[method](f.request(f.body))).status,deny);assert.equal(f.calls.length,0);assert.equal(f.queries.length,0);assert.equal(f.decodes(),0)}
})
test('order QR always derives amount, tenant and actor from server; creating QR has no payment side effects',async()=>{
 const f=fixture();const result=await f.route.POST(f.request(f.body));assert.equal(result.status,200);assert.equal(result.body.paymentVerified,false);assert.equal(f.calls.length,1)
 const {name,args}=f.calls[0];assert.equal(name,'save_payment_receiving_code');assert.equal(args.p_tenant,'server-shop');assert.equal(args.p_actor,'server-owner');assert.equal(args.p_amount,12500);assert.equal(args.p_recipient,'0812345678');assert.equal(core.parseReceivingQr(args.p_payload).amountSatang,12500)
 for(const query of f.queries)assert.ok(query.filters.some(([key,value])=>key==='tenant_id'&&value==='server-shop'))
 assert.equal((await fixture({paid:true}).route.POST(f.request(f.body))).status,409)
})
test('invalid origin/confirmation/amount and forged payload cannot bypass generation checks',async()=>{
 const f=fixture();assert.equal((await f.route.POST(f.request(f.body,'https://attacker.test'))).status,403)
 assert.equal((await f.route.POST(f.request({...f.body,confirmed:false}))).status,400)
 assert.equal((await f.route.POST(f.request({...f.body,amount:'1.001',orderId:''}))).status,400)
 assert.equal(f.calls.length,0)
 const result=await f.route.POST(f.request({...f.body,payload:'forged qr'}));assert.equal(result.status,200);assert.notEqual(f.calls[0].args.p_payload,'forged qr')
})
test('GET hides payload for paid orders and never returns receiver snapshot; all queries are tenant scoped',async()=>{
 for(const paid of [false,true]){const f=fixture({paid}),result=await f.route.GET(f.request());assert.equal(result.status,200);assert.equal(result.body.codes[0].available,!paid);assert.equal(result.body.codes[0].payload,paid?null:f.payload);assert.equal('recipient_snapshot' in result.body.codes[0],false);for(const query of f.queries)assert.ok(query.filters.some(([key,value])=>key==='tenant_id'&&value==='server-shop'))}
})
test('multipart import only accepts a file and stores decoded QR metadata without verifying payment',async()=>{
 const f=fixture(),form=new FormData()
 for(const [name,value]of Object.entries({...f.body,mode:'import',amount:''}))form.set(name,String(value))
 form.set('file',new File(['decoder-stub-only'],'test.png',{type:'image/png'}))
 const request=f.request();request.headers.set('Content-Type','multipart/form-data');request.formData=async()=>form
 const result=await f.route.POST(request);assert.equal(result.status,200);assert.equal(result.body.paymentVerified,false);assert.equal(f.decodes(),1);assert.equal(f.calls[0].args.p_source,'imported');assert.equal(f.calls[0].args.p_amount,12500)
})
test('six receiving tabs remain on /slips and legacy two-tab rollback is preserved',()=>{
 const jsx=require('react/jsx-runtime'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
 const guide=load('components/slips/PaymentChannelsGuide.tsx',{'react':React,'react/jsx-runtime':jsx})
 const {SlipTabs}=load('components/slips/SlipTabs.tsx',{'react/jsx-runtime':jsx,'next/link':{default:({href,children,scroll,...props})=>React.createElement('a',{href,...props},children)},'lucide-react':require('lucide-react'),'./PaymentChannelsGuide':guide})
 const html=renderToStaticMarkup(React.createElement(SlipTabs,{activeTab:'qr',extended:true}));assert.equal((html.match(/role="tab"/g)||[]).length,6);for(const tab of ['qr','banks','history','automation','security','advanced'])assert.ok(html.includes('/slips?tab='+tab))
 const legacy=renderToStaticMarkup(React.createElement(SlipTabs,{activeTab:'overview'}));assert.equal((legacy.match(/role="tab"/g)||[]).length,2)
})
