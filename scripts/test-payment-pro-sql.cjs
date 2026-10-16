// Isolated PostgreSQL. Reuses real feature, Inbox, follow-up and permanent payment ledger guards.
const assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require(process.argv[2]||'@electric-sql/pglite')
;(async()=>{const db=new PGlite();let checks=0;try{
 let fixture=fs.readFileSync('scripts/test-smart-followups-sql.cjs','utf8').split('await db.exec(`')[1].split('`)')[0]
 fixture=fixture.replace("name text default 'Shop',","name text default 'Shop',slip_quota integer default 10,slip_used integer default 0,slip_quota_credits integer default 0,")
 .replace("display_name text default 'Customer',","display_name text default 'Customer',order_status text default 'new',")
 .replace("reply_mode text default 'keyword',","reply_mode text default 'keyword',ai_instructions text,")
 .replace("amount numeric default 100,status","amount numeric default 100,slip_id uuid,paid_at timestamptz,status")
 .replace("create table slips(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),customer_id uuid references customers(id),created_at timestamptz default now());",`create table slips(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),customer_id uuid references customers(id),message_id uuid references messages(id),image_path text,expected_amount numeric(12,2),amount numeric(12,2),trans_ref text,status text default 'pending',note text,raw jsonb,verified_at timestamptz,approved_at timestamptz,approved_by uuid references auth.users(id),created_at timestamptz default now());`)
 await db.exec(fixture)
 await db.exec(`create table comments(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));create table image_response_rules(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id));create table bank_accounts(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),bank_code text,account_number text,is_active boolean default true);create unique index slips_one_valid_per_ref on slips(trans_ref) where status='valid';grant all on comments,image_response_rules,bank_accounts to service_role;`)
 const sql=name=>fs.readFileSync('supabase/'+name,'utf8')
 await db.exec(sql('feature-access.sql'));await db.exec(sql('smart-inbox.sql'));await db.exec(sql('smart-follow-ups.sql'))
 const payments=sql('payments.sql'),images=sql('billing-auto-approval.sql')
 await db.exec(payments.slice(payments.indexOf('create table if not exists public.payment_transfer_ledger'),payments.indexOf('-- Block source writes')))
 const fn=(text,name)=>{const start=text.indexOf('create or replace function public.'+name+'(');assert.ok(start>=0);return text.slice(start,text.indexOf('end $$;',start)+7)}
 await db.exec(fn(payments,'claim_payment_transfer'));await db.exec(fn(payments,'guard_sale_payment_transfer'))
 await db.exec('create trigger slips_payment_transfer_guard before insert or update on slips for each row execute function guard_sale_payment_transfer();')
 await db.exec(images.slice(images.indexOf('create table if not exists public.payment_image_ledger'),images.indexOf('lock table public.payment_receipts')))
 await db.exec(fn(images,'claim_payment_image'))
 await db.exec('grant select on payment_transfer_ledger to service_role;')
 const migration=sql('payment-pro.sql');await db.exec(migration);await db.exec(migration);checks++
 const one=async(query,args=[])=>(await db.query(query,args)).rows[0]
 const owner=(await one('insert into auth.users default values returning id')).id,staff=(await one('insert into auth.users default values returning id')).id
 let sequence=0
 async function setup({plan='pro',credits=10,auto=true,order=true}={}){
  const tenant=(await one('insert into tenants(plan,slip_quota) values($1,$2) returning id',[plan,credits])).id
  await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')",[tenant,owner,staff])
  await db.query('insert into payment_pro_settings values($1,true,$2)',[tenant,JSON.stringify({riskEngine:true,orderMatching:true,autoConfirmation:auto,advancedDashboard:true,analytics:true})])
  await db.query("insert into bank_accounts(tenant_id,bank_code,account_number) values($1,'KTB','9260337828')",[tenant])
  await db.query('insert into follow_up_policies(tenant_id,enabled) values($1,true)',[tenant])
  await db.query("insert into follow_up_workflows(tenant_id,kind,enabled,steps) values($1,'payment',true,'[{\"delay_minutes\":1,\"text\":\"Please pay\"}]')",[tenant])
  const customer=(await one('insert into customers(tenant_id) values($1) returning id',[tenant])).id
  const message=(await one("insert into messages(customer_id,sender,body) values($1,'customer','CF A1') returning id",[customer])).id
  const orderId=order?(await one('insert into orders(tenant_id,customer_id,message_id) values($1,$2,$3) returning id',[tenant,customer,message])).id:null
  const hash=(++sequence).toString(16).padStart(64,'0')
  return {tenant,customer,message,order:orderId,hash}
 }
 const claim=async s=>(await one("select claim_payment_pro($1,$2,$3,$4,'private-proof','image') result",[s.tenant,s.customer,s.message,s.hash])).result
 const start=async a=>(await one('select start_payment_pro_provider($1,$2) ok',[a.id,a.claim_token])).ok
 const state=async a=>one('select * from payment_pro_attempts where id=$1',[a.id])
 const credit=async s=>(await one('select slip_used from tenants where id=$1',[s.tenant])).slip_used
 const orderState=async s=>(await one('select status from orders where id=$1',[s.order])).status
 const proof=(ref,patch={})=>({auto_permitted:true,provider_verified:true,provider_fault:false,provider_verdict:'valid',amount_satang:10000,trans_ref:ref,receiver_bank:'006',receiver_account:'9260337828',receiver_proxy:null,paid_at:new Date().toISOString(),raw:{success:true},...patch})
 const complete=async(a,data)=>db.query('select complete_payment_pro($1,$2,$3)',[a.id,a.claim_token,JSON.stringify(data)])
 await db.exec('set role service_role')
 const first=await setup();const a=await claim(first);assert.ok(a.claim_token);assert.equal((await claim(first)).claim_token,null);assert.equal(await start(a),true);assert.equal(await start(a),false);await complete(a,proof('first-ref'));assert.equal((await state(a)).status,'VERIFIED');assert.equal(await orderState(first),'paid');assert.equal(await credit(first),1);assert.equal((await one('select status from follow_up_jobs where order_id=$1',[first.order])).status,'cancelled');checks++
 await complete(a,proof('first-ref'));assert.equal(await credit(first),1);assert.equal((await one('select count(*)::int n from payment_transfer_ledger where trans_ref=$1',['first-ref'])).n,1);checks++
 for(const [patch,reason]of [[{amount_satang:9999},'AMOUNT_MISMATCH'],[{receiver_account:'1111111111'},'RECEIVER_NOT_CONFIRMED'],[{provider_verified:false},'NOT_PROVIDER_VERIFIED'],[{trans_ref:null},'MISSING_TRANSACTION_REFERENCE'],[{paid_at:null},'PAYMENT_TIME_INVALID'],[{paid_at:new Date(Date.now()-25*3600000).toISOString()},'PAYMENT_TIME_INVALID']]){
  const s=await setup(),j=await claim(s);await start(j);await complete(j,proof('bad-'+s.hash,patch));assert.equal((await state(j)).status,'REVIEW_REQUIRED');assert.equal((await state(j)).reason,reason);assert.equal(await orderState(s),'pending_payment');assert.equal((await one('select act_payment_pro($1,$2,$3,$4,$5) ok',[j.id,s.tenant,owner,'approve','Checked proof carefully'])).ok,false);checks++
 }
 const outage=await setup(),oj=await claim(outage);await start(oj);await complete(oj,proof('outage',{provider_fault:true,provider_verified:false}));assert.equal(await credit(outage),0);assert.equal((await state(oj)).credit_refunded,true);await complete(oj,proof('outage',{provider_fault:true}));assert.equal(await credit(outage),0);checks++
 const duplicate=await setup(),du=await claim(duplicate);await start(du);await complete(du,proof('first-ref'));assert.equal((await state(du)).status,'REJECTED');assert.equal(await orderState(duplicate),'pending_payment');checks++
 const noCredit=await setup({credits:0}),nc=await claim(noCredit);assert.equal(await start(nc),false);assert.equal((await state(nc)).reason,'INSUFFICIENT_CREDITS');assert.equal(await credit(noCredit),0);checks++
 const manual=await setup({auto:false}),ma=await claim(manual);await start(ma);await complete(ma,proof('manual-ref'));assert.equal((await state(ma)).status,'REVIEW_REQUIRED');assert.equal((await state(ma)).eligible,true);await assert.rejects(db.query('select act_payment_pro($1,$2,$3,$4,$5)',[ma.id,manual.tenant,staff,'approve','Staff tried approval']),e=>e.code==='42501');assert.equal((await one('select act_payment_pro($1,$2,$3,$4,$5) ok',[ma.id,manual.tenant,owner,'approve','Owner checked evidence'])).ok,true);assert.equal(await orderState(manual),'paid');checks++
 const changed=await setup({auto:false}),ch=await claim(changed);await start(ch);await complete(ch,proof('changed-ref'));await db.query('update orders set amount=200 where id=$1',[changed.order]);assert.equal((await one('select act_payment_pro($1,$2,$3,$4,$5) ok',[ch.id,changed.tenant,owner,'approve','Owner checked evidence'])).ok,false);assert.equal(await orderState(changed),'pending_payment');checks++
 const image=await setup(),im=await claim(image);await start(im);await db.query('select claim_payment_image($1,$2,$3)',[image.hash,'package',crypto.randomUUID()]);await complete(im,proof('image-ref'));assert.equal((await state(im)).status,'REJECTED');assert.equal(await orderState(image),'pending_payment');assert.equal((await one('select count(*)::int n from payment_transfer_ledger where trans_ref=$1',['image-ref'])).n,0);checks++
 const interrupted=await setup(),ij=await claim(interrupted);await start(ij);await db.query("update payment_pro_attempts set claim_until=now()-interval '1 minute' where id=$1",[ij.id]);assert.equal((await one('select recover_payment_pro() n')).n,1);assert.equal((await state(ij)).status,'REVIEW_REQUIRED');assert.equal((await claim(interrupted)).claim_token,null);assert.equal(await credit(interrupted),1);checks++
 assert.equal((await one('select act_payment_pro($1,$2,$3,$4,$5) ok',[ij.id,interrupted.tenant,owner,'retry','Must not repeat unknown provider'])).ok,false);checks++
 const early=await setup(),ej=await claim(early);await db.query("update payment_pro_attempts set claim_until=now()-interval '1 minute' where id=$1",[ej.id]);await db.query('select recover_payment_pro()');assert.equal(await credit(early),0);assert.equal((await one('select act_payment_pro($1,$2,$3,$4,$5) ok',[ej.id,early.tenant,owner,'retry','Retry before provider started'])).ok,true);const resumed=await state(ej);assert.notEqual(resumed.claim_token,ej.claim_token);assert.equal(await start({...ej,claim_token:resumed.claim_token}),true);assert.equal(await credit(early),1);checks++
 const noOrder=await setup({order:false}),no=await claim(noOrder);await start(no);await complete(no,proof('no-order'));assert.equal((await state(no)).reason,'ORDER_REQUIRED');checks++
 const free=await setup({plan:'free'});await assert.rejects(claim(free),e=>e.code==='42501');checks++
 const expired=await setup();await db.query("update tenants set plan_expires_at=now()-interval '1 minute' where id=$1",[expired.tenant]);await assert.rejects(claim(expired),e=>e.code==='42501');checks++
 const cross=await setup();await assert.rejects(db.query("select claim_payment_pro($1,$2,$3,$4,null,'qr')",[cross.tenant,first.customer,first.message,cross.hash]),e=>e.code==='42501');checks++
 await assert.rejects(db.query('select act_payment_pro($1,$2,$3,$4,$5)',[ma.id,cross.tenant,owner,'approve','Cross tenant attempt']),e=>e.code==='P0002');checks++
 const bypass=await setup({auto:false}),by=await claim(bypass);await start(by);await complete(by,proof('bypass-ref'));await assert.rejects(db.query('update slips set approved_at=now() where id=$1',[by.slip_id]),e=>e.code==='42501');checks++
 const newOrder=(await one('insert into orders(tenant_id,customer_id) values($1,$2) returning id',[first.tenant,first.customer])).id;await assert.rejects(db.query("update orders set status='paid',slip_id=$1 where id=$2",[a.slip_id,newOrder]),e=>e.code==='42501');checks++
 const flags=await setup();await db.query("update payment_pro_settings set enabled=false where tenant_id=$1",[flags.tenant]);await assert.rejects(claim(flags),e=>e.code==='42501');checks++
 const masked=await one("select payment_pro_receiver($1,'6','92xxxx7828',null) ok",[first.tenant]);assert.equal(masked.ok,true);await db.query("insert into bank_accounts(tenant_id,bank_code,account_number) values($1,'PROMPTPAY','0932576114')",[first.tenant]);assert.equal((await one("select payment_pro_receiver($1,null,null,'+66932576114') ok",[first.tenant])).ok,true);checks++
 await db.exec('reset role');await db.query("select set_config('test.user',$1,false)",[owner]);await db.exec('set role authenticated');assert.ok((await db.query('select id from payment_pro_attempts where tenant_id=$1',[first.tenant])).rows.length);await assert.rejects(db.query('select evidence from payment_pro_attempts'),/permission denied/);await assert.rejects(db.query('select recover_payment_pro()'),/permission denied/);await assert.rejects(db.query("update payment_pro_settings set enabled=true"),/permission denied/);checks++
 await db.query("select set_config('test.user',$1,false)",['99999999-9999-4999-8999-999999999999']);assert.equal((await db.query('select id from payment_pro_attempts')).rows.length,0);checks++
 await db.exec('reset role');await db.exec(migration);assert.equal((await one('select status from payment_pro_attempts where id=$1',[a.id])).status,'VERIFIED');checks++
 const beforeRollback=await one('select slip_used,slip_quota_credits from tenants where id=$1',[first.tenant]);await db.exec(sql('payment-pro-rollback.sql'));assert.equal((await one('select enabled from payment_pro_settings where tenant_id=$1',[first.tenant])).enabled,false);assert.deepEqual(await one('select slip_used,slip_quota_credits from tenants where id=$1',[first.tenant]),beforeRollback);assert.equal((await state(a)).status,'VERIFIED');assert.equal((await one('select count(*)::int n from payment_transfer_ledger where trans_ref=$1',['first-ref'])).n,1);checks++
 console.log(`PASS: ${checks} Payment Pro PostgreSQL scenarios: migrations, real ledgers, transaction rollback, amount/receiver/time, credits/refunds, duplicate claims, worker restart, review roles, tenant isolation, RLS, legacy approval guard, order snapshots and real follow-up cancellation`)
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1})
