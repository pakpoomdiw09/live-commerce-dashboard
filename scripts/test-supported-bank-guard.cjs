const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
function load(file,deps={}){
 const ctx={exports:{},require:name=>{if(name in deps)return deps[name];throw Error('Unexpected import '+name)}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx)
 return ctx.exports
}
const banks=load('lib/features/banking/banks.ts'),validation=load('lib/validation.ts',{'@/lib/features/banking/banks':banks,'@/lib/status':{}})
test('selection allow-list is exactly 18 documented banks; aliases work and legacy registry stays intact',()=>{
 assert.equal(banks.SUPPORTED_BANKS.length,18)
 assert.equal(banks.BANKS.length,36)
 for(const bank of banks.BANKS){
  assert.equal(banks.isSupportedBank(bank.code),Boolean(bank.slipCode))
  const result=validation.parseTenantInput({name:'Shop',bank_code:bank.code,account_number:'0123456789'},false)
  assert.equal(result.ok,Boolean(bank.slipCode))
 }
 for(const alias of ['TMB','011','CIMBT','UOBT'])assert.equal(banks.isSupportedBank(alias),true)
 for(const code of ['UNKNOWN','','PROMPTPAY','SCBT'])assert.equal(banks.isSupportedBank(code),false)
})
function fixture(accounts,error=null){
 let updates=0
 const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{page_id:null},error:null}),then:resolve=>Promise.resolve({data:accounts,error}).then(resolve),update(){updates++;return q}}
 const api=load('app/api/tenants/[id]/route.ts',{
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},
  '@/lib/feature-access':{hasFeature:async()=>true},'@/lib/supabase/server':{supabaseAdmin:()=>({from:()=>q})},
  '@/lib/auth':{getActor:async()=>({kind:'user',id:'owner'}),tenantRole:async()=>'owner',roleAtLeast:()=>true},
  '@/lib/integrations/facebook/oauth':{},'@/lib/tenant':{checkPageToken:async()=>({warnings:[]})},
  '@/lib/validation':validation,'@/lib/types':{},'@/lib/utils':{UUID:/^[a-f0-9-]{36}$/},'@/lib/features/banking/banks':banks,
 })
 return {patch:enabled=>api.PATCH({json:async()=>({auto_verify_enabled:enabled})},{params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})}),updates:()=>updates}
}
test('enabling Auto-Verify rejects empty, unsupported, mixed and failed account reads before any update',async()=>{
 for(const accounts of [[],[{bank_code:'SCBT'}],[{bank_code:'PROMPTPAY'}],[{bank_code:'KBANK'},{bank_code:'SCBT'}]]){
  const f=fixture(accounts),response=await f.patch(true)
  assert.equal(response.status,400);assert.equal(response.body.error,banks.UNSUPPORTED_BANK_MESSAGE);assert.equal(f.updates(),0)
 }
 const failed=fixture(null,{message:'offline'});assert.equal((await failed.patch(true)).status,503);assert.equal(failed.updates(),0)
})
test('supported banks can enable Auto-Verify; legacy unsupported accounts can always switch it off',async()=>{
 for(const code of ['KBANK','TTB','GHB']){const f=fixture([{bank_code:code}]);assert.equal((await f.patch(true)).status,200);assert.equal(f.updates(),1)}
 const f=fixture([{bank_code:'SCBT'}]);assert.equal((await f.patch(false)).status,200);assert.equal(f.updates(),1)
})
