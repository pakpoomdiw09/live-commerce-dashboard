// Isolated PostgreSQL and real validation; never reads .env or contacts Supabase.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite')
const catalog={}
new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/features/vision/image-rules.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(catalog)
const draft={name:'Test',trigger_type:'slip',response_text:'Received',media_url:null,is_active:true}
assert.equal(catalog.imageRuleError(draft),null)
assert.equal(catalog.imageRuleError({...draft,response_text:'',media_url:'https://example.com/image.png'}),null)
for(const changes of [{name:' '},{trigger_type:'invalid'},{response_text:'',media_url:null},{response_text:'x'.repeat(2001)},{media_url:'javascript:alert(1)'}])assert.ok(catalog.imageRuleError({...draft,...changes}))
async function main(){
 const db=new PGlite()
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
   create table tenants(id uuid primary key default gen_random_uuid(),is_active boolean default true);
   create table tenant_members(tenant_id uuid,user_id uuid,role text);
   create table platform_admins(user_id uuid);
   create function is_platform_admin() returns boolean language sql security definer as $$select exists(select 1 from platform_admins where user_id=auth.uid())$$;
   create function can_access_tenant(p_tenant uuid) returns boolean language sql security definer as $$select is_platform_admin() or exists(select 1 from tenants t join tenant_members m on m.tenant_id=t.id where t.id=p_tenant and t.is_active and m.user_id=auth.uid())$$;
   grant usage on schema public,auth to authenticated;
  `)
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/image-response-rules.sql'),'utf8')
  await db.exec(sql);await db.exec(sql)
  const shop=(await db.query('insert into tenants default values returning id')).rows[0].id
  const other=(await db.query('insert into tenants default values returning id')).rows[0].id
  const owner='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333'
  await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')",[shop,owner,staff])
  await db.query('insert into platform_admins values($1)',[admin])
  await db.exec('set role authenticated')
  const identity=id=>db.query("select set_config('test.user_id',$1,false)",[id])
  const create=tenant=>db.query("insert into image_response_rules(tenant_id,name,trigger_type,response_text) values($1,'Rule','general','Reply') returning id",[tenant])
  await identity(owner)
  const id=(await create(shop)).rows[0].id
  await db.query('update image_response_rules set is_active=false,response_text=$1 where id=$2',['Edited',id])
  assert.equal((await db.query('select is_active from image_response_rules where id=$1',[id])).rows[0].is_active,false)
  await assert.rejects(create(other),/row-level security/)
  await assert.rejects(db.query('update image_response_rules set tenant_id=$1 where id=$2',[other,id]),/row-level security/)
  await assert.rejects(db.query('update image_response_rules set response_text=null,media_url=null where id=$1',[id]),/check constraint/)
  await identity(staff)
  assert.equal((await db.query('select * from image_response_rules')).rows.length,1)
  assert.equal((await db.query('update image_response_rules set is_active=true where id=$1 returning id',[id])).rows.length,0)
  assert.equal((await db.query('delete from image_response_rules where id=$1 returning id',[id])).rows.length,0)
  await assert.rejects(create(shop),/row-level security/)
  await identity('44444444-4444-4444-8444-444444444444')
  assert.equal((await db.query('select * from image_response_rules')).rows.length,0)
  await identity(admin)
  assert.equal((await create(other)).rows.length,1)
  assert.equal((await db.query('select * from image_response_rules')).rows.length,2)
  await identity(owner)
  await db.exec('reset role')
  await db.query('update tenants set is_active=false where id=$1',[shop])
  await db.exec('set role authenticated')
  assert.equal((await db.query('select * from image_response_rules')).rows.length,0)
  await assert.rejects(create(shop),/row-level security/)
  await identity(admin)
  assert.equal((await db.query('delete from image_response_rules where id=$1 returning id',[id])).rows.length,1)
  console.log('PASS: validation, CRUD, toggles, tenant isolation, owner/admin edits, staff read-only, suspended shops and migration reruns')
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
