const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,deps,env={}){const context={exports:{},process:{env},console,require:name=>{if(name in deps)return deps[name];throw Error(name)}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports}
const customer='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222'
class InboxError extends Error{constructor(message,status=400){super(message);this.status=status}}
const errors={InboxError,inboxError:error=>({status:error.status??503,body:{error:error.message}}),checkRpc:error=>{if(error)throw error}}
function fixture({denied=0,pro=true}={}){
 const writes=[];const guard=async()=>{if(denied)throw new InboxError('denied',denied);return {tenantId:'server-shop',actor:{id:'server-user'},customer:{id:customer},db:{rpc:async(name,args)=>{writes.push({name,args});return {data:{ok:true},error:null}}}}}
 const route=load('app/api/inbox/conversations/[id]/route.ts',{'next/server':{NextResponse:{json:body=>({status:200,body})}},'@/lib/inbox-server':{...errors,inboxCustomer:guard},'@/lib/feature-access':{hasFeature:async()=>true},'@/lib/ai-agent':{aiConfigured:()=>true},'@/lib/utils':{UUID:/^[a-f0-9-]{36}$/}},{SMART_INBOX_PRO_ENABLED:pro?'true':'false'})
 const request=(body,origin='https://snapbot.test')=>({headers:new Headers({origin}),nextUrl:new URL('https://snapbot.test/api/inbox/conversations/'+customer),json:async()=>body})
 return {route,writes,request,context:{params:Promise.resolve({id:customer})}}
}
test('unauthorized and cross-tenant mutations stop before RPC even with valid idempotency key',async()=>{
 for(const denied of [401,403,404]){const f=fixture({denied});assert.equal((await f.route.PATCH(f.request({action:'claim',version:0,requestId:key}),f.context)).status,denied);assert.equal(f.writes.length,0)}
})
test('Pro mutation enforces same origin, reason, version/key validation and server actor/tenant scope',async()=>{
 const f=fixture(),body={action:'close',version:7,requestId:key,reason:'  resolved  ',actor:'forged',tenantId:'foreign'}
 assert.equal((await f.route.PATCH(f.request(body,'https://attacker.test'),f.context)).status,403)
 for(const bad of [{...body,reason:''},{...body,reason:'x'.repeat(501)},{...body,version:-1},{...body,requestId:'bad'},{...body,action:'delete'}])assert.equal((await f.route.PATCH(f.request(bad),f.context)).status,400)
 assert.equal(f.writes.length,0)
 assert.equal((await f.route.PATCH(f.request(body),f.context)).status,200)
 assert.equal(f.writes[0].name,'manage_inbox_pro');assert.equal(f.writes[0].args.p_actor,'server-user');assert.equal(f.writes[0].args.p_customer,customer);assert.equal(f.writes[0].args.p_reason,'resolved');assert.equal(f.writes[0].args.p_key,key)
})
test('flag off preserves legacy mutation RPC and does not accept Pro-only release actions',async()=>{
 const f=fixture({pro:false});assert.equal((await f.route.PATCH(f.request({action:'release',version:0}),f.context)).status,400)
 assert.equal((await f.route.PATCH(f.request({action:'claim',version:0}),f.context)).status,200);assert.equal(f.writes[0].name,'manage_inbox_conversation')
})
test('report authorization precedes service RPC and flag-off does not touch optional schema',async()=>{
 for(const denied of [true,false]){let reads=0;const route=load('app/api/inbox/pro/route.ts',{'next/server':{NextResponse:{json:body=>({status:200,body})}},'@/lib/inbox-server':{...errors,inboxTenant:async()=>{if(denied)throw new InboxError('denied',404);return {tenantId:'server-shop',db:{rpc:async()=>{reads++;throw Error('must not query')}}}}}},{SMART_INBOX_PRO_ENABLED:'false'});const result=await route.GET({nextUrl:new URL('https://snapbot.test/api/inbox/pro?tenantId=server-shop')});assert.equal(result.status,denied?404:200);assert.equal(reads,0)}
})
