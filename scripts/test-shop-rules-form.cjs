const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console,require:name=>{if(name in deps)return deps[name];throw Error('Unexpected dependency '+name)}});return exports}
const codec=load('lib/features/store-rules/store-rule-items.ts'),form=load('lib/features/store-rules/shop-persona-settings.ts',{'@/lib/features/store-rules/store-rule-items':codec})
test('structured rules round-trip all sections, multiline values, reserved labels and legacy text',()=>{
 const value={...form.emptyShopRules(),tone:'สุภาพ / เป็นกันเอง',opening:'ยินดีดูแล',dispatch:'จันทร์–ศุกร์\nตัดรอบบ่าย',shipping:'50 บาท',promotion:'คำลงท้าย: เป็นข้อความในโปรโมชัน\nคำขึ้นต้น: อีกบรรทัด\n\\ข้อความ',answers:'ข้อมูลบริการ',handoff:'คืนเงิน',extra:'เงื่อนไขเดิม\nคำลงท้าย: ข้อความที่เก็บไว้'}
 assert.equal(JSON.stringify(form.parseShopRules(form.compileShopRules(value))),JSON.stringify(value))
 const old='ค่าส่งตามพื้นที่\nคำลงท้าย: ครับ\nนโยบายเดิมที่ไม่มีหัวข้อ';const imported=form.parseShopRules(old);assert.equal(imported.extra,old)
 assert.equal(form.parseShopRules(form.compileShopRules(imported)).extra,old)
 const prompt=form.shopRulesPrompt(form.compileShopRules(value));assert.match(prompt,/บุคลิกและน้ำเสียงที่ต้องการ: สุภาพ/);assert.match(prompt,/50 บาท/);assert.doesNotMatch(prompt,/ข้อมูลกติการ้านที่จัดหมวดหมู่/)
})
test('validation rejects forged fields, non-string values and combined overflow',()=>{
 for(const input of [null,[],{}, {...form.emptyShopRules(),tone:3},{...form.emptyShopRules(),tenantId:'foreign'},{...form.emptyShopRules(),extra:'ก'.repeat(50000)}])assert.throws(()=>form.validateShopRules(input))
 assert.equal(form.compileShopRules(form.validateShopRules(form.emptyShopRules())),'')
})
test('API compiles sections on the server and keeps owner/tenant authorization and old clients',async()=>{
 let allowed=true;const writes=[]
 class InboxError extends Error{constructor(message){super(message);this.status=400}}
 const api=load('app/api/agent-control/route.ts',{'next/server':{NextResponse:{json:body=>({status:200,body})}},'@/lib/features/agents/agent-control-server':{agentControlTenant:async(_req,_id,owner)=>{assert.equal(owner,true);if(!allowed)throw Error('Forbidden');return{tenantId:'server-tenant',actor:{id:'owner'},db:{from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{ai_instructions:''},error:null})}),rpc:async(name,args)=>{writes.push({name,args});return{error:null}}}}}},'@/lib/features/inbox/inbox-server':{InboxError,inboxError:error=>({status:error.status??403}),checkRpc:error=>{if(error)throw error}},'@/lib/features/agents/agent-control-core':{containsSecret:text=>text.includes('api_key=')},'@/lib/features/store-rules/shop-persona-settings':form,'@/lib/features/store-rules/store-rule-items':codec})
 const send=body=>api.PATCH({nextUrl:{searchParams:new URLSearchParams('tenantId=foreign')},json:async()=>body})
 const value={...form.emptyShopRules(),tone:'ทางการ / มืออาชีพ',shipping:'ค่าบริการตามพื้นที่'}
 assert.equal((await send({shopRules:value,instructions:'forged override'})).status,200)
 assert.equal(writes[0].args.p_tenant,'server-tenant');assert.equal(writes[0].args.p_actor,'owner');assert.equal(writes[0].args.p_instructions,form.compileShopRules(value))
 assert.equal((await send({shopRules:{...value,extra:'api_key=secret'}})).status,400);assert.equal(writes.length,1)
 assert.equal((await send({instructions:'กติกาจากหน้ารุ่นเดิม'})).status,200);assert.equal(writes[1].args.p_instructions,'กติกาจากหน้ารุ่นเดิม')
 allowed=false;assert.equal((await send({shopRules:value})).status,403);assert.equal(writes.length,2)
})
