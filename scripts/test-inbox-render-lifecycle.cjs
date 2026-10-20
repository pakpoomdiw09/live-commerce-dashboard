const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),load=require('./helpers/load-typescript.cjs')
test('Inbox keeps its channel through SUBSCRIBED state, prop rerenders and room changes',async()=>{
 const values=[],memos=[],effects=[],pending=[],channels=[],removed=[],timers=new Set()
 let cursor=0,tree,timerId=0
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
 const react={
  useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>values[i]=typeof v==='function'?v(values[i]):v]},
  useRef(initial){const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i]},
  useMemo(fn,deps){const i=cursor++;if(!memos[i]||!same(memos[i].deps,deps))memos[i]={value:fn(),deps};return memos[i].value},
  useCallback(fn,deps){return react.useMemo(()=>fn,deps)},
  useEffect(fn,deps){const i=cursor++;if(!effects[i]||!same(effects[i].deps,deps))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()}})},
 }
 const db={from(){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},abortSignal(){return q},async maybeSingle(){return {data:null,error:null}},then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)}};return q},
  channel(name){const c={name,listeners:[],on(_,filter,callback){c.listeners.push({filter,callback});return c},subscribe(callback){c.status=callback;return c}};channels.push(c);return c},
  async removeChannel(c){removed.push(c);c.status('CLOSED')},
 }
 const timer=()=>{timers.add(++timerId);return timerId},clear=id=>timers.delete(id),api={}
 const request=load('lib/features/inbox/inbox-request.ts',{}, {AbortController}),realtime=load('lib/features/inbox/inbox-realtime.ts')
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/inbox/InboxClient.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports:api,console:{log(){},info(){},warn(){},error(){}},process:{env:{NODE_ENV:'test'}},setTimeout:timer,clearTimeout:clear,setInterval:timer,clearInterval:clear,
  window:{addEventListener(){},removeEventListener(){}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
  require:name=>{
   if(name==='react')return react
   if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}
   if(name==='@/lib/supabase/browser')return {supabaseBrowser:()=>db}
   if(name==='@/lib/types')return {isMissingCustomerAvatarColumn:()=>false}
   if(name==='@/lib/features/inbox/inbox-request')return request
   if(name==='@/lib/features/inbox/inbox-realtime')return realtime
   if(name==='@/hooks/inbox/useInboxState')return {useInboxState:()=>({data:null,error:null,refresh:async()=>{}})}
   if(name==='@/lib/utils')return {cn:()=>''}
   return new Proxy({},{get:(_,key)=>key})
  },
 })
 const chats=['a','b'].map(id=>({customer:{id,tenant_id:'tenant',last_message_at:null},preview:null,latestSlip:null}))
 const props={initialChats:chats,initialComments:[],initialSelectedId:'a',tenant:{id:'tenant',name:'Store'}}
 const render=()=>{cursor=0;tree=api.InboxClient(props);while(pending.length)pending.shift()()}
 const flush=()=>new Promise(resolve=>setImmediate(resolve))
 const all=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props?.children)]
 render();await flush();channels[0].status('SUBSCRIBED');await flush();render()
 for(let i=0;i<50;i++){props.tenant={...props.tenant};props.initialChats=[...chats];render()}
 assert.equal(channels.length,1);assert.equal(removed.length,0)
 all(tree).find(n=>n.type==='ChatList').props.onOpen('b');render();await flush()
 const message={id:'message',customer_id:'b',sender:'customer',body:'hello',created_at:'2026-10-20T00:00:00Z',attachments:[]}
 channels[0].listeners.find(l=>l.filter.table==='messages'&&l.filter.event==='INSERT').callback({new:message})
 render()
 assert.ok(all(tree).find(n=>n.type==='Conversation').props.messages.some(m=>m.id==='message'))
 assert.equal(channels.length,1);assert.equal(removed.length,0)
 props.tenant={...props.tenant,id:'other-tenant'};render();await flush()
 assert.equal(channels.length,2);assert.equal(removed.length,1)
 for(const effect of effects)effect?.cleanup?.()
 assert.equal(removed.length,2);assert.equal(timers.size,0)
})
