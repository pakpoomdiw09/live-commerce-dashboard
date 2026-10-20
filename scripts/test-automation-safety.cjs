const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,deps={},env={}){const context={exports:{},console,process:{env},Date,require:n=>{if(n in deps)return deps[n];throw Error('Unexpected dependency '+n)}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports}
const tenant='11111111-1111-4111-8111-111111111111'
function safetyFixture(env,row,error=null){const filters=[];let reads=0;const db={from(table){reads++;assert.equal(table,'tenant_automation_controls');const q={select:()=>q,eq:(...args)=>{filters.push(args);return q},maybeSingle:async()=>({data:row,error})};return q}};return {api:load('lib/automation-safety.ts',{'server-only':{}},env),db,filters,reads:()=>reads}}
test('disabled safety never reads optional tables; global stop always wins',async()=>{
 for(const [env,stopped]of [[{},false],[{AGENT_CONTROL_KILL_SWITCH:'true'},true]]){const f=safetyFixture(env,null);assert.equal(await f.api.automationStopped(f.db,tenant),stopped);assert.equal(f.reads(),0)}
})
test('tenant stop is uncached, tenant scoped, and denies known stops and database failures',async()=>{
 for(const [row,stopped]of [[null,false],[{stopped:false},false],[{stopped:true},true]]){const f=safetyFixture({SNAPBOT_SAFETY_ENABLED:'true'},row);assert.equal(await f.api.automationStopped(f.db,tenant),stopped);assert.deepEqual(f.filters[0],['tenant_id',tenant]);if(stopped)await assert.rejects(f.api.assertAutomationRunning(f.db,tenant),e=>e.code==='AUTOMATION_STOPPED')}
 const f=safetyFixture({SNAPBOT_SAFETY_ENABLED:'true'},null,{code:'42P01'});await assert.rejects(f.api.automationStopped(f.db,tenant),/UNAVAILABLE/)
})
test('canonical states adapt legacy values and unknown payments require review',()=>{
 const d=load('lib/domain-state.ts')
 assert.equal(d.paymentState('valid'),'SUCCESS');assert.equal(d.paymentState('duplicate'),'DUPLICATE');assert.equal(d.paymentState('amount_mismatch'),'PENDING_ADMIN');assert.equal(d.paymentState('unexpected'),'PENDING_ADMIN')
 assert.equal(d.orderState('approved'),'PAID');assert.equal(d.orderState('shipped'),'SHIPPED');assert.equal(d.orderState('unexpected'),null)
 assert.equal(d.conversationState({bot_enabled:false,assigned_user_id:'admin'}),'HUMAN_TAKEN_OVER');assert.equal(d.conversationState({bot_enabled:true,assigned_user_id:'admin',agent_opted_out:true}),'PAUSED')
})
test('text AI does not start while stopped and discards a response when stop occurs during generation',async()=>{
 for(const initialStop of [true,false]){
  let stopped=initialStop,calls=0
  const safety={assertAutomationRunning:async()=>{if(stopped)throw Error('AUTOMATION_STOPPED')}}
  class ApiError extends Error{}
  const ai=load('lib/features/agents/ai-agent.ts',{'server-only':{},'@/lib/feature-access':{hasFeature:async()=>true},'@/lib/automation-safety':safety,'@google/genai':{ApiError,GoogleGenAI:class{constructor(){this.models={generateContent:async()=>{calls++;stopped=true;return {text:'must be discarded'}}}}}}},{SNAPBOT_SAFETY_ENABLED:'true',GEMINI_API_KEY:'fake-test-only'})
  const db={from(){const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:[],error:null})};return q}}
  assert.equal(await ai.aiReply(db,{tenantId:tenant,customerId:'test',shopName:'test',customerName:null,instructions:null},[{role:'user',text:'hello'}]),null)
  assert.equal(calls,initialStop?0:1)
 }
})
test('automatic delivery rechecks stop before network and releases its lease without sending',async()=>{
 let sends=0,releases=0,refunds=0;const statuses=[]
 const db={rpc:async name=>{if(name==='end_inbox_delivery')releases++;return {data:'lease',error:null}},from(table){const q={insert:()=>q,select:()=>q,eq:()=>q,update:value=>{statuses.push(value.delivery_status);return q},single:async()=>({data:table==='customers'?{tenant_id:tenant}:{id:'message'},error:null}),maybeSingle:async()=>({data:{tenant_id:tenant},error:null}),then:(resolve,reject)=>Promise.resolve({error:null}).then(resolve,reject)};return q}}
 const notify=load('lib/features/slips/notify.ts',{'server-only':{},'@/lib/integrations/facebook/client':{SendApiError:class extends Error{},isWindowOrTagError:()=>false,sendText:async()=>{sends++}},'@/lib/automation-safety':{assertAutomationRunning:async()=>{throw Object.assign(Error('stopped'),{code:'AUTOMATION_STOPPED'})}},'@/lib/message-quota':{sendWithMessageCredit:async(db,tenant,work)=>{try{await work()}catch(error){refunds++;throw error}}}},{SNAPBOT_SAFETY_ENABLED:'true'})
 await assert.rejects(notify.deliverOnce(db,{id:'customer',token:'fake',psid:'test'},'reply:test','hello'),e=>e.code==='AUTOMATION_STOPPED')
 assert.equal(sends,0);assert.equal(releases,1);assert.equal(refunds,1);assert.deepEqual(statuses,['failed'])
})
const next={NextResponse:{json:(body,options={})=>({body,status:options.status??200})}}
class InboxError extends Error{constructor(message,status=400){super(message);this.status=status}}
const errors={InboxError,inboxError:e=>({body:{error:e.message},status:e.status??503}),checkRpc:e=>{if(e)throw e}}
test('stop API rejects non-owner/anonymous/foreign access before reading or writing controls',async()=>{
 for(const status of [401,403,404]){let calls=0;const route=load('app/api/automation-safety/route.ts',{'next/server':next,'@/lib/features/inbox/inbox-server':errors,'@/lib/features/slips/slip-bank-server':{slipBankTenant:async()=>{throw new InboxError('blocked',status)}},'@/lib/automation-safety':{automationSafetyEnabled:()=>true,automationStopped:()=>{calls++;throw Error('No reads')}}},{SNAPBOT_SAFETY_ENABLED:'true'});for(const method of ['GET','PATCH'])assert.equal((await route[method]({nextUrl:{searchParams:new URLSearchParams({tenantId:tenant})}})).status,status);assert.equal(calls,0)}
})
test('stop API uses server tenant and actor, validates booleans and cannot override global stop',async()=>{
 const writes=[];const route=load('app/api/automation-safety/route.ts',{'next/server':next,'@/lib/features/inbox/inbox-server':errors,'@/lib/features/slips/slip-bank-server':{slipBankTenant:async()=>({tenantId:tenant,actor:{id:'server-user'},db:{rpc:async(name,args)=>{writes.push({name,args});return {error:null}}}})},'@/lib/automation-safety':{automationSafetyEnabled:()=>true}},{AGENT_CONTROL_KILL_SWITCH:'true'})
 const request=input=>({nextUrl:{searchParams:new URLSearchParams({tenantId:tenant})},json:async()=>input})
 assert.equal((await route.PATCH(request({stopped:'true',reason:'test'}))).status,400)
 assert.equal((await route.PATCH(request({stopped:false,reason:'resume'}))).status,409)
 assert.equal((await route.PATCH(request({stopped:true,reason:'test',actor:'forged',tenantId:'forged'}))).status,200)
 assert.equal(writes.length,1);assert.equal(writes[0].args.p_actor,'server-user');assert.equal(writes[0].args.p_tenant,tenant)
})
