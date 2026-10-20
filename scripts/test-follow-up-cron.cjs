const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function fixture(env={CRON_SECRET:'test-secret'}){
 let worker=0,queries=0;const exports={},logs=[]
 const db={from(){queries++;const query={select(){return query},eq(){return query},lte(){return query},lt(){return query},order(){return query},limit:async()=>({data:[{id:'job',run_at:'2026-10-20T00:00:00Z'}],error:null})};return query}}
 const modules={
  '@/lib/single-flight':{singleFlight:(_key,work)=>work()},
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})}},
  '@/lib/supabase/server':{supabaseAdmin:()=>db},
  '@/lib/features/follow-ups/follow-ups':{runFollowUps:async()=>{worker++;return {sent:1}}},
 }
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/cron/follow-ups/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env},console:{info:(...items)=>logs.push(items),warn:(...items)=>logs.push(items),error:(...items)=>logs.push(items)},require:name=>{assert.ok(name in modules,name);return modules[name]}})
 const request=(token,dry=false,method='GET')=>({method,headers:new Headers(token?{authorization:`Bearer ${token}`}:{'user-agent':'vercel-cron/1.0'}),nextUrl:new URL('https://example.test/api/cron/follow-ups'+(dry?'?dryRun=1':''))})
 return {api:exports,request,worker:()=>worker,queries:()=>queries,logs}
}
;(async()=>{
 for(const env of [{},{CRON_SECRET:'test-secret'}]){const f=fixture(env);for(const token of [null,'wrong'])assert.equal((await f.api.GET(f.request(token))).status,401);assert.equal(f.queries(),0);assert.equal(f.worker(),0)}
 const dry=fixture();const result=await dry.api.GET(dry.request('test-secret',true));assert.equal(result.body.dryRun,true);assert.equal(result.body.hasDueJobs,true);assert.equal(dry.worker(),0);assert.equal(result.headers['Cache-Control'],'no-store')
 const live=fixture();assert.equal((await live.api.GET(live.request('test-secret'))).status,200);assert.equal((await live.api.POST(live.request('test-secret',false,'POST'))).status,200);assert.equal(live.worker(),2);assert.ok(!JSON.stringify(live.logs).includes('test-secret'))
 const fallback=fixture({INTERNAL_API_SECRET:'internal'});assert.equal((await fallback.api.GET(fallback.request('internal'))).status,200)
 const blank=fixture({CRON_SECRET:'   ',INTERNAL_API_SECRET:' internal '});assert.equal((await blank.api.POST(blank.request('internal',false,'POST'))).status,200)
 const empty=fixture({CRON_SECRET:' ',INTERNAL_API_SECRET:' '});assert.equal((await empty.api.POST(empty.request('wrong',false,'POST'))).status,401);assert.equal(empty.worker(),0)
 const priority=fixture({CRON_SECRET:' primary ',INTERNAL_API_SECRET:'internal'});assert.equal((await priority.api.GET(priority.request('internal'))).status,401);assert.equal((await priority.api.GET(priority.request('primary'))).status,200)
 for(const method of ['GET','POST'])for(const dryRun of [false,true]){const f=fixture();for(const token of [null,'wrong']){const denied=await f.api[method](f.request(token,dryRun,method));assert.equal(denied.status,401);assert.equal(denied.headers['Cache-Control'],'no-store')}assert.equal(f.queries(),0);assert.equal(f.worker(),0)}
 for(const method of ['GET','POST']){
  const f=fixture();const req=f.request(null,true,method);req.nextUrl.searchParams.set('secret','test-secret');assert.equal((await f.api[method](req)).status,200);assert.equal(f.worker(),0)
  req.nextUrl.searchParams.set('secret','wrong');assert.equal((await f.api[method](req)).status,401)
  req.nextUrl.searchParams.set('secret','test-secret');req.headers.set('authorization','Bearer wrong');assert.equal((await f.api[method](req)).status,401)
  req.headers.set('authorization','  bearer   test-secret  ');assert.equal((await f.api[method](req)).status,200)
  assert.ok(!JSON.stringify(f.logs).includes('test-secret'))
 }
 const noSecret=fixture({});const req=noSecret.request(null);req.nextUrl.searchParams.set('secret','test-secret');assert.equal((await noSecret.api.GET(req)).status,401);assert.equal(noSecret.worker(),0)
 const queryLive=fixture();const liveReq=queryLive.request(null,false,'POST');liveReq.nextUrl.searchParams.set('secret','test-secret');assert.equal((await queryLive.api.POST(liveReq)).status,200);assert.equal(queryLive.worker(),1)
 for(const env of [{},{CRON_SECRET:' ',INTERNAL_API_SECRET:' '}])for(const method of ['GET','POST']){
  const f=fixture(env);assert.equal((await f.api[method](f.request('Pakpoom0980',true,method))).status,200)
  const req=f.request(null,true,method);req.nextUrl.searchParams.set('secret','Pakpoom0980');assert.equal((await f.api[method](req)).status,200);assert.equal(f.worker(),0)
  assert.ok(!JSON.stringify(f.logs).includes('Pakpoom0980'))
 }
 for(const env of [{CRON_SECRET:'primary'},{INTERNAL_API_SECRET:'internal'}]){const f=fixture(env);assert.equal((await f.api.GET(f.request('Pakpoom0980'))).status,401);assert.equal(f.worker(),0)}
 console.log('PASS: header/query authorization, header precedence, flexible Bearer casing/spacing, missing/wrong secrets, dry-run isolation, GET/POST dispatch, fallback, no token logs')
})().catch(error=>{console.error(error);process.exitCode=1})
