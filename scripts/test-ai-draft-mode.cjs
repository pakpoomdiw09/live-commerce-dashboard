const assert = require('node:assert/strict')
const {test} = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadAi(response,visionError=false,products=[]) {
 const requests=[]
 let failed=0
 class GoogleGenAI {
  constructor(){this.models={generateContent:async request=>{requests.push(request);if(response instanceof Error)throw response;return response}}}
 }
 class ApiError extends Error {}
 class AiAgentError extends Error {constructor(code,message,status=503){super(message);this.code=code;this.status=status}}
 const modules={
  '@/lib/features/agents/llm-vision':{loadLlmImages:async()=>{if(visionError)throw Error('IMAGE_DOWNLOAD_FAILED');return [{mimeType:'image/png',data:'aW1hZ2U='}]}},
  'server-only':{},
  '@google/genai':{ApiError,GoogleGenAI},
  '@/lib/feature-access':{hasFeature:async()=>true},
  '@/lib/features/agents/ai-errors':{AiAgentError},
  '@/lib/features/inbox/inbox-automation-window':{assertAutomationWindow:async()=>{}},
  '@/lib/features/agents/agent-control-ai':{
   prepareAgentGeneration:async(_db,ctx)=>({tenantId:ctx.tenantId,usageId:'usage-1',products,systemInstruction:'Select only grounded reply facts.'}),
   finishAgentGeneration:async(_db,_control,text)=>text,
   failAgentGeneration:async()=>{failed++},
   sanitizeAgentHistory:text=>text,
  },
 }
 const exports={}
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..','lib/features/agents/ai-agent.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText
 vm.runInNewContext(code,{exports,URL,process:{env:{GEMINI_API_KEY:'test-key'}},console:{log(){},warn(){},error(){}},setTimeout,require:name=>{
  assert.ok(Object.hasOwn(modules,name),`Unexpected dependency: ${name}`)
  return modules[name]
 }})
 const db={from(table){
  assert.notEqual(table,'products','Catalog must be loaded once by the managed context builder')
  const query={select(){return query},eq(){return query},order(){return query},
   async limit(){return {data:table==='messages'?[{sender:'customer',body:'ขอทราบรายละเอียด',attachments:[]}]:[],error:null}}}
  return query
 }}
 return {agent:exports,db,requests,failed:()=>failed}
}

const context={tenantId:'tenant',customerId:'customer',shopName:'ร้านทดสอบ',customerName:'ลูกค้า',instructions:null}

test('draft mode asks Gemini to clarify incomplete facts and converts handoff to a safe editable draft',async()=>{
 const fixture=loadAi({text:'[HANDOVER]',candidates:[{finishReason:'STOP'}]})
 const draft=await fixture.agent.aiReply(fixture.db,context,undefined,true,true,false,true)
 assert.equal(draft,fixture.agent.DRAFT_FALLBACK)
 assert.match(fixture.requests[0].config.systemInstruction,/prefer CLARIFY over HANDOFF/)
 assert.match(fixture.requests[0].config.systemInstruction,/Do not invent facts/)
 assert.equal(fixture.requests[0].config.responseMimeType,'application/json')
})

test('draft mode uses a safe draft when Gemini returns no text and closes reserved usage',async()=>{
 const fixture=loadAi({text:'  ',candidates:[{finishReason:'STOP'}]})
 const draft=await fixture.agent.aiReply(fixture.db,context,undefined,true,true,false,true)
 assert.equal(draft,fixture.agent.DRAFT_FALLBACK)
 assert.equal(fixture.failed(),1)
})

test('non-draft agent requests preserve the handoff token behavior',async()=>{
 const fixture=loadAi({text:'[HANDOVER]',candidates:[{finishReason:'STOP'}]})
 assert.equal(await fixture.agent.aiReply(fixture.db,context),fixture.agent.HANDOVER_TOKEN)
})

test('vision adds inline image parts after history sanitization and uses managed catalog grounding',async()=>{
 const f=loadAi({text:'Approved product facts',candidates:[{finishReason:'STOP'}]})
 assert.equal(await f.agent.aiReply(f.db,{...context,imageUrls:['https://cdn.fbsbx.com/image']}),'Approved product facts')
 const request=f.requests[0]
 assert.equal(request.contents.at(-1).role,'user')
 assert.equal(request.contents.at(-1).parts.find(part=>part.inlineData).inlineData.data,'aW1hZ2U=')
 assert.match(request.config.systemInstruction,/Compare visible attributes with this tenant catalog/)
 assert.match(request.config.systemInstruction,/Never confirm payment/)
})

test('expired images and provider vision errors return safe text and close usage without retry',async()=>{
 for(const f of [loadAi({},true),loadAi(new Error('Vision API unavailable'))]){
  assert.equal(await f.agent.aiReply(f.db,{...context,imageUrls:['https://cdn.fbsbx.com/expired']},undefined,true),f.agent.VISION_FALLBACK)
  assert.equal(f.failed(),1)
  assert.ok(f.requests.length<=1)
 }
})

test('product metadata uses validated DB IDs and images rather than Gemini-supplied URLs',async()=>{
 const raw=JSON.stringify({decision:'ANSWER',knowledgeIds:[],productCodes:['P1'],product_id:'fake',image_url:'https://evil.test/forged'})
 const products=[{id:'product-one',code:'P1',image_url:'https://store.test/photo.webp'}]
 const f=loadAi({text:raw,candidates:[{finishReason:'STOP'}]},false,products)
 let metadata
 await f.agent.aiReply(f.db,{...context,onProductResult:value=>{metadata=value}})
 assert.equal(metadata.has_product,true);assert.equal(metadata.product_id,'product-one');assert.equal(metadata.image_url,products[0].image_url)
 assert.equal(f.agent.verifiedProductResult(raw,[{...products[0],image_url:'javascript:alert(1)'}]).image_url,null)
 assert.equal(f.agent.verifiedProductResult(JSON.stringify({decision:'CLARIFY'}),products).has_product,false)
 assert.equal(f.agent.verifiedProductResult(JSON.stringify({decision:'ANSWER',productCodes:['FOREIGN']}),products).image_url,null)
})
