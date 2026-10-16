// Isolated PostgreSQL only. Never loads environment secrets or sends any messages.
const assert=require('node:assert/strict'),fs=require('node:fs'),{test}=require('node:test'),{PGlite}=require('@electric-sql/pglite')
test('safety migration is repeatable; stop is audited/scoped; human reply ownership and lease are atomic',async()=>{
 const db=new PGlite()
 try{
  const fixture=fs.readFileSync('scripts/test-smart-inbox-sql.cjs','utf8').split('await db.exec(`')[1].split('`)')[0]
  await db.exec(fixture);await db.exec(fs.readFileSync('supabase/smart-inbox.sql','utf8'))
  const migration=fs.readFileSync('supabase/automation-safety.sql','utf8');await db.exec(migration);await db.exec(migration)
  await db.exec('set role service_role')
  const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
  const owner=(await one('insert into auth.users default values returning id')).id,staff=(await one('insert into auth.users default values returning id')).id,foreign=(await one('insert into auth.users default values returning id')).id
  const shop=(await one('insert into tenants default values returning id')).id,other=(await one('insert into tenants default values returning id')).id
  await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff'),($4,$5,'owner')",[shop,owner,staff,other,foreign])
  const stop=(actor,value=true)=>db.query('select set_tenant_automation_stop($1,$2,$3,$4)',[shop,actor,value,'test-only'])
  await assert.rejects(stop(staff),e=>e.code==='42501');await assert.rejects(stop(foreign),e=>e.code==='42501')
  await stop(owner);assert.equal((await one('select stopped from tenant_automation_controls where tenant_id=$1',[shop])).stopped,true)
  assert.equal((await one('select count(*)::int n from tenant_automation_controls where tenant_id=$1',[other])).n,0)
  await stop(owner,false);assert.equal((await one('select count(*)::int n from tenant_automation_audit where tenant_id=$1',[shop])).n,2)
  const customer=(await one('insert into customers(tenant_id) values($1) returning id',[shop])).id
  const reply=(actor,version)=>one('select claim_and_start_inbox_reply($1,$2,$3) lease',[customer,actor,version])
  await assert.rejects(reply(foreign,0),e=>e.code==='42501')
  const lease=(await reply(staff,0)).lease;assert.ok(lease)
  const state=await one('select * from customers where id=$1',[customer]);assert.equal(state.bot_enabled,false);assert.equal(state.assigned_user_id,staff);assert.equal(state.conversation_version,1)
  await assert.rejects(reply(owner,1),e=>e.code==='40001')
  await assert.rejects(db.query('select start_inbox_delivery($1,null)',[customer]),e=>e.code==='40001')
  await db.query('select end_inbox_delivery($1,$2)',[customer,lease]);await assert.rejects(reply(staff,0),e=>e.code==='40001');assert.ok((await reply(staff,1)).lease)
  const busy=(await one('insert into customers(tenant_id) values($1) returning id',[shop])).id
  await db.query('select start_inbox_delivery($1,null)',[busy])
  await assert.rejects(db.query('select claim_and_start_inbox_reply($1,$2,0)',[busy,staff]),e=>e.code==='55P03')
  assert.equal((await one('select bot_enabled from customers where id=$1',[busy])).bot_enabled,true)
  await db.exec('set role authenticated')
  await assert.rejects(db.query('select * from tenant_automation_controls'),e=>e.code==='42501')
  await assert.rejects(stop(owner),e=>e.code==='42501')
 }finally{await db.close()}
})
