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
 const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));assert.equal(config.crons.filter(job=>job.path==='/api/cron/follow-ups').length,1);assert.equal(config.crons[0].schedule,'* * * * *')
 console.log('PASS: per-minute Vercel schedule, missing/wrong secret rejection, no User-Agent bypass, authenticated dry-run without dispatch, GET/POST worker calls, fallback secret, no token logs')
})().catch(error=>{console.error(error);process.exitCode=1})
