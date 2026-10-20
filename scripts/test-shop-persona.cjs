const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console,Date,Map,Set,crypto:require('node:crypto').webcrypto,process:{env:{}},require:name=>{if(name in deps)return deps[name];throw Error('Unexpected dependency '+name)}});return exports}
const core=load('lib/features/agents/agent-control-core.ts',{'@/lib/domain-state':load('lib/domain-state.ts')})
function fixture({rules='- ค่าส่ง 50 บาท\n- ตัดรอบส่งเวลา 13:00 น.\n- ตอบอย่างสุภาพ',error=false,quota=true,saved=[],savedError=false,knowledge=[],catalog=[]}={}){
 let savedRules=rules,savedRows=saved,reserves=0;const reads=[],writes=[]
 class AiAgentError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status}}
 const api=load('lib/features/agents/agent-control-ai.ts',{'server-only':{},'@/lib/features/store-rules/store-rule-items':load('lib/features/store-rules/store-rule-items.ts'),'@/lib/features/agents/ai-errors':{AiAgentError},'@/lib/features/store-rules/shop-persona-settings':load('lib/features/store-rules/shop-persona-settings.ts',{'@/lib/features/store-rules/store-rule-items':load('lib/features/store-rules/store-rule-items.ts')}),'@/lib/features/agents/agent-control-core':core,'@/lib/features/agents/agent-control-flags':{agentControlConfig:async()=>({flags:{agent_orchestrator_enabled:true,agent_knowledge_base_enabled:true},capabilities:{products:true}})}})
 const db={rpc:async(name,args)=>{assert.equal(name,'start_agent_ai_call');assert.ok(typeof args.p_tenant==='string');reserves++;return{data:quota?{id:'usage'}:{reason:'AI_QUOTA_EXHAUSTED'}}},from(table){const read={table,filters:[]};reads.push(read);let update=false;const q={select(){return q},eq(k,v){read.filters.push([k,v]);return q},order(){return q},range(start,end){read.range=[start,end];return q},limit(){return q},maybeSingle(){return q},update(value){update=true;writes.push(value);return q},then(resolve,reject){return Promise.resolve({data:update?{id:'usage'}:table==='products'?catalog.slice(read.range?.[0]??0,(read.range?.[1]??99)+1):table==='agent_knowledge_sources'?knowledge:table==='inbox_quick_replies'?savedRows.filter(row=>!row.tenant_id||row.tenant_id===read.filters.find(([key])=>key==='tenant_id')?.[1]):table==='bot_settings'?{ai_instructions:savedRules&&typeof savedRules==='object'?savedRules[read.filters.find(([key])=>key==='tenant_id')?.[1]]:savedRules}:[],error:(error&&table==='bot_settings'||savedError&&table==='inbox_quick_replies')?{code:'DB_DOWN'}:null}).then(resolve,reject)}};return q}}
 return{api,db,reads,writes,run:(tenantId='own')=>api.prepareAgentGeneration(db,{tenantId,customerId:'',instructions:'caller-supplied stale fee 999'},'ค่าส่งเท่าไหร่'),setRules:value=>savedRules=value,setSaved:value=>savedRows=value,reserves:()=>reserves}
}
test('AI context includes the full active catalog across pages and stored knowledge sources',async()=>{
 const catalog=Array.from({length:205},(_,i)=>({code:`P${i}`,name:`Product ${i}`,price:10,stock:2,description:'Product details'}))
 const f=fixture({rules:null,catalog,knowledge:[{id:'faq-one',kind:'faq',title:'FAQ',content:'Shop opening hours 09:00',is_active:true}]})
 const control=await f.run();assert.equal(control.products.length,205)
 assert.match(control.systemInstruction,/P204/);assert.match(control.systemInstruction,/Shop opening hours 09:00/)
 assert.equal(f.reads.filter(read=>read.table==='products').length,3)
})

