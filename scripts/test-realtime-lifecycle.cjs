const {test}=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/load-typescript.cjs')
const flush=()=>new Promise(resolve=>setImmediate(resolve))

test('channel names are unique without crypto or a secure browser context',()=>{
 const realtime=load('lib/features/inbox/inbox-realtime.ts')
 const names=Array.from({length:100},()=>realtime.inboxChannelName('inbox','tenant'))
 assert.equal(new Set(names).size,100)
 assert.ok(names.every(name=>name.startsWith('inbox:tenant:')))
 assert.ok(realtime.inboxChannelName('inbox-state','tenant').startsWith('inbox-state:tenant:'))
})
test('browser renders share one client; SSR calls are not shared',()=>{
 let created=0
 const deps={'@supabase/ssr':{createBrowserClient:()=>({id:++created})},'@/lib/supabase/env':{requireSupabaseEnv:()=>({url:'https://example.test',anonKey:'public'})}}
 const browser=load('lib/supabase/browser.ts',deps,{window:{}})
 const first=browser.supabaseBrowser();for(let i=0;i<100;i++)assert.equal(browser.supabaseBrowser(),first)
 assert.equal(created,1)
 const server=load('lib/supabase/browser.ts',deps)
 assert.notEqual(server.supabaseBrowser(),server.supabaseBrowser());assert.equal(created,3)
})
test('Inbox metadata rerenders and customer discovery do not restart subscriptions; tenant changes clean up',async()=>{
 const values=[],memos=[],effects=[],pending=[];let cursor=0,channels=0,removed=0,fetches=0
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
 const react={
  useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]},
  useRef(initial){const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i]},
  useCallback(fn,deps){const i=cursor++;if(!memos[i]||!same(memos[i].deps,deps))memos[i]={fn,deps};return memos[i].fn},
  useEffect(fn,deps){const i=cursor++;if(!effects[i]||!same(effects[i].deps,deps)){pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()}})}},
 }
 const callbacks=[];let waitForRemoval
 const db={channel(){channels++;const c={on(){return c},subscribe(callback){callbacks.push(callback);return c}};return c},removeChannel:async()=>{removed++;if(waitForRemoval)await waitForRemoval}}
 const listeners=new Map(),timers=new Map();let timerId=0
 const globals={AbortController,Map,Set,Date,document:{visibilityState:'visible',addEventListener:(k,v)=>listeners.set('document:'+k,v),removeEventListener:k=>listeners.delete('document:'+k)},window:{addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)},setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},clearTimeout:i=>timers.delete(i),setInterval:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},clearInterval:i=>timers.delete(i),fetch:async()=>{fetches++;return {ok:true,json:async()=>({conversations:[]})}},console}
 const request=load('lib/features/inbox/inbox-request.ts',{}, {AbortController})
 const realtime=load('lib/features/inbox/inbox-realtime.ts')
 const api=load('hooks/inbox/useInboxState.ts',{react,'@/lib/supabase/browser':{supabaseBrowser:()=>db},'@/lib/utils':{apiError:async()=>''},'@/lib/features/inbox/inbox-request':request,'@/lib/features/inbox/inbox-realtime':realtime},globals)
 const render=(tenant,ids)=>{cursor=0;api.useInboxState(tenant,ids);while(pending.length)pending.shift()()}
 render('tenant-a',['one']);await flush();assert.equal(channels,1);assert.equal(fetches,1)
 for(let i=0;i<30;i++)render('tenant-a',['one'])
 render('tenant-a',['one','two']);await flush()
 assert.equal(channels,1);assert.equal(removed,0);assert.equal(fetches,1)
 render('tenant-b',['other']);await flush();assert.equal(channels,2);assert.equal(removed,1)
 const fire=async delay=>{const [id,timer]=[...timers].find(([,t])=>t.delay===delay);timers.delete(id);timer.fn();await flush()}
 // Retry before enabling the fast polling fallback; duplicate statuses coalesce.
 const before=fetches
 callbacks[1]('CHANNEL_ERROR');callbacks[1]('CLOSED')
 timers.get([...timers].find(([,t])=>t.delay===30000)[0]).fn();await flush()
 assert.equal(fetches,before)
 await fire(1000);assert.equal(channels,3);assert.equal(removed,2)
 callbacks[1]('CLOSED');assert.ok(![...timers.values()].some(t=>t.delay===2000))
 callbacks[2]('TIMED_OUT');await fire(2000)
 callbacks[3]('CHANNEL_ERROR');await fire(4000)
 callbacks[4]('CLOSED')
 timers.get([...timers].find(([,t])=>t.delay===30000)[0]).fn();await flush()
 assert.equal(fetches,before+1);assert.equal(channels,5)
 callbacks[4]('SUBSCRIBED')
 timers.get([...timers].find(([,t])=>t.delay===30000)[0]).fn();await flush()
 assert.equal(fetches,before+1)
 // A tenant change during asynchronous retirement cannot recreate the old tenant.
 let release
 waitForRemoval=new Promise(resolve=>{release=resolve})
 callbacks[4]('CHANNEL_ERROR');await fire(1000)
 assert.equal(channels,5)
 render('tenant-c',['third']);await flush();assert.equal(channels,6)
 release();waitForRemoval=undefined;await flush();assert.equal(channels,6)
 for(const effect of effects)effect?.cleanup?.()
 assert.equal(removed,6);assert.equal(listeners.size,0);assert.equal(timers.size,0)
 const after=fetches
 callbacks.at(-1)('CLOSED');callbacks[4]('SUBSCRIBED');await flush()
 assert.equal(timers.size,0);assert.equal(fetches,after)
})
