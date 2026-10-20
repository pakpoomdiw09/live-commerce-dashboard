const assert=require('node:assert/strict')
const fs=require('node:fs')
const {test}=require('node:test')
const {PGlite}=require('@electric-sql/pglite')
const load=require('./helpers/load-typescript.cjs')

test('follow-up flags enforce tenant, actor, idempotency, permissions and shared rate limits',async()=>{
 const db=new PGlite()
 try{
  await db.exec(fs.readFileSync('scripts/test-smart-inbox-sql.cjs','utf8').split('await db.exec(`')[1].split('`)')[0])
  await db.exec(fs.readFileSync('supabase/smart-inbox.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/smart-inbox-v2.sql','utf8'))
  const sql=fs.readFileSync('supabase/inbox-follow-up-flags.sql','utf8')
  await db.exec(sql);await db.exec(sql)
  const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
  const actor=(await one('insert into auth.users default values returning id')).id
  const colleague=(await one('insert into auth.users default values returning id')).id
  const outsider=(await one('insert into auth.users default values returning id')).id
  const tenant=(await one('insert into tenants default values returning id')).id
  const other=(await one('insert into tenants default values returning id')).id
  await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'admin')",[tenant,actor,colleague])
  const customer=(await one('insert into customers(tenant_id) values($1) returning id',[tenant])).id
  const foreignCustomer=(await one('insert into customers(tenant_id) values($1) returning id',[other])).id
  await db.exec('set role service_role')
  const flag=(customerId,user,enabled,key=crypto.randomUUID())=>db.query('select set_inbox_follow_up_flag($1,$2,$3,$4)',[customerId,user,enabled,key])
  await assert.rejects(flag(customer,outsider,true),error=>error.code==='42501')
  await assert.rejects(flag(foreignCustomer,actor,true),error=>error.code==='42501')
  await assert.rejects(flag(customer,actor,null),error=>error.code==='22023')
  const key=crypto.randomUUID()
  await flag(customer,actor,true,key);await flag(customer,actor,true,key)
  assert.equal((await one('select count(*) n from inbox_follow_up_flags')).n,1)
  await assert.rejects(flag(customer,actor,false,key),error=>error.code==='22023')
  await flag(customer,colleague,true)
  await flag(customer,actor,false)
  assert.equal((await one('select user_id from inbox_follow_up_flags')).user_id,colleague)
  await assert.rejects(db.query('select manage_inbox_workspace($1,$2,$3,$4,$5)',[customer,actor,'star',key,null]),error=>error.code==='22023')
  const otherKey=crypto.randomUUID()
  await db.query('select manage_inbox_workspace($1,$2,$3,$4,$5)',[customer,actor,'star',otherKey,null])
  await assert.rejects(flag(customer,actor,true,otherKey),error=>error.code==='22023')
  await db.exec('reset role')
  await db.query("update tenants set plan='free' where id=$1",[tenant])
  await db.exec('set role service_role')
  await assert.rejects(flag(customer,actor,true),error=>error.code==='42501')
  await db.exec('reset role')
  await db.query("update tenants set plan='starter' where id=$1",[tenant])
  await db.exec('set role service_role')
  for(let i=0;i<27;i++)await flag(customer,actor,true)
  await assert.rejects(flag(customer,actor,false),error=>error.code==='P0429')
  await flag(customer,actor,true,key)
  assert.equal((await one('select count(*) n from messages')).n,0)
  await db.exec('reset role;set role authenticated')
  await assert.rejects(db.query('select * from inbox_follow_up_flags'),error=>error.code==='42501')
  await assert.rejects(flag(customer,actor,true),error=>error.code==='42501')
 }finally{await db.close()}
})

function apiFixture({missing=false,rpcError=null}={}){
 const queries=[],calls=[]
 class InboxError extends Error{constructor(message,status=400,code='INBOX_ERROR'){super(message);this.status=status;this.code=code}}
 const db={
  from(table){const filters={};const result=()=>table==='inbox_follow_up_flags'?{data:missing?null:{customer_id:'customer'},error:missing?{code:'PGRST205'}:null}:{data:table==='tenants'?{page_id:'page'}:table==='inbox_stars'?{customer_id:'customer'}:[],error:null};const query={select(){return query},eq(key,value){filters[key]=value;return query},order(){return query},limit(){return query},single:async()=>result(),maybeSingle:async()=>result(),then(resolve){return Promise.resolve(result()).then(resolve)}};queries.push({table,filters});return query},
  async rpc(name,body){calls.push({name,body});return {error:rpcError}},
 }
 const api=load('app/api/inbox/conversations/[id]/workspace/route.ts',{
  'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}},
  '@/lib/features/inbox/inbox-policy-server':{inboxInboundEvidence:async()=>null,humanAgentApproved:()=>false},
  '@/lib/features/inbox/inbox-server':{InboxError,inboxCustomer:async()=>({db,actor:{id:'actor'},customer:{id:'customer'},tenantId:'tenant'}),inboxError:error=>({status:error.status??503,body:{code:error.code}}),checkRpc:error=>{if(error)throw error}},
  '@/lib/features/inbox/inbox-v2':{inboxWindow:()=>({allowed:false})},
  '@/lib/utils':{UUID:/^[a-f0-9-]{36}$/},
 })
 const ctx={params:Promise.resolve({id:'customer'})}
 const request=(body,origin=null)=>({headers:{get:key=>key==='origin'?origin:null},nextUrl:{origin:'https://shop.test'},json:async()=>body})
 return {api,ctx,request,calls,queries}
}

test('workspace API scopes marker reads and safely supports databases awaiting the migration',async()=>{
 for(const missing of [false,true]){
  const {api,ctx,request,queries}=apiFixture({missing})
  const response=await api.GET(request(),ctx)
  assert.equal(response.status,200)
  assert.equal(response.body.starred,true)
  assert.equal(response.body.followUpAvailable,!missing)
  assert.equal(response.body.followedUp,!missing)
  assert.deepEqual(queries.find(query=>query.table==='inbox_follow_up_flags').filters,{tenant_id:'tenant',customer_id:'customer',user_id:'actor'})
 }
})

test('marker API validates requests, rejects cross-site writes and delegates authorized actor IDs',async()=>{
 const {api,ctx,request,calls}=apiFixture()
 const requestId=crypto.randomUUID()
 assert.equal((await api.POST(request({action:'followup',requestId},'https://evil.test'),ctx)).status,403)
 assert.equal((await api.POST(request({action:'followup',requestId:'bad'}),ctx)).status,400)
 assert.equal((await api.POST(request({action:'delete',requestId}),ctx)).status,400)
 assert.equal(calls.length,0)
 for(const action of ['followup','unfollowup']){
  assert.equal((await api.POST(request({action,requestId,actorId:'forged'}),ctx)).status,200)
  const call=calls.at(-1)
  assert.equal(call.name,'set_inbox_follow_up_flag')
  assert.equal(call.body.p_actor,'actor')
  assert.equal(call.body.p_enabled,action==='followup')
  assert.equal(call.body.p_key,requestId)
 }
})

test('missing follow-up RPC produces a structured service-unavailable response',async()=>{
 const {api,ctx,request}=apiFixture({rpcError:{code:'PGRST202'}})
 const response=await api.POST(request({action:'followup',requestId:crypto.randomUUID()}),ctx)
 assert.equal(response.status,503)
 assert.equal(response.body.code,'FOLLOW_UP_UNAVAILABLE')
})
