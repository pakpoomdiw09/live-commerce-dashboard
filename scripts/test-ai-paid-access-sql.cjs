// Real PostgreSQL, isolated from Supabase, payment providers and AI providers.
const assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('node:crypto')
;(async()=>{const db=new PGlite();try{
 let fixture=fs.readFileSync('scripts/test-smart-followups-sql.cjs','utf8').split('await db.exec(`')[1].split('`)')[0]
 fixture=fixture.replace("name text default 'Shop',","name text default 'Shop',slip_quota integer default 10,slip_used integer default 0,slip_quota_credits integer default 0,").replace("reply_mode text default 'keyword',","reply_mode text default 'keyword',ai_instructions text,")
 await db.exec(fixture)
 await db.exec('create table comments(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));create table image_response_rules(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));')
 for(const name of ['feature-access.sql','smart-inbox.sql','smart-follow-ups.sql','agent-control.sql'])await db.exec(fs.readFileSync('supabase/'+name,'utf8'))
 await db.exec("create table billing_requests(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),item text,status text default 'pending',price_baht integer default 100);grant all on billing_requests to service_role;")
 const migration=fs.readFileSync('supabase/ai-paid-access.sql','utf8');await db.exec(migration);await db.exec(migration)
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
 async function shop(plan,status='approved',limit=2,price=100){
  const id=(await one('insert into tenants(plan) values($1) returning id',[plan])).id
  await db.query('insert into billing_requests(tenant_id,item,status,price_baht) values($1,$2,$3,$4)',[id,plan,status,price])
  await db.query('insert into agent_control_settings(tenant_id,ai_monthly_limit) values($1,$2) on conflict(tenant_id) do update set ai_monthly_limit=excluded.ai_monthly_limit',[id,limit])
  return id
 }
 const allowed=async id=>(await one("select has_tenant_feature($1,'ai_agent') allowed",[id])).allowed
 const start=async(id,key=randomUUID())=>(await one('select start_agent_ai_call($1,$2) result',[id,key])).result
 const used=async id=>(await one('select coalesce((select used from agent_ai_monthly_usage where tenant_id=$1 and month=date_trunc(\'month\',timezone(\'UTC\',now()))::date),0)::int used',[id])).used
 const free=await shop('free'),pending=await shop('starter','pending'),rejected=await shop('pro','rejected'),noMoney=await shop('pro','approved',2,0)
 for(const id of [free,pending,rejected,noMoney]){assert.equal(await allowed(id),false);assert.equal((await start(id)).reason,'FEATURE_LOCKED');assert.equal(await used(id),0)}
 for(const plan of ['starter','pro']){
  const id=await shop(plan),key=randomUUID()
  assert.equal(await allowed(id),true)
  assert.equal((await one('select flags from agent_control_settings where tenant_id=$1',[id])).flags.agent_orchestrator_enabled,true)
  assert.ok((await start(id,key)).id);assert.equal(await used(id),1)
  assert.equal((await start(id,key)).reason,'DUPLICATE_AI_INVOCATION');assert.equal(await used(id),1)
  assert.ok((await start(id)).id);assert.equal((await start(id)).reason,'AI_QUOTA_EXHAUSTED');assert.equal(await used(id),2)
  await db.query("update tenants set plan_expires_at=now()-interval '1 minute' where id=$1",[id])
  assert.equal(await allowed(id),false);assert.equal((await start(id)).reason,'FEATURE_LOCKED');assert.equal(await used(id),2)
 }
 const zero=await shop('starter','approved',0);assert.equal((await start(zero)).reason,'AI_QUOTA_EXHAUSTED');assert.equal(await used(zero),0)
 const purchase=await shop('starter','pending',3)
 await db.query("update billing_requests set status='approved' where tenant_id=$1",[purchase])
 assert.equal(await allowed(purchase),true);assert.equal((await one('select flags from agent_control_settings where tenant_id=$1',[purchase])).flags.agent_orchestrator_enabled,true)
 assert.equal((await one('select ai_monthly_limit n from agent_control_settings where tenant_id=$1',[purchase])).n,3)
 assert.ok((await start(purchase)).id)
 await db.exec('reset role;alter table billing_requests add column credits integer default 1;alter table billing_requests add column note text;alter table billing_requests add column decided_at timestamptz;')
 // The one-shop QA grant is explicit, non-cash, scoped, audited and idempotent.
 const qa='0f06ad7b-2b24-4a5a-87ad-a503753c0805'
 await db.query("insert into tenants(id,name,plan,plan_expires_at) values($1,'ดิว ไลฟ์สดพระเครื่อง 159','pro',now()+interval '90 days')",[qa])
 const expiry=(await one('select plan_expires_at from tenants where id=$1',[qa])).plan_expires_at
 await db.query("insert into agent_control_settings(tenant_id,ai_monthly_limit,flags) values($1,20,'{\"capability_products\":false}')",[qa])
 await db.query("insert into agent_ai_monthly_usage(tenant_id,month,used) values($1,date_trunc('month',timezone('UTC',now()))::date,10)",[qa])
 const grant=fs.readFileSync('supabase/test-grant-ai-pro-diw.sql','utf8');await db.exec(grant)
 assert.equal(await allowed(qa),true);assert.equal(await used(qa),10)
 const granted=await one('select ai_monthly_limit,flags from agent_control_settings where tenant_id=$1',[qa])
 assert.equal(granted.ai_monthly_limit,1010);assert.equal(granted.flags.capability_products,false)
 assert.equal((await one('select plan_expires_at from tenants where id=$1',[qa])).plan_expires_at.getTime(),expiry.getTime())
 assert.match((await one('select note from billing_requests where tenant_id=$1',[qa])).note,/ไม่ใช่การรับเงินจริง/)
 await db.query('update agent_ai_monthly_usage set used=11 where tenant_id=$1',[qa]);await db.exec(grant)
 assert.equal(await used(qa),11);assert.equal((await one('select ai_monthly_limit n from agent_control_settings where tenant_id=$1',[qa])).n,1010)
 assert.equal((await one("select count(*)::int n from agent_control_audit where tenant_id=$1 and event='qa_test_entitlement_granted'",[qa])).n,1)
 await db.exec(migration);assert.equal(await used(purchase),1);assert.equal((await one('select ai_monthly_limit n from agent_control_settings where tenant_id=$1',[purchase])).n,3)
 // A receipt for another tenant cannot unlock an unpaid shop, nor may public callers reserve usage.
 const other=await shop('pro','pending',3);assert.equal((await start(other)).reason,'FEATURE_LOCKED')
 await db.exec('set role authenticated');await assert.rejects(start(purchase),e=>e.code==='42501');await db.exec('reset role;set role service_role')
 assert.ok((await start(purchase)).id)
 console.log('PASS: real paid Starter/Pro approval, free/pending/rejected/zero-price denial, expiry, quota exhaustion, no unearned credits, duplicate protection, purchase activation, tenant isolation, restricted execution and migration reruns')
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1})
