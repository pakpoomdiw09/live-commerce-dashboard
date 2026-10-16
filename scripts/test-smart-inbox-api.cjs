const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,deps,env={}){const context={exports:{},console,Date,Map,crypto,process:{env},require:n=>{if(n in deps)return deps[n];throw Error('Unexpected dependency '+n)}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports}
const next={NextResponse:{json:(body,options={})=>({body,status:options.status??200})}}
const id='11111111-1111-4111-8111-111111111111',shop='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444'
const utils={UUID:/^[a-f0-9-]{36}$/}
function guardFixture({actor={kind:'user',id:user},member=true,allowed=true}={}){
 const columns=[];let clients=0
 const db={from(){const q={select(value){columns.push(value);return q},eq(){return q},maybeSingle:async()=>({data:{id,tenant_id:shop},error:null})};return q}}
 const guard=load('lib/inbox-server.ts',{'server-only':{},'next/server':next,'@/lib/auth':{getActor:async()=>actor,canAccessTenant:async()=>member},'@/lib/supabase/server':{supabaseAdmin:()=>{clients++;return db}},'@/lib/feature-access':{hasFeature:async()=>allowed},'@/lib/types':{CUSTOMER_COLUMNS:'PRIVATE_CUSTOMER_DETAILS'},'@/lib/utils':utils})
 return {guard,columns,clients:()=>clients}
}
test('Inbox session guard refuses anonymous/internal callers before service-role data access',async()=>{
 for(const actor of [null,{kind:'internal'}]){const f=guardFixture({actor});await assert.rejects(f.guard.inboxCustomer({},id),e=>e.status===401);assert.equal(f.clients(),0)}
})
test('foreign tenants and locked packages cannot load customer details',async()=>{
 for(const opts of [{member:false},{allowed:false}]){const f=guardFixture(opts);await assert.rejects(f.guard.inboxCustomer({},id),e=>[403,404].includes(e.status));assert.deepEqual(f.columns,['tenant_id'])}
})
test('private attachment API denies foreign tenants before creating signed URLs',async()=>{
 let signed=0
 const db={from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{tenant_id:shop,path:'private'},error:null})}),storage:{from:()=>({createSignedUrl:async()=>{signed++;throw Error('Must not sign')}})}}
 const f=guardFixture()
 const api=load('app/api/inbox/media/[id]/route.ts',{'next/server':next,'@/lib/inbox-server':f.guard,'@/lib/auth':{getActor:async()=>({kind:'user',id:user}),canAccessTenant:async()=>false},'@/lib/supabase/server':{supabaseAdmin:()=>db},'@/lib/utils':utils})
 const result=await api.GET({},{params:Promise.resolve({id})});assert.equal(result.status,404);assert.equal(signed,0)
})
const guard=guardFixture().guard
class SendApiError extends Error{constructor(status=400){super('rejected');this.status=status;this.code=10}}
function sendFixture({previous=null,leaseError=null,providerError=null,old=false,missingToken=false,safety=false}={}){
 let sends=0,inserts=0,releases=0,stored=previous;const statuses=[],rpcCalls=[]
 const db={rpc:async(name,args)=>{rpcCalls.push({name,args});if(name==='end_inbox_delivery'){releases++;return {error:null}}return {data:'lease',error:leaseError}},from(table){let payload,filter={};const q={
  select(){return q},eq(key,value){filter[key]=value;return q},order(){return q},limit(){return q},
  insert(value){payload=value;inserts++;return q},update(value){statuses.push(value.delivery_status);return q},
  maybeSingle:async()=>({data:filter.external_id?stored:{created_at:new Date(Date.now()-(old?90000000:1000)).toISOString()},error:null}),
  single:async()=>{if(table==='tenants')return {data:{page_id:'page',page_access_token:missingToken?null:'secret'},error:null};if(stored)return {error:{code:'23505'}};stored={id,delivery_status:payload.delivery_status};return {data:{id},error:null}},
  then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject)},
 };return q}}
 const api=load('app/api/messages/send/route.ts',{'next/server':next,'@/lib/inbox-server':{...guard,inboxCustomer:async()=>({db,actor:{id:user,kind:'user'},customer:{id,tenant_id:shop,platform_user_id:'psid',conversation_version:7},tenantId:shop})},'@/lib/facebook':{pageTokenFor:p=>p.page_access_token,SendApiError,isWindowOrTagError:e=>e instanceof SendApiError,sendMessageWithReceipt:async()=>{sends++;if(providerError)throw providerError;return 'mid-real'}},'@/lib/utils':utils},{SNAPBOT_SAFETY_ENABLED:safety?'true':'false'})
 const send=(extra={})=>api.POST({json:async()=>({customerId:id,clientId:requestId,text:'Hello',...extra})})
 return {send,statuses,rpcCalls,sends:()=>sends,inserts:()=>inserts,releases:()=>releases}
}

