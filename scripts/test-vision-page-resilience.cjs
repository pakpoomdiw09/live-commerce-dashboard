const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,overrides={}){
 const api={},jsx=(type,props)=>({type,props})
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:api,require:name=>{
  if(name in overrides)return overrides[name]
  if(name==='react')return {useEffect(){},useMemo:fn=>fn(),useCallback:fn=>fn,useState:v=>[typeof v==='function'?v():v,()=>{}]}
  if(name==='react/jsx-runtime')return {jsx,jsxs:jsx}
  if(name==='next/navigation')return {useRouter:()=>({refresh(){}})}
  if(name==='@/lib/supabase/browser')return {supabaseBrowser:()=>({})}
  if(name==='@/lib/features/vision/image-rules')return {IMAGE_TRIGGERS:{product:{label:'Product'}}}
  return new Proxy({},{get:(_,key)=>key})
 }})
 return api
}
test('Vision overview defaults missing arrays and numeric usage and rejects null responses',()=>{
 const {normalizeVisionOverview}=load('components/chatbot/VisionCenter.tsx')
 for(const value of [{},{jobs:null,usage:null},{jobs:[null,{}],usage:{used:null,limit:'10',remaining:NaN}}]){
  const result=normalizeVisionOverview(value)
  assert.equal(result.jobs.length,0);assert.equal(result.usage.used,0);assert.equal(result.usage.limit,0);assert.equal(result.settings,null)
 }
 assert.throws(()=>normalizeVisionOverview(null))
 assert.throws(()=>normalizeVisionOverview([]))
})
test('Image rules render empty state with null, missing and malformed rules',()=>{
 const {ImageRulesClient}=load('components/chatbot/ImageRulesClient.tsx')
 for(const initialRules of [null,undefined,{},[null,{id:'one',name:'Bad trigger',trigger_type:'removed'}]]){
  assert.doesNotThrow(()=>ImageRulesClient({tenantId:'tenant',tenantName:'Store',initialRules,canManage:false}))
 }
})
test('Vision page renders loading and incomplete-data states without throwing',()=>{
 const base=load('components/chatbot/VisionCenter.tsx')
 for(const payload of [null,base.normalizeVisionOverview({jobs:null,usage:null})]){
  let index=0
  const {VisionCenter}=load('components/chatbot/VisionCenter.tsx',{react:{useCallback:fn=>fn,useEffect(){},useState:initial=>[index++===0?payload:initial,()=>{}]}})
  assert.doesNotThrow(()=>VisionCenter({tenantId:'tenant',canManage:false,children:null}))
 }
})
