// Isolated PostgreSQL fixture; no live credentials or services.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite')
async function main(){const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
 create table tenants(id uuid primary key default gen_random_uuid(),name text default 'Shop',account_name text,account_number text,bank_code text,is_active boolean default true);
 create table tenant_members(tenant_id uuid,user_id uuid,role text);create table platform_admins(user_id uuid);
 create function is_platform_admin() returns boolean language sql security definer as $$select exists(select 1 from platform_admins where user_id=auth.uid())$$;
 create function can_access_tenant(p_tenant uuid) returns boolean language sql security definer as $$select is_platform_admin() or exists(select 1 from tenants t join tenant_members m on m.tenant_id=t.id where t.id=p_tenant and t.is_active and m.user_id=auth.uid())$$;
 grant usage on schema public,auth to authenticated;grant select on tenants to authenticated;
 `)
 const shop=(await db.query("insert into tenants(bank_code,account_name,account_number) values('KBANK','Owner','123-4-56789-0') returning id")).rows[0].id
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/bank-accounts.sql'),'utf8')
 await db.exec(sql);await db.exec(sql)
 assert.equal((await db.query('select count(*)::int n from bank_accounts')).rows[0].n,1)
 const first=(await db.query('select * from bank_accounts')).rows[0]
 assert.equal(first.account_number,'1234567890')
 const other=(await db.query('insert into tenants default values returning id')).rows[0].id
 const owner='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222'
 await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')",[shop,owner,staff])
 await db.query("select set_config('test.user_id',$1,false)",[owner]);await db.exec('set role authenticated')
 const second=(await db.query("insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'SCB','Owner SCB','9876543210') returning id",[shop])).rows[0].id
 await assert.rejects(db.query("insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'SCB','Owner SCB','9876543210')",[shop]),/unique constraint/)
 await assert.rejects(db.query("insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'BBL','Other','9876543210')",[other]),/row-level security/)
 await db.query('update bank_accounts set is_active=false where id=$1',[first.id])
 assert.equal((await db.query('select account_number from tenants where id=$1',[shop])).rows[0].account_number,'9876543210')
 await db.query('update bank_accounts set is_active=false where id=$1',[second])
 assert.equal((await db.query('select account_number from tenants where id=$1',[shop])).rows[0].account_number,null)
 await db.query("select set_config('test.user_id',$1,false)",[staff])
 assert.equal((await db.query('select * from bank_accounts')).rows.length,2)
 assert.equal((await db.query('delete from bank_accounts returning id')).rows.length,0)
 await assert.rejects(db.query("insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'SCB','Staff','9876543210')",[shop]),/row-level security/)
 await db.exec('reset role');await db.exec(sql)
 assert.equal((await db.query('select count(*)::int n from bank_accounts where is_active')).rows[0].n,0)
 await db.query("select set_config('test.user_id',$1,false)",[owner]);await db.exec('set role authenticated')
 await db.query('delete from bank_accounts where id=$1',[first.id]);await db.query('delete from bank_accounts where id=$1',[second]);await db.exec('reset role');await db.exec(sql)
 assert.equal((await db.query('select count(*)::int n from bank_accounts')).rows[0].n,0)
 const created=(await db.query("insert into tenants(bank_code,account_number,account_name) values('PROMPTPAY','0812345678','New Owner') returning id")).rows[0].id
 assert.equal((await db.query('select count(*)::int n from bank_accounts where tenant_id=$1',[created])).rows[0].n,1)
 console.log('PASS: legacy migration, multiple accounts, duplicates, owner/staff isolation, active primary sync, deletion reruns and tenant creation')
}finally{await db.close()}}
main().catch(e=>{console.error(e);process.exitCode=1})
