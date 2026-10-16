const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const {test}=require('node:test')
function load(file,deps,globals={}){const context={exports:{},console,Date,File,process:{env:{NODE_ENV:'production',GEMINI_API_KEY:'test'}},require:n=>{if(n in deps)return deps[n];throw Error(n)},...globals};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports}
const next={NextResponse:{json:(body,opts={})=>({body,status:opts.status||200})}}
const features=load('lib/feature-access.ts',{'server-only':{},'next/server':next})
const id='11111111-1111-4111-8111-111111111111'
test('customer PATCH is 403 FEATURE_LOCKED before updates despite a forged Pro body',async()=>{
 let writes=0
 const db={rpc:async()=>({data:false,error:null}),from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{tenant_id:id},error:null}),update(){writes++;throw Error('Forbidden write')}})}
 const api=load('app/api/customers/[id]/route.ts',{'next/server':next,'@/lib/feature-access':features,'@/lib/supabase/server':{supabaseAdmin:()=>db},'@/lib/auth':{getActor:async()=>({kind:'user'}),canAccessTenant:async()=>true},'@/lib/validation':{parseCustomerInput:()=>({ok:true,value:{notes:'changed'}})},'@/lib/types':{CUSTOMER_COLUMNS:'id'},'@/lib/utils':{UUID:/^[a-f0-9-]{36}$/}})
 const result=await api.PATCH({json:async()=>({plan:'pro'})},{params:Promise.resolve({id})})
 assert.equal(result.status,403);assert.equal(result.body.code,'FEATURE_LOCKED');assert.equal(writes,0)
})
test('slip API rejects missing package or exhausted quota before provider/storage work',async()=>{
 for(const allowed of [false,true]){
  const db={rpc:async()=>({data:allowed,error:null}),from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{slip_quota:1,slip_quota_credits:0,slip_used:1},error:null})})}
  const api=load('app/api/slips/verify/route.ts',{'next/server':next,'@/lib/feature-access':features,'@/lib/supabase/server':{supabaseAdmin:()=>db},'@/lib/auth':{getActor:async()=>({kind:'user'}),canAccessTenant:async()=>true,isPlatformAdmin:()=>false},'@/lib/slip/process':{SLIP_MAX_BYTES:5000000,SLIP_IMAGE_TYPES:['image/jpeg'],processSlip(){throw Error('Provider must not run')}},'@/lib/utils':{UUID:/^[a-f0-9-]{36}$/}})
  const values={tenantId:id,file:new File(['x'],'slip.jpg',{type:'image/jpeg'})}
  const result=await api.POST({headers:new Headers(),formData:async()=>({get:key=>values[key]})})
  assert.equal(result.status,403);assert.equal(result.body.code,'FEATURE_LOCKED')
 }
})
test('background AI refuses a locked tenant before constructing the SDK client',async()=>{
 let calls=0
 const api=load('lib/ai-agent.ts',{'server-only':{},'@/lib/feature-access':features,'@google/genai':{ApiError:Error,GoogleGenAI:class{constructor(){calls++}}}})
 assert.equal(await api.aiReply({rpc:async()=>({data:false,error:null})},{tenantId:id}),null)
 assert.equal(calls,0)
})
