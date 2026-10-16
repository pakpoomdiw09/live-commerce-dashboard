// Real component handlers with mock React/Supabase. No .env, network or database writes.
const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
const requests={};vm.runInNewContext(compile('lib/inbox-request.ts'),{exports:requests,Map,AbortController})
const helpers={};vm.runInNewContext(compile('lib/inbox-realtime.ts'),{exports:helpers,Map})
const message=(id,customer_id='customer-a',body=id)=>({id,customer_id,body,sender:'customer',attachments:null,created_at:`2026-10-15T00:00:${id==='one'?'01':'02'}Z`})
const flush=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(){
 const a={id:'customer-a',tenant_id:'shop-a',last_message_at:'2026-10-15T00:00:01Z'},b={id:'customer-b',tenant_id:'shop-b',last_message_at:'2026-10-15T00:00:01Z'}
 const customers=[a,b],messages=[message('one')],queries=[],listeners=[],effects=[],states=[],intervals=[],removed=[]
 const browserListeners=new Map(),documentListeners=new Map()
 let stateIndex=0,subscribe,channelName,cleaned=false
 const db={from(table){
  const record={table,filters:[]};queries.push(record)
  const q={abortSignal(){return q},select(){return q},order(){return q},limit(){return q},eq(key,value){record.filters.push([key,value]);return q},
   result(){let data=(table==='customers'?customers.map(customer=>({...customer,messages:messages.filter(m=>m.customer_id===customer.id).slice(-1),slips:[]})):table==='messages'?messages:[]).filter(row=>record.filters.every(([key,value])=>key==='customers.tenant_id'?customers.find(c=>c.id===row.customer_id)?.tenant_id===value:key.includes('.')?true:row[key]===value));return {data,error:null}},
   async maybeSingle(){const result=q.result();return {data:result.data[0]??null,error:null}},then(resolve,reject){return Promise.resolve(q.result()).then(resolve,reject)}};return q
 },channel(name){channelName=name;const channel={on(_kind,filter,handler){listeners.push({filter,handler});return channel},subscribe(callback){subscribe=callback;return channel}};return channel},async removeChannel(){cleaned=true}}
 const react={useMemo:fn=>fn(),useCallback:fn=>fn,useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),useState:initial=>{const index=stateIndex++;states[index]=initial;return [initial,value=>{states[index]=typeof value==='function'?value(states[index]):value}]}}
 const mod={}
 vm.runInNewContext(compile('components/inbox/InboxClient.tsx'),{exports:mod,console,Map,Set,
  setInterval:fn=>{intervals.push(fn);return 7},clearInterval:id=>removed.push(id),
  window:{addEventListener:(key,fn)=>browserListeners.set(key,fn),removeEventListener:key=>browserListeners.delete(key)},
  document:{visibilityState:'visible',addEventListener:(key,fn)=>documentListeners.set(key,fn),removeEventListener:key=>documentListeners.delete(key)},
  require:name=>{
   if(name==='react')return react
   if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}
   if(name==='@/lib/supabase/browser')return {supabaseBrowser:()=>db}
   if(name==='@/lib/types')return {CUSTOMER_COLUMNS:'id,tenant_id,last_message_at',SLIP_COLUMNS:'id,tenant_id,customer_id,status,created_at'}
   if(name==='@/lib/inbox-realtime')return helpers
   if(name==='@/lib/inbox-request')return requests
   if(name==='./useInboxState')return {useInboxState:()=>({data:null,error:null,refresh:async()=>{}})}
   if(name==='@/lib/utils')return {cn:(...args)=>args.filter(Boolean).join(' ')}
   return new Proxy({},{get:(_,key)=>key})
  }})
 mod.InboxClient({initialChats:[{customer:a,preview:message('one'),latestSlip:null}],initialComments:[],initialSelectedId:a.id,tenant:{id:'shop-a',name:'Shop A',autoVerify:true,autoReply:true}})
 const cleanups=effects.map(fn=>fn()).filter(Boolean)
 return {states,queries,messages,customers,intervals,channelName,emit:async(table,event,row)=>{for(const {filter,handler}of listeners)if(filter.table===table&&(filter.event===event||filter.event==='*'))handler({eventType:event,new:event==='DELETE'?{}:row,old:event==='DELETE'?row:{}});await flush()},subscribe:async status=>{subscribe(status);await flush()},cleanup(){cleanups.forEach(fn=>fn());return cleaned&&removed.includes(7)&&browserListeners.size===0&&documentListeners.size===0}}
}

test('thread reconciliation preserves in-flight inserts/updates/deletes and deduplicates rows',()=>{
 const edits=new Map([['two',{revision:2,message:message('two')}],['one',{revision:3,message:null}]])
 const result=helpers.reconcileThread([message('one'),message('two'),message('foreign','customer-b')],edits,1,'customer-a')
 assert.equal(result.length,1);assert.equal(result[0].id,'two')
})
test('Inbox subscribes to Realtime, scopes reads to the shop and immediately inserts incoming messages once',async()=>{
 const f=fixture();await flush()
 assert.equal(f.channelName,'inbox:shop-a')
 const thread=f.queries.find(query=>query.table==='messages')
 assert.ok(thread.filters.some(([key,value])=>key==='customer_id'&&value==='customer-a'))
 assert.ok(thread.filters.some(([key,value])=>key==='customers.tenant_id'&&value==='shop-a'))
 const row=message('two');f.messages.push(row)
 await f.emit('messages','INSERT',row);await f.emit('messages','INSERT',row)
 assert.equal(f.states[5].filter(m=>m.id==='two').length,1)
 assert.equal(f.states[2][0].preview.body,'two')
 await f.emit('messages','INSERT',message('foreign','customer-b'))
 assert.ok(!f.states[5].some(m=>m.customer_id==='customer-b'))
 assert.ok(!f.states[2].some(c=>c.customer.tenant_id==='shop-b'))
 assert.ok(f.cleanup())
})
test('new conversation is hydrated even if message event arrives before customer event; reconnect catches missed messages',async()=>{
 const f=fixture();await flush()
 f.customers.push({id:'new-a',tenant_id:'shop-a',last_message_at:'2026-10-15T00:00:02Z'})
 const row=message('new','new-a');f.messages.push(row)
 await f.emit('messages','INSERT',row)
 assert.equal(f.states[2].find(c=>c.customer.id==='new-a').preview.id,'new')
 f.messages.push(message('missed'))
 await f.subscribe('SUBSCRIBED');await flush()
 assert.ok(f.states[5].some(m=>m.id==='missed'))
 await f.subscribe('TIMED_OUT');assert.equal(f.states[11],'offline')
 assert.equal(f.intervals.length,1)
 f.cleanup()
})
