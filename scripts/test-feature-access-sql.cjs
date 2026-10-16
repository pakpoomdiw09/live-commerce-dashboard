const assert=require('node:assert/strict'),fs=require('node:fs')
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite')
;(async()=>{const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table tenants(id uuid primary key default gen_random_uuid(),plan text,plan_expires_at timestamptz,is_active boolean default true,slip_quota int default 2,slip_quota_credits int default 0,slip_used int default 0);
 create table customers(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));
 create table messages(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id));
 create table comments(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));
 create table orders(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));
 create table slips(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));
 create table image_response_rules(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),is_active boolean default true);
 create table bot_settings(tenant_id uuid primary key references tenants(id),reply_mode text,ai_instructions text);
 grant usage on schema public to authenticated,service_role;
 grant select,insert,update,delete on customers,messages,comments,orders,slips,image_response_rules,bot_settings to authenticated,service_role;
 `)
 for(const table of ['customers','messages','comments','orders','slips','image_response_rules'])await db.exec(`alter table ${table} enable row level security;create policy existing_member on ${table} for all to authenticated using(true) with check(true)`)
 const sql=fs.readFileSync('supabase/feature-access.sql','utf8');await db.exec(sql);await db.exec(sql)
 const shop=async(plan,expiry)=> (await db.query('insert into tenants(plan,plan_expires_at) values($1,$2) returning id',[plan,expiry])).rows[0].id
 const future=new Date(Date.now()+3600000).toISOString(),past=new Date(Date.now()-3600000).toISOString()
 const ids={free:await shop('free',future),starter:await shop('starter',future),pro:await shop('pro',future),expired:await shop('pro',past),missing:await shop('pro',null)}
 const allowed=async(id,feature)=>(await db.query('select has_tenant_feature($1,$2) ok',[id,feature])).rows[0].ok
 for(const[name,id]of Object.entries(ids))for(const f of ['ai_agent','image_assistant','customer_management','slip_auto_pilot'])assert.equal(await allowed(id,f),name==='pro'||(name==='starter'&&f!=='ai_agent'),`${name}/${f}`)
 const customer=(await db.query('insert into customers(tenant_id) values($1) returning id',[ids.pro])).rows[0].id
 await db.query('insert into customers(tenant_id) values($1)',[ids.free]);await db.query('insert into messages(customer_id) values($1)',[customer])
 await db.exec('set role authenticated')
 assert.equal((await db.query('select * from customers')).rows.length,1)
 await assert.rejects(db.query('insert into image_response_rules(tenant_id) values($1)',[ids.free]),/row-level security/)
 await assert.rejects(db.query("insert into bot_settings values($1,'ai',null)",[ids.starter]),/FEATURE_LOCKED/)
 await assert.rejects(db.query("select consume_slip_credit($1)",[ids.pro]),/permission denied/)
 await assert.rejects(db.query("update plan_features set enabled=true"),/permission denied/)
 await db.exec('reset role')
 await db.query('update tenants set plan_expires_at=$1 where id=$2',[past,ids.pro])
 await db.exec('set role authenticated');assert.equal((await db.query('select * from customers')).rows.length,0);assert.equal((await db.query('select * from messages')).rows.length,0);await db.exec('reset role')
 await db.query('update tenants set plan_expires_at=$1 where id=$2',[future,ids.pro])
 await db.exec('set role authenticated');assert.equal((await db.query('select id from customers')).rows[0].id,customer);await db.exec('reset role')
 const consume=async id=>(await db.query('select consume_slip_credit($1) ok',[id])).rows[0].ok
 assert.equal(await consume(ids.free),false);assert.equal(await consume(ids.expired),false)
 assert.equal(await consume(ids.starter),true);assert.equal(await consume(ids.starter),true);assert.equal(await consume(ids.starter),false)
 await db.query('update tenants set is_active=false where id=$1',[ids.pro]);assert.equal(await allowed(ids.pro,'ai_agent'),false)
 console.log('PASS: Free/Starter/Pro/expired/null expiry, RLS direct reads/writes, preserved customer data after renewal, package+atomic slip quota and no bypass')
}finally{await db.close()}})().catch(error=>{console.error(error);process.exitCode=1})
