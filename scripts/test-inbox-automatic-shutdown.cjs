const {test}=require('node:test')
const assert=require('node:assert/strict')
const load=require('./helpers/load-typescript.cjs')
const guard=load('lib/features/inbox/inbox-automation-window.ts',{'server-only':{},'@/lib/features/inbox/standard-message-window':load('lib/features/inbox/standard-message-window.ts')})
const next={NextResponse:{json:(body,options={})=>({body,status:options.status??200})}}

test('successful client expiry stops writing; failed expiry retries with backoff',async()=>{
 const fixture=ok=>{
  const effects=[],timers=[];let calls=0,changes=0
  const api=load('hooks/inbox/useInboxExpiry.ts',{
   react:{useState:()=>['',()=>{}],useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)},
   '@/lib/utils':{apiError:async()=> 'Unavailable'},
  },{AbortController,fetch:async()=>{calls++;return {ok}},setTimeout:(fn,delay)=>{timers.push({fn,delay});return 1},clearTimeout(){}})
  api.useInboxExpiry('customer',true,'inbound',async()=>{changes++})
  const cleanups=effects.map(fn=>fn()).filter(Boolean)
  return {timers,calls:()=>calls,changes:()=>changes,cleanup:()=>cleanups.forEach(fn=>fn())}
 }
 const success=fixture(true);await new Promise(resolve=>setImmediate(resolve))
 assert.equal(success.calls(),1);assert.equal(success.changes(),1);assert.equal(success.timers.length,0);success.cleanup()
 const failed=fixture(false);await new Promise(resolve=>setImmediate(resolve))
 assert.equal(failed.timers[0].delay,1000)
 await failed.timers[0].fn();await new Promise(resolve=>setImmediate(resolve))
 assert.equal(failed.timers[1].delay,2000);failed.cleanup()
})

test('automation guard allows recent inbound evidence and rejects expired, invalid, or missing evidence',async()=>{
 const day=86400000
 const fixture=timestamp=>{
  const filters=[]
  const db={from(table){
   const query={select(){return query},eq(key,value){filters.push([key,value]);return query},order(){return query},limit(){return query},
    maybeSingle:async()=>({data:table==='customers'?{tenant_id:'tenant',platform:'facebook'}:
     table==='tenants'?{page_id:'page'}:timestamp===undefined?null:{interacted_at:timestamp},error:null})}
   return query
  }}
  return {db,filters}
 }
 const recent=fixture(new Date(Date.now()-1000).toISOString())
 await guard.assertAutomationWindow(recent.db,'customer','tenant')
 assert.deepEqual(recent.filters,[['id','customer'],['id','tenant'],['is_active',true],['tenant_id','tenant'],
  ['customer_id','customer'],['page_id','page'],['kind','inbound_message']])
 for(const timestamp of [undefined,new Date(Date.now()-day).toISOString(),new Date(Date.now()+1000).toISOString(),'invalid']){
  const expired=fixture(timestamp)
  await assert.rejects(guard.assertAutomationWindow(expired.db,'customer','tenant'),error=>error.code==='MESSAGING_WINDOW_CLOSED')
 }
 const dbError=new Error('evidence lookup failed')
 const failed={from(table){const query={select(){return query},eq(){return query},order(){return query},limit(){return query},
  maybeSingle:async()=>({data:table==='customers'?{tenant_id:'tenant',platform:'facebook'}:table==='tenants'?{page_id:'page'}:null,
   error:table==='broadcast_messaging_events'?dbError:null})};return query}}
 await assert.rejects(guard.assertAutomationWindow(failed,'customer','tenant'),error=>error===dbError)
})

test('AI cannot consume quota or call the provider for an expired conversation',async()=>{
 let providers=0,reservations=0
 const errors=load('lib/features/agents/ai-errors.ts')
 const api=load('lib/features/agents/ai-agent.ts',{
  'server-only':{},'@/lib/features/agents/ai-errors':errors,
  '@/lib/features/inbox/inbox-automation-window':guard,
  '@/lib/feature-access':{hasFeature:async()=>true},
  '@google/genai':{ApiError:class extends Error{},GoogleGenAI:class{constructor(){providers++}}},
  '@/lib/features/agents/agent-control-ai':{prepareAgentGeneration:async()=>{reservations++;throw Error('Must not reserve')}},
 },{process:{env:{GEMINI_API_KEY:'offline-test-key'}},console})
 const db={rpc:async()=>({data:false,error:null}),from(table){
  const query={select(){return query},eq(){return query},order(){return query},limit(){return query},
   maybeSingle:async()=>({data:table==='customers'?{tenant_id:'tenant',platform:'facebook'}:table==='tenants'?{page_id:'page'}:
    {interacted_at:new Date(Date.now()-86400001).toISOString()},error:null})}
  return query
 }}
 await assert.rejects(api.aiReply(db,{tenantId:'tenant',customerId:'customer',shopName:'Shop'},undefined,true),error=>error.code==='MESSAGING_WINDOW_CLOSED')
 assert.equal(providers,0);assert.equal(reservations,0)
})

