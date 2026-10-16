// Isolated PostgreSQL fixture. No .env, live database, storage or Provider API access.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite')
const sql = name => readFileSync(join(__dirname, '../supabase', name), 'utf8')
async function main() {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key default gen_random_uuid(), raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table tenants(id uuid primary key default gen_random_uuid(),slip_quota integer default 500,slip_used integer default 0);
      create table platform_admins(user_id uuid primary key references auth.users(id));
      create table tenant_members(tenant_id uuid references tenants(id),user_id uuid references auth.users(id),role text);
      create table bot_settings(tenant_id uuid primary key references tenants(id),reply_mode text);
      create table slips(id uuid primary key default gen_random_uuid(),status text,trans_ref text);
      create function consume_slip_credit(p_tenant uuid) returns boolean language sql as $$
        with taken as (update tenants set slip_used=slip_used+1 where id=p_tenant and slip_used<slip_quota returning 1)
        select exists(select 1 from taken)$$;
      create function refund_slip_credit(p_tenant uuid) returns void language sql as $$
        update tenants set slip_used=slip_used-1 where id=p_tenant and slip_used>0$$;
      grant usage on schema public to authenticated, service_role;
      grant all on tenants,slips to service_role;
    `)
    await db.exec(sql('billing.sql').replace(/^do \$\$ begin alter publication.*$/gm, ''))
    await db.exec(sql('payments.sql'))
    await db.exec(sql('admin-feature-bypass.sql'))
    await db.exec(sql('billing-slip-topups.sql'))
    await db.exec(sql('platform-dashboard.sql'))
    await db.exec(sql('platform-dashboard.sql'))
    await db.exec(sql('platform-admin-db-only.sql'))
    await db.exec(sql('platform-admin-db-only.sql'))
    await db.exec('grant all on billing_requests to service_role')
    const user = async (app={},meta={}) => (await db.query('insert into auth.users(raw_app_meta_data,raw_user_meta_data) values ($1,$2) returning id',[app,meta])).rows[0].id
    const owner = await user({}, { role: 'superadmin', is_platform_admin: true })
    const admin = await user({role:'superadmin'})
    const flagAdmin = await user({is_platform_admin:true})
    const tableAdmin = await user()
    await db.query('insert into platform_admins values($1)',[tableAdmin])
    const tenant = (await db.query("insert into tenants(plan,broadcast_topup_credits,slip_quota_credits,slip_used) values('starter',99,500,10) returning id")).rows[0].id
    await db.query("insert into tenant_members values($1,$2,'owner')",[tenant,owner])
    const identity = async id => db.query("select set_config('test.user_id',$1,false)",[id || ''])
    await identity(owner)
    assert.equal((await db.query('select is_platform_admin() as ok')).rows[0].ok,false)
    assert.equal((await db.query('select can_access_tenant($1) as ok',[tenant])).rows[0].ok,true)
    await assert.rejects(db.query("select platform_update_tenant($1,$2,'pro',null)",[tenant,owner]),/Only platform admins/)
    for (const id of [admin,flagAdmin]) {
      await identity(id)
      assert.equal((await db.query('select is_platform_admin() as ok')).rows[0].ok,false)
      await assert.rejects(db.query("select platform_update_tenant($1,$2,'pro',null)",[tenant,id]),/Only platform admins/)
    }
    await db.query('insert into platform_admins values($1),($2)',[admin,flagAdmin])
    for (const id of [admin,flagAdmin,tableAdmin]) {
      await identity(id)
      assert.equal((await db.query('select is_platform_admin() as ok')).rows[0].ok,true)
    }
    await db.query("select platform_update_tenant($1,$2,'pro',false)",[tenant,admin])
    let row = (await db.query('select * from tenants where id=$1',[tenant])).rows[0]
    assert.equal(row.plan,'pro')
    assert.equal(row.broadcast_credits,7500)
    assert.equal(row.broadcast_topup_credits,99)
    assert.equal(row.slip_quota_credits,500)
    assert.equal(row.slip_used,10)
    assert.equal(row.is_active,false)
    assert.equal(row.broadcast_credit_mode,'purchased')
    assert.equal((await db.query("select abs(extract(epoch from (plan_expires_at-now()-interval '30 days'))) < 5 as ok from tenants where id=$1",[tenant])).rows[0].ok,true)
    await identity(owner)
    assert.equal((await db.query('select can_access_tenant($1) as ok',[tenant])).rows[0].ok,false)
    await identity(admin)
    assert.equal((await db.query('select can_access_tenant($1) as ok',[tenant])).rows[0].ok,true)
    await db.query('select platform_update_tenant($1,$2,null,true)',[tenant,flagAdmin])
    await identity(owner)
    assert.equal((await db.query('select can_access_tenant($1) as ok',[tenant])).rows[0].ok,true)
    await assert.rejects(db.query("select platform_update_tenant($1,$2,'invalid',null)",[tenant,admin]),/Unknown plan/)
    assert.equal((await db.query('select count(*)::integer as n from platform_tenant_audit')).rows[0].n,2)
    // One current approval, one pending order, and an old approval excluded from revenue.
    const pending = (await db.query("insert into billing_requests(tenant_id,item,price_baht,credits) values($1,'slip_topup_s',100,500) returning id",[tenant])).rows[0].id
    assert.equal((await db.query('select approve_billing_request($1,$2) as result',[pending,admin])).rows[0].result,null)
    await db.query("insert into billing_requests(tenant_id,item,price_baht,credits,status,decided_at) values($1,'topup_s',100,400,'pending',null),($1,'topup_m',300,1500,'approved',now()-interval '2 months')",[tenant])
    await db.query(`insert into payment_sessions(tenant_id,plan,price_baht,credits,status,paid_at,receiver_promptpay_id,receiver_account_no,receiver_account_name,receiver_bank_name,receiver_bank_code)
      values($1,'starter',390,1500,'paid',now(),'0812345678','1234567890','Test','KBANK','004')`,[tenant])
    const overview = (await db.query('select platform_dashboard_overview() as value')).rows[0].value
    assert.deepEqual(overview,{ tenantCount:1,activeTenantCount:1,monthRevenue:490,pendingCount:1,pendingAmount:100 })
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select platform_dashboard_overview()'),/permission denied/)
    await assert.rejects(db.query('select platform_update_tenant($1,$2,null,false)',[tenant,owner]),/permission denied/)
    await assert.rejects(db.query('select * from platform_tenant_audit'),/permission denied/)
    await db.exec('reset role')
    row = (await db.query('select * from tenants where id=$1',[tenant])).rows[0]
    await db.exec(sql('platform-dashboard.sql'))
    assert.deepEqual((await db.query('select * from tenants where id=$1',[tenant])).rows[0],row)
    assert.equal((await db.query("select public from storage.buckets where id='billing-proofs'")).rows[0].public,false)
    console.log('PASS: trusted admin roles, spoof rejection, suspension access, audited plan changes, preserved topups, monthly revenue, service-only permissions and reruns')
    await db.exec(sql('billing-auto-approval.sql'))
    await db.exec(sql('billing-auto-approval.sql'))
    const invoice = async item => (await db.query("insert into billing_requests(tenant_id,item,price_baht,credits,proof_path) values($1,$2,100,500,'private.jpg') returning id",[tenant,item])).rows[0].id
    const proof = async (request,ref,hash,amount=100) => db.query('insert into billing_payment_receipts(request_id,trans_ref,image_sha256,amount,paid_at) values($1,$2,$3,$4,now())',[request,ref,hash.repeat(64),amount])
    const activate = async request => (await db.query('select activate_billing_payment($1) as ok',[request])).rows[0].ok
    const first = await invoice('slip_topup_m')
    await assert.rejects(activate(first),/Server-verified/)
    await assert.rejects(proof(first,'underpaid','a',99.99),/amount/)
    await proof(first,'auto-transfer','a',120)
    const before = (await db.query('select broadcast_topup_credits,slip_quota_credits from tenants where id=$1',[tenant])).rows[0]
    assert.equal(await activate(first),true)
    assert.equal(await activate(first),true)
    const after = (await db.query('select broadcast_topup_credits,slip_quota_credits from tenants where id=$1',[tenant])).rows[0]
    assert.equal(after.slip_quota_credits,before.slip_quota_credits+500)
    assert.equal(after.broadcast_topup_credits,before.broadcast_topup_credits)
    const broadcast = await invoice('topup_l')
    await assert.rejects(proof(broadcast,'auto-transfer','b'),/Transfer already accepted/)
    await assert.rejects(proof(broadcast,'another-transfer','a'),/Image already accepted|unique constraint/)
    await proof(broadcast,'broadcast-transfer','b')
    assert.equal(await activate(broadcast),true)
    const balance = (await db.query('select broadcast_topup_credits,slip_quota_credits from tenants where id=$1',[tenant])).rows[0]
    assert.equal(balance.broadcast_topup_credits,after.broadcast_topup_credits+500)
    assert.equal(balance.slip_quota_credits,after.slip_quota_credits)
    await assert.rejects(db.query("update billing_payment_receipts set amount=999 where request_id=$1",[first]),/immutable/)
    await assert.rejects(db.query("insert into slips(status,trans_ref) values('valid','auto-transfer')"),/Transfer already accepted/)
    const duplicatePackage = (await db.query(`insert into payment_sessions(tenant_id,plan,price_baht,credits,receiver_promptpay_id,receiver_account_no,receiver_account_name,receiver_bank_name,receiver_bank_code)
      values($1,'starter',390,1500,'0812345678','1234567890','Test','KBANK','004') returning id`,[tenant])).rows[0].id
    await assert.rejects(db.query("insert into payment_receipts(session_id,trans_ref,image_sha256,amount,paid_at) values($1,'auto-transfer',$2,400,now())",[duplicatePackage,'c'.repeat(64)]),/Transfer already accepted/)
    await assert.rejects(db.query("insert into payment_receipts(session_id,trans_ref,image_sha256,amount,paid_at) values($1,'new-package-transfer',$2,400,now())",[duplicatePackage,'b'.repeat(64)]),/Image already accepted/)
    await db.query("insert into payment_receipts(session_id,trans_ref,image_sha256,amount,paid_at) values($1,'new-package-transfer',$2,400,now())",[duplicatePackage,'c'.repeat(64)])
    await db.query('select activate_payment($1)',[duplicatePackage])
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select activate_billing_payment($1)',[first]),/permission denied/)
    await assert.rejects(db.query('select * from billing_payment_receipts'),/permission denied/)
    await db.exec('reset role')
    await db.exec(sql('billing-auto-approval.sql'))
    assert.equal(await activate(first),true)
    const manual = await invoice('slip_topup_l')
    await db.query('update billing_requests set proof_sha256=$1 where id=$2',['d'.repeat(64),manual])
    await db.query('select approve_billing_request($1,$2)',[manual,admin])
    assert.equal((await db.query('select source from payment_image_ledger where image_sha256=$1',['d'.repeat(64)])).rows[0].source,'billing')
    const saleDuplicate = await invoice('slip_topup_m')
    await db.query("insert into slips(status,trans_ref) values('valid','sale-used-reference')")
    await assert.rejects(proof(saleDuplicate,'sale-used-reference','e'),/Transfer already accepted/)
    await assert.rejects(proof(saleDuplicate,'different-reference','d'),/Image already accepted/)
    console.log('PASS: automatic separate balances, overpayment, underpayment rejection, trusted proof, idempotent activation, global transfer/image duplicates, immutable receipts, permissions and reruns')
    await db.exec(sql('package-access.sql'))
    await db.exec(sql('package-access.sql'))
    const openShop = (await db.query("insert into tenants(plan,broadcast_credits,slip_quota_credits) values('free',200,0) returning id")).rows[0].id
    const purchase = async (item,credits) => (await db.query('insert into billing_requests(tenant_id,item,price_baht,credits) values($1,$2,100,$3) returning id',[openShop,item,credits])).rows[0].id
    const credit = async request => (await db.query('select approve_billing_request($1,$2) result',[request,admin])).rows[0].result
    for (const [item,amount] of [['topup_s',400],['topup_m',1500],['topup_l',3000],['slip_topup_s',500],['slip_topup_m',2000],['slip_topup_l',5000]]) {
      const request=await purchase(item,amount)
      assert.equal(await credit(request),null)
      assert.equal(await credit(request),null)
    }
    let openRow=(await db.query('select * from tenants where id=$1',[openShop])).rows[0]
    assert.equal(openRow.broadcast_topup_credits,4900)
    assert.equal(openRow.slip_quota_credits,7500)
    for (let i=0;i<2;i++) assert.equal(await credit(await purchase('starter',1500)),null)
    openRow=(await db.query('select * from tenants where id=$1',[openShop])).rows[0]
    assert.equal(openRow.broadcast_credits,3200)
    assert.equal(openRow.broadcast_credit_mode,'purchased')
    assert.equal(openRow.broadcast_topup_credits,4900)
    assert.equal(openRow.slip_quota_credits,7500)
    await db.query("insert into bot_settings(tenant_id,reply_mode) values($1,'ai')",[openShop])
    console.log('PASS: free-plan S/M/L purchases, separate accumulated balances, idempotent approvals, additive plan credits and unlocked AI')
  } finally { await db.close() }
}
main().catch(error => { console.error(error); process.exitCode=1 })