test('safety flag claims human ownership atomically with server actor/version before sending',async()=>{
 const f=sendFixture({safety:true});assert.equal((await f.send({version:999,actor:'forged'})).status,200)
 assert.equal(f.rpcCalls[0].name,'claim_and_start_inbox_reply');assert.deepEqual(JSON.parse(JSON.stringify(f.rpcCalls[0].args)),{p_customer:id,p_actor:user,p_version:7});assert.equal(f.sends(),1)
 const conflict=sendFixture({safety:true,leaseError:{code:'40001'}});assert.equal((await conflict.send()).status,409);assert.equal(conflict.sends(),0);assert.equal(conflict.inserts(),0)
})
test('successful send saves provider receipt and releases the delivery lease',async()=>{
 const f=sendFixture();assert.equal((await f.send()).status,200);assert.equal(f.sends(),1);assert.deepEqual(f.statuses,['sent']);assert.equal(f.releases(),1)
})
test('duplicate successful requests never call Messenger twice',async()=>{
 const f=sendFixture({previous:{id,delivery_status:'sent'}});const result=await f.send();assert.equal(result.status,200);assert.equal(result.body.duplicate,true);assert.equal(f.sends(),0);assert.equal(f.inserts(),0)
})
test('concurrent client IDs produce one network send at most',async()=>{
 const f=sendFixture();const results=await Promise.all([f.send(),f.send()]);assert.equal(f.sends(),1);assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
})
test('pending/failed/unknown requests cannot be retried with the same durable ID',async()=>{
 for(const status of ['pending','failed','unknown']){const f=sendFixture({previous:{id,delivery_status:status}});assert.equal((await f.send()).status,409);assert.equal(f.sends(),0)}
})
test('unclaimed conversations, outside-24h messages, missing token and invalid payload never send',async()=>{
 for(const opts of [{leaseError:{code:'42501'}},{old:true},{missingToken:true}]){const f=sendFixture(opts);assert.ok((await f.send()).status>=400);assert.equal(f.sends(),0);assert.equal(f.inserts(),0)}
 const f=sendFixture();assert.equal((await f.send({mediaId:id})).status,400);assert.equal(f.sends(),0)
})
test('provider rejection stays failed; ambiguous network timeout stays unknown; both release leases',async()=>{
 for(const [providerError,status]of [[new SendApiError(),'failed'],[Error('timeout'),'unknown']]){const f=sendFixture({providerError});const result=await f.send();assert.equal(result.status,502);assert.deepEqual(f.statuses,[status]);assert.equal(f.releases(),1);assert.equal(f.inserts(),1)}
})
test('all new Inbox entry points reject a failed guard before data, mutation or provider work',async()=>{
 const guarded={...guard,inboxTenant:async()=>{throw new guard.InboxError('locked',403,'FEATURE_LOCKED')},inboxCustomer:async()=>{throw new guard.InboxError('locked',403,'FEATURE_LOCKED')}}
 for(const [file,methods]of [['app/api/inbox/state/route.ts',['GET']],['app/api/inbox/conversations/route.ts',['GET']],['app/api/inbox/search/route.ts',['GET']],['app/api/inbox/media/route.ts',['POST']],['app/api/inbox/conversations/[id]/messages/route.ts',['GET']],['app/api/inbox/conversations/[id]/read/route.ts',['POST']],['app/api/inbox/conversations/[id]/route.ts',['GET','PATCH']],['app/api/inbox/conversations/[id]/draft/route.ts',['POST']]]){
  const api=load(file,{'next/server':next,'@/lib/inbox-server':guarded,'@/lib/types':{},'@/lib/utils':utils,'@/lib/feature-access':{hasFeature(){throw Error('No provider work')}},'@/lib/ai-agent':{AiAgentError:class extends Error{}}})
  for(const method of methods){const result=await api[method]({nextUrl:{searchParams:new URLSearchParams({tenantId:shop})}},{params:Promise.resolve({id})});assert.equal(result.status,403,file);assert.equal(result.body.code,'FEATURE_LOCKED')}
 }
})