function deliveryFixture(allowParts=0){
 let sent=0,released=0,refunded=0,checks=0
 const statuses=[]
 const freshEvidence=()=>new Date(Date.now()-1000).toISOString()
 const expiredEvidence=()=>new Date(Date.now()-86400001).toISOString()
 const db={rpc:async name=>{
  if(name==='inbox_automation_window_open')return {data:checks++<allowParts,error:null}
  if(name==='end_inbox_delivery')released++
  return {data:'lease',error:null}
 },from(table){const q={insert(){return q},select(){return q},eq(){return q},update(value){statuses.push(value.delivery_status);return q},
  single:async()=>({data:table==='customers'?{tenant_id:'tenant'}:{id:'message'},error:null}),
  maybeSingle:async()=>({data:table==='customers'?{tenant_id:'tenant',platform:'facebook'}:
   table==='tenants'?{page_id:'page'}:table==='broadcast_messaging_events'?
    {interacted_at:checks++<allowParts?freshEvidence():expiredEvidence()}:{tenant_id:'tenant'},error:null}),
  order(){return q},limit(){return q},
  then:resolve=>Promise.resolve({error:null}).then(resolve)};return q}}
 const api=load('lib/features/slips/notify.ts',{
  'server-only':{},'@/lib/features/inbox/inbox-automation-window':guard,
  '@/lib/utils':{},'@/lib/integrations/facebook/client':{SendApiError:class extends Error{},isWindowOrTagError:()=>false,sendText:async()=>{sent++},sendMessage:async()=>{sent++}},
  '@/lib/message-quota':{sendWithMessageCredit:async(_db,_tenant,work)=>{try{return await work()}catch(error){refunded++;throw error}}},
 },{process:{env:{SNAPBOT_SAFETY_ENABLED:'false'}},console})
 return {api,db,recipient:{id:'customer',psid:'offline',token:'offline'},metrics:()=>({sent,released,refunded,checks,statuses})}
}

test('automatic replies and slip confirmations cannot bypass expiry with safety mode off',async()=>{
 for(const prefix of ['reply:','slip-confirm:','slip:']){
  const f=deliveryFixture()
  await assert.rejects(f.api.deliverOnce(f.db,f.recipient,prefix+'test','hello'),error=>error.code==='MESSAGING_WINDOW_CLOSED')
  assert.equal(f.metrics().sent,0)
  assert.deepEqual(f.metrics().statuses,['failed'])
  assert.equal(f.metrics().refunded,1)
 }
 const f=deliveryFixture(1)
 await assert.rejects(f.api.deliverRichOnce(f.db,f.recipient,'reply:multipart','two parts',[{text:'one'},{text:'two'}]),error=>error.code==='MESSAGING_WINDOW_CLOSED')
 assert.equal(f.metrics().sent,1)
 assert.deepEqual(f.metrics().statuses,['unknown'],'A partially delivered message must never be retried as wholly failed')
 assert.equal(f.metrics().released,1)
})

test('expiry endpoint enforces same origin and authorized customer scope before mutation',async()=>{
 let guarded=0,calls=0
 class InboxError extends Error{constructor(message,status){super(message);this.status=status}}
 const api=load('app/api/inbox/conversations/[id]/expiry/route.ts',{
  'next/server':next,'@/lib/features/inbox/inbox-server':{InboxError,inboxError:error=>({status:error.status??503}),checkRpc:error=>{if(error)throw error},
   inboxCustomer:async()=>{guarded++;return {customer:{id:'authorized'},db:{rpc:async(name,args)=>{calls++;assert.equal(name,'expire_inbox_automation');assert.equal(args.p_customer,'authorized');return {data:true,error:null}}}}}},
 })
 const request={nextUrl:{origin:'https://shop.test'},headers:{get:key=>key==='origin'?'https://foreign.test':null}}
 const ctx={params:Promise.resolve({id:'input'})}
 assert.equal((await api.POST(request,ctx)).status,403);assert.equal(guarded,0);assert.equal(calls,0)
 assert.equal((await api.POST({...request,headers:{get:()=>null}},ctx)).status,200);assert.equal(calls,1)
})

test('background expiry requires a server secret and runs a bounded batch',async()=>{
 let calls=0
 const deps={'node:crypto':require('node:crypto'),'next/server':next,'@/lib/supabase/server':{supabaseAdmin:()=>({rpc:async(name,args)=>{calls++;assert.equal(name,'expire_inbox_automation_windows');assert.equal(args.p_limit,500);return {data:3,error:null}}})}}
 const api=load('app/api/cron/inbox-windows/route.ts',deps,{Buffer,process:{env:{CRON_SECRET:'test-secret'}}})
 assert.equal((await api.POST({headers:{get:()=>null}})).status,401);assert.equal(calls,0)
 const result=await api.POST({headers:{get:()=> 'Bearer test-secret'}})
 assert.equal(result.status,200);assert.equal(result.body.paused,3);assert.equal(calls,1)
})