test('catalog context includes image URLs and grounded image replies use stored details or a polite no-match',async()=>{
 const product={code:'IMG1',name:'Blue bag',price:250,stock:3,description:'Canvas bag with zip closure',image_url:'https://storage.example.test/main.webp',commerce_images:['https://storage.example.test/main.webp','https://storage.example.test/detail.webp']}
 const f=fixture({rules:null,catalog:[product]})
 const control=await f.run()
 assert.match(control.systemInstruction,/main.webp/);assert.match(control.systemInstruction,/detail.webp/)
 const answer=core.groundedAgentReply(JSON.stringify({decision:'ANSWER',knowledgeIds:[],productCodes:['IMG1']}),[],[product],undefined,true)
 assert.match(answer.text,/Blue bag/);assert.match(answer.text,/250.00/);assert.match(answer.text,/Canvas bag/)
 const missing=core.groundedAgentReply(JSON.stringify({decision:'CLARIFY',knowledgeIds:[],productCodes:[]}),[],[product],undefined,true)
 assert.equal(missing.text,core.IMAGE_PRODUCT_NOT_FOUND);assert.equal(missing.handoff,false)
 assert.equal(core.groundedAgentReply(JSON.stringify({decision:'HANDOFF'}),[],[product],undefined,true).handoff,true)
})

test('manual saved replies enter backend knowledge with exact bank details and tenant isolation',async()=>{
 const own={id:'bank',tenant_id:'own',shortcut:'เลขบัญชี',body:'ธนาคารทดสอบ เลขบัญชี 0123456789 ชื่อบัญชี ร้านทดสอบ'}
 const f=fixture({rules:null,saved:[own,{id:'foreign',tenant_id:'other',shortcut:'Foreign',body:'Other shop only'}]})
 const control=await f.run()
 assert.match(control.systemInstruction,/0123456789/);assert.doesNotMatch(control.systemInstruction,/Other shop only/)
 assert.ok(f.reads.some(read=>read.table==='inbox_quick_replies'&&read.filters.some(([key,value])=>key==='tenant_id'&&value==='own')))
 assert.match(control.systemInstruction,/without requiring an exact keyword/)
 const answer=await f.api.finishAgentGeneration(f.db,control,JSON.stringify({decision:'ANSWER',knowledgeIds:['saved-reply:bank'],productCodes:[]}))
 assert.equal(answer,own.body);assert.deepEqual(Array.from(f.writes[0].source_ids),['saved-reply:bank'])
 f.setSaved([{...own,body:'เลขบัญชีใหม่ 0987654321'}])
 const edited=await f.run();assert.match(edited.systemInstruction,/0987654321/);assert.doesNotMatch(edited.systemInstruction,/0123456789/)
 f.setSaved([]);const deleted=await f.run();assert.equal(deleted.knowledge.length,0)
 assert.equal(await f.api.finishAgentGeneration(f.db,deleted,'{"decision":"ANSWER","knowledgeIds":["saved-reply:bank"],"productCodes":[]}'),'[HANDOVER]')
})

test('saved reply read failures and credentials stop before quota; protected claims still require review',async()=>{
 for(const options of [{savedError:true},{saved:[{id:'secret',shortcut:'key',body:'api_key=private12345678'}]}]){
  const f=fixture(options);await assert.rejects(f.run(),error=>['AGENT_KNOWLEDGE_UNAVAILABLE','AGENT_SENSITIVE_KNOWLEDGE'].includes(error.code));assert.equal(f.reserves(),0)
 }
 const f=fixture({rules:null,saved:[{id:'paid',shortcut:'ชำระ',body:'ชำระเงินสำเร็จแล้ว'}]}),control=await f.run()
 assert.equal(await f.api.finishAgentGeneration(f.db,control,'{"decision":"ANSWER","knowledgeIds":["saved-reply:paid"],"productCodes":[]}'),'[HANDOVER]')
})

