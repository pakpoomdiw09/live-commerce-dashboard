const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function fixture() {
  let calls = 0, queries = 0
  const exports = {}
  const query = { select(){return query}, eq(){return query}, lte(){return query}, lt(){return query}, order(){return query}, async limit(){return {data:[{id:'job',run_at:'2026-10-20T00:00:00Z'}],error:null}} }
  const modules = {
    '@/lib/single-flight': {singleFlight:(_key,work)=>work()},
    'next/server': {NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})}},
    '@/lib/supabase/server': {supabaseAdmin:()=>({from(){queries++;return query}})},
    '@/lib/features/follow-ups/follow-ups': {runFollowUps:async()=>{calls++;return {sent:1}}},
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/cron/follow-ups/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console:{info(){},error(){}},require:name=>{assert.ok(name in modules,name);return modules[name]}})
  return {api:exports,calls:()=>calls,queries:()=>queries}
}
;(async()=>{
  for(const method of ['GET','POST']) {
    const f=fixture()
    const req={method,headers:new Headers(),nextUrl:new URL('https://example.test/api/cron/follow-ups?dryRun=1')}
    const dry=await f.api[method](req)
    assert.equal(dry.status,200);assert.equal(dry.body.success,true);assert.equal(dry.body.dryRun,true);assert.equal(dry.body.nextDueJob.id,'job');assert.equal(f.calls(),0);assert.equal(f.queries(),1)
    req.nextUrl.search=''
    const live=await f.api[method](req)
    assert.equal(live.status,200);assert.equal(live.body.sent,1);assert.equal(f.calls(),1);assert.equal(live.headers['Cache-Control'],'no-store')
  }
  const f=fixture();assert.deepEqual(Object.keys(f.api).filter(key=>/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)$/.test(key)).sort(),['GET','POST'])
  console.log('PASS: public GET/POST worker invocation, dry-run queue inspection without dispatch, no-store responses, explicit GET/POST exports')
})().catch(error=>{console.error(error);process.exitCode=1})
