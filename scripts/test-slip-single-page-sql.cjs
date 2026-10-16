const fs=require('node:fs'),assert=require('node:assert/strict'),{PGlite}=require(process.argv[2]||'@electric-sql/pglite')
;(async()=>{const db=new PGlite();let n=0;try{
 const fixture=fs.readFileSync('scripts/test-bank-accounts-sql.cjs','utf8').split('await db.exec(`')[1].split('`)')[0]
 await db.exec(fixture);await db.exec('create table auth.users(id uuid primary key);revoke select on tenants from authenticated;grant select(id,name,account_number) on tenants to authenticated;')
 const one=async(q,p=[])=>(await db.query(q,p)).rows[0],owner='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222'
 await db.query('insert into auth.users values($1),($2)',[owner,staff])
 await db.exec(fs.readFileSync('supabase/bank-accounts.sql','utf8'))
 const tenant=(await one('insert into tenants default values returning id')).id,foreign=(await one('insert into tenants default values returning id')).id
 await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')",[tenant,owner,staff])
 const migration=fs.readFileSync('supabase/slip-bank-controls.sql','utf8');await db.exec(migration);await db.exec(migration)
 const call=async(action,id=null,data={},actor=owner,t=tenant,confirmed=true)=>(await one('select manage_slip_bank_account($1,$2,$3,$4,$5,$6) id',[t,actor,action,id,JSON.stringify(data),confirmed])).id
 const a=await call('save',null,{bank_code:'KTB',account_name:'Owner',account_number:'9260337828',is_active:true}),b=await call('save',null,{bank_code:'PROMPTPAY',account_name:'Owner',account_number:'0932576114',is_active:true});assert.equal((await one('select is_primary from bank_accounts where id=$1',[a])).is_primary,true);n++
 await call('primary',b);assert.equal((await one('select account_number from tenants where id=$1',[tenant])).account_number,'0932576114');assert.equal((await one('select count(*)::int n from bank_accounts where tenant_id=$1 and is_primary',[tenant])).n,1);n++
 assert.equal((await one('select count(*)::int n from bank_account_audit where tenant_id=$1',[tenant])).n,3);assert.equal((await one("select count(*)::int n from bank_account_audit where length(last_four)>4")).n,0);n++
 await assert.rejects(call('primary',a,{},staff),e=>e.code==='42501');await assert.rejects(call('primary',a,{},owner,foreign),e=>e.code==='42501');await assert.rejects(call('primary',a,{},owner,tenant,false),e=>e.code==='22023');await assert.rejects(call('primary',a,{},owner,tenant,null),e=>e.code==='22023');n++
 await db.query("insert into tenant_members values($1,$2,'owner')",[foreign,owner]);await assert.rejects(call('delete',a,{},owner,foreign),e=>e.code==='P0002');n++
 await call('toggle',b);assert.equal((await one('select account_number from tenants where id=$1',[tenant])).account_number,'9260337828');await assert.rejects(call('primary',b),e=>e.code==='22023');n++
 await call('delete',a);assert.equal((await one('select account_number from tenants where id=$1',[tenant])).account_number,null);assert.equal((await one('select count(*)::int n from bank_accounts where tenant_id=$1',[tenant])).n,1);n++
 await db.query("select set_config('test.user_id',$1,false)",[staff]);await db.exec('set role authenticated');assert.equal((await one('select count(*)::int n from bank_accounts')).n,0);await assert.rejects(db.query('select account_number from tenants'),/permission denied/);await assert.rejects(db.query('delete from bank_accounts'),/permission denied/);await db.exec('reset role');n++
 await db.query("select set_config('test.user_id',$1,false)",[owner]);await db.exec('set role authenticated');assert.equal((await one('select count(*)::int n from bank_accounts')).n,1);await assert.rejects(db.query("update bank_accounts set account_number='0000000000'"),/permission denied/);await assert.rejects(call('primary',b),/permission denied/);await db.exec('reset role');n++
 const seeded=(await one("insert into tenants(bank_code,account_name,account_number) values('KTB','New owner','9260337828') returning id")).id;assert.equal((await one('select is_primary from bank_accounts where tenant_id=$1',[seeded])).is_primary,true);n++
 await db.exec(`create table payment_pro_attempts(id uuid primary key default gen_random_uuid(),tenant_id uuid,slip_id uuid,customer_id uuid,status text,reason text,expected_satang bigint,eligible boolean,credit_charged boolean,credit_refunded boolean,provider_started_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());`)
 await db.query("insert into payment_pro_attempts(tenant_id,status,expected_satang,reason) values($1,'VERIFIED',900,null),($1,'REVIEW_REQUIRED',1900,'AMOUNT_MISMATCH'),($1,'REJECTED',5000,'DUPLICATE_TRANSACTION'),($2,'VERIFIED',999999,null)",[tenant,foreign])
 await db.exec(fs.readFileSync('supabase/payment-pro-dashboard.sql','utf8'))
 const report=async(q='')=>(await one("select payment_pro_dashboard_report($1,now()-interval '7 days',now()+interval '1 second',$2) data",[tenant,q])).data
 const r=await report();assert.equal(r.stats.total,3);assert.equal(r.stats.verifiedSatang,900);assert.equal(r.series.reduce((sum,d)=>sum+Number(d.count),0),3);assert.equal(r.series.reduce((sum,d)=>sum+Number(d.amount),0),9);assert.equal(r.stats.review+r.stats.verified+r.stats.rejected+r.stats.cancelled,r.stats.total);n++
 assert.equal((await report('AMOUNT')).attempts.length,1);assert.equal((await report("%' OR 1=1 --")).attempts.length,0);n++
 await db.exec('set role authenticated');await assert.rejects(report(),/permission denied/);await db.exec('reset role');n++
 console.log(`PASS: ${n} real PostgreSQL bank controls and Payment Pro report scenarios`)
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1})