test('latest tenant-scoped saved rules enter the system prompt and become selectable grounded answers',async()=>{
 const f=fixture(),first=await f.run();assert.match(first.systemInstruction,/ค่าส่ง 50 บาท/);assert.doesNotMatch(first.systemInstruction,/999/)
 assert.ok(f.reads.some(r=>r.table==='bot_settings'&&r.filters.some(([k,v])=>k==='tenant_id'&&v==='own')))
 const answer=await f.api.finishAgentGeneration(f.db,first,JSON.stringify({decision:'ANSWER',knowledgeIds:['shop-rule:1'],productCodes:[]}))
 assert.equal(answer,'ค่าส่ง 50 บาท');assert.equal(f.writes[0].reason,'VERIFIED_BUSINESS_DATA');assert.deepEqual(Array.from(f.writes[0].source_ids),['shop-rule:1'])
 f.setRules('ค่าส่ง 70 บาท');const second=await f.run();assert.match(second.systemInstruction,/ค่าส่ง 70 บาท/);assert.doesNotMatch(second.systemInstruction,/ค่าส่ง 50 บาท/);assert.equal(f.reserves(),2)
})
test('empty rules never fall back to stale caller data or invent facts',async()=>{
 const f=fixture({rules:null}),control=await f.run();assert.equal(control.knowledge.length,0);assert.doesNotMatch(control.systemInstruction,/999/)
 assert.equal(await f.api.finishAgentGeneration(f.db,control,'{"decision":"ANSWER","knowledgeIds":["shop-rule:1"],"productCodes":[]}'),'[HANDOVER]')
})
test('failed reads and secret-bearing rules stop before quota reservation',async()=>{
 for(const options of [{error:true},{rules:'api_key=123456789secret'}]){const f=fixture(options);await assert.rejects(f.run(),e=>['AGENT_KNOWLEDGE_UNAVAILABLE','AGENT_SENSITIVE_KNOWLEDGE'].includes(e.code));assert.equal(f.reserves(),0)}
})
test('shop rules do not bypass quota or allow invented payment/shipping claims',async()=>{
 const blocked=fixture({quota:false});await assert.rejects(blocked.run(),e=>e.code==='AI_QUOTA_EXHAUSTED')
 const f=fixture({rules:'ชำระเงินเรียบร้อยแล้ว'}),control=await f.run()
 assert.equal(await f.api.finishAgentGeneration(f.db,control,'{"decision":"ANSWER","knowledgeIds":["shop-rule:1"],"productCodes":[]}'),'[HANDOVER]')
 assert.match(control.systemInstruction,/dispatch schedule does not prove/)
})
test('long rules retain all saved text in bounded records',()=>{
 const text='ก'.repeat(8000),records=core.shopRulesKnowledge(text);assert.equal(records.map(r=>r.content).join(''),text);assert.ok(records.every(r=>r.content.length<=1800))
})
test('concurrent tenants receive their own current rules and conversational wording',async()=>{
 const f=fixture({rules:{a:'ค่าบริการ 50 บาท\nบุคลิกและน้ำเสียงที่ต้องการ: สุภาพ\nคำขึ้นต้น: ยินดีให้บริการ\nคำลงท้าย: ครับ',b:'ค่าบริการ 80 บาท\nบุคลิกและน้ำเสียงที่ต้องการ: เป็นกันเอง\nคำขึ้นต้น: สวัสดีจ้า\nคำลงท้าย: จ้า'}})
 const [a,b]=await Promise.all([f.run('a'),f.run('b')]);assert.match(a.systemInstruction,/สุภาพ/);assert.doesNotMatch(a.systemInstruction,/80 บาท|สวัสดีจ้า/);assert.doesNotMatch(b.systemInstruction,/50 บาท|ยินดีให้บริการ/)
 const response='{"decision":"ANSWER","knowledgeIds":["shop-rule:1"],"productCodes":[]}'
 assert.equal(await f.api.finishAgentGeneration(f.db,a,response),'ยินดีให้บริการ\nค่าบริการ 50 บาท\nครับ')
 assert.equal(await f.api.finishAgentGeneration(f.db,b,response),'สวัสดีจ้า\nค่าบริการ 80 บาท\nจ้า')
 assert.equal(a.knowledge.length,1);assert.equal(b.knowledge.length,1)
 f.setRules('ค่าบริการ 90 บาท\nคำลงท้าย: ค่ะ');const updated=await f.run('a');assert.equal(updated.persona.closing,'ค่ะ');assert.match(updated.systemInstruction,/90 บาท/)
})
test('persona cannot bypass handoff or add payment claims, secrets or excessive text',()=>{
 assert.equal(core.shopPersona('คำลงท้าย: ชำระเงินเรียบร้อยแล้ว').closing,'')
 assert.equal(core.shopPersona('คำขึ้นต้น: api_key=123456789secret').opening,'')
 assert.equal(core.shopPersona('คำลงท้าย: '+'ก'.repeat(121)).closing,'')
 assert.equal(core.groundedAgentReply('{"decision":"HANDOFF"}',[],[],{opening:'สวัสดี',closing:'ครับ'}).text,'[HANDOVER]')
})
test('settings API uses current tenant settings even when prompt history contains old rules',async()=>{
 const reads=[]
 const api=load('lib/features/agents/agent-control-server.ts',{'server-only':{},'@/lib/auth':{},'@/lib/supabase/server':{},'@/lib/feature-access':{hasFeature:async()=>false},'@/lib/features/inbox/inbox-server':{},'@/lib/features/agents/agent-control-flags':{},'@/lib/utils':{},'@/lib/features/store-rules/shop-persona-settings':load('lib/features/store-rules/shop-persona-settings.ts',{'@/lib/features/store-rules/store-rule-items':load('lib/features/store-rules/store-rule-items.ts')}),'@/lib/features/agents/agent-control-core':core})
 const db={from(table){const read={table,tenant:null};reads.push(read);const q={select(){return q},eq(key,value){if(key==='tenant_id')read.tenant=value;return q},gte(){return q},order(){return q},limit(){return q},maybeSingle(){return q},then(resolve){const data=table==='bot_settings'?{ai_instructions:read.tenant==='a'?'กติกาปัจจุบันของร้าน ก':'กติกาปัจจุบันของร้าน ข'}:table==='agent_prompt_versions'?[{instructions:'กติกาเก่า'}]:[];return Promise.resolve({data,error:null}).then(resolve)}};return q}}
 const [a,b]=await Promise.all([api.agentControlDashboard(db,'a',false),api.agentControlDashboard(db,'b',false)])
 assert.equal(a.shopInstructions,'กติกาปัจจุบันของร้าน ก');assert.equal(b.shopInstructions,'กติกาปัจจุบันของร้าน ข')
 assert.ok(reads.filter(read=>read.table==='bot_settings').every(read=>['a','b'].includes(read.tenant)))
})
test('structured form storage reaches the actual prompt and retains the configured closing',async()=>{
 const form=load('lib/features/store-rules/shop-persona-settings.ts',{'@/lib/features/store-rules/store-rule-items':load('lib/features/store-rules/store-rule-items.ts')}),f=fixture({rules:form.compileShopRules({...form.emptyShopRules(),tone:'สุภาพ',closing:'ครับ',shipping:'ค่าบริการ 50 บาท',extra:'เวลาเปิดร้าน 09:00 น.'})})
 const control=await f.run();assert.doesNotMatch(control.systemInstruction,/ข้อมูลกติการ้านที่จัดหมวดหมู่/);assert.match(control.systemInstruction,/เวลาเปิดร้าน 09:00/);assert.equal(control.persona.closing,'ครับ')
 const source=control.knowledge.find(item=>item.content.includes('50 บาท'));assert.ok(source)
 assert.equal(await f.api.finishAgentGeneration(f.db,control,JSON.stringify({decision:'ANSWER',knowledgeIds:[source.id],productCodes:[]})),'ค่าจัดส่งหรือค่าบริการ: ค่าบริการ 50 บาท\nครับ')
})
test('all 50 rules including content beyond 8000 characters reach the model without legacy Q&A reads',async()=>{
 const rules=Array.from({length:49},(_,i)=>`${i+1}. เงื่อนไขข้อ ${i+1} ${'ข้อมูลเงื่อนไขร้าน '.repeat(20)}`).join('\n')+'\n50. ตัดรอบส่งสินค้าเวลา 15:00 น.'
 assert.ok(rules.length>8000);const f=fixture({rules}),control=await f.run()
 assert.match(control.systemInstruction,/50. ตัดรอบส่งสินค้าเวลา 15:00/);assert.ok(f.reads.some(read=>read.table==='agent_knowledge_sources'))
 const source=control.knowledge.find(item=>item.content.includes('ตัดรอบส่งสินค้าเวลา 15:00'));assert.ok(source)
 assert.equal(await f.api.finishAgentGeneration(f.db,control,JSON.stringify({decision:'ANSWER',knowledgeIds:[source.id],productCodes:[]})),'ตัดรอบส่งสินค้าเวลา 15:00 น.')
 const tooLong=fixture({rules:'ก'.repeat(50001)});await assert.rejects(tooLong.run(),error=>error.code==='STORE_RULES_TOO_LONG');assert.equal(tooLong.reserves(),0)
})
test('saved list items are combined for real generation and deleting an item removes its context',async()=>{
 const items=load('lib/features/store-rules/store-rule-items.ts'),f=fixture({rules:items.serializeStoreRuleItems([{id:'one',body:'ตัดรอบส่ง 15:00 น.'},{id:'two',body:'ค่าส่ง 50 บาท'}])})
 const before=await f.run();assert.match(before.systemInstruction,/ตัดรอบส่ง 15:00/);assert.match(before.systemInstruction,/ค่าส่ง 50 บาท/);assert.doesNotMatch(before.systemInstruction,/snapbot_store_rules/)
 f.setRules(items.serializeStoreRuleItems([{id:'two',body:'ค่าส่ง 50 บาท'}]));const after=await f.run();assert.doesNotMatch(after.systemInstruction,/ตัดรอบส่ง 15:00/);assert.match(after.systemInstruction,/ค่าส่ง 50 บาท/)
})
test('generation only receives enabled rules and immediately uses a re-enabled rule',async()=>{
 const codec=load('lib/features/store-rules/store-rule-items.ts'),rules=[{id:'one',body:'ตัดรอบ 15:00 น.',enabled:true,category:'shipping'},{id:'two',body:'โปรโมชันเฉพาะกิจที่ปิดไว้',enabled:false,category:'promotion'}],f=fixture({rules:codec.serializeStoreRuleItems(rules)})
 const off=await f.run();assert.match(off.systemInstruction,/ตัดรอบ 15:00/);assert.doesNotMatch(off.systemInstruction,/โปรโมชันเฉพาะกิจที่ปิดไว้/)
 rules[1].enabled=true;f.setRules(codec.serializeStoreRuleItems(rules));const on=await f.run();assert.match(on.systemInstruction,/โปรโมชันเฉพาะกิจที่ปิดไว้/)
})
test('malformed saved rules fail safely before AI quota reservation',async()=>{
 for(const rules of ['{"snapbot_store_rules":1,"rules":null}','{"snapbot_store_rules":2,"rules":[]}']){
  const f=fixture({rules});await assert.rejects(f.run(),error=>error.code==='STORE_RULES_INVALID');assert.equal(f.reserves(),0)
 }
})
