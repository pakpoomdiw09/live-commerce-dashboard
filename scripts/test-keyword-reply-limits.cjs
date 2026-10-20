const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite')
test('database limits keyword replies to 3 free / 20 active paid, including disabled rules and direct writes',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table tenants(id uuid primary key,plan text,is_active boolean default true,plan_expires_at timestamptz);
   create table chat_rules(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),is_active boolean default true,reply_text text);`)
  const sql=fs.readFileSync('supabase/keyword-reply-limits.sql','utf8');await db.exec(sql);await db.exec(sql)
  const free=crypto.randomUUID(),paid=crypto.randomUUID()
  await db.query("insert into tenants values($1,'free',true,null),($2,'starter',true,now()+interval '1 day')",[free,paid])
  const add=(tenant,active=true)=>db.query('insert into chat_rules(tenant_id,is_active) values($1,$2)',[tenant,active])
  for(let i=0;i<3;i++)await add(free,false)
  await assert.rejects(add(free),e=>e.code==='P0422')
  for(let i=0;i<20;i++)await add(paid)
  await assert.rejects(add(paid),e=>e.code==='P0422')
  await db.query("update tenants set plan_expires_at=now()-interval '1 second' where id=$1",[paid])
  await assert.rejects(add(paid),e=>e.code==='P0422')
  await db.query("update chat_rules set reply_text='Allowed edit after downgrade' where tenant_id=$1",[paid])
  await assert.rejects(db.query('update chat_rules set tenant_id=$1 where tenant_id=$2',[free,paid]),e=>e.code==='P0422')
  await db.query('delete from chat_rules where id=(select id from chat_rules where tenant_id=$1 limit 1)',[free]);await add(free)
  await db.query("update tenants set plan='pro',plan_expires_at=now()+interval '1 day' where id=$1",[free]);await add(free)
  await db.query('update tenants set is_active=false where id=$1',[free]);await assert.rejects(add(free),e=>e.code==='P0422')
  // Failure of a bulk insert rolls back all rows rather than leaving a partial batch.
  const fresh=crypto.randomUUID();await db.query("insert into tenants values($1,'standard',true,null)",[fresh])
  await assert.rejects(db.query('insert into chat_rules(tenant_id) select $1::uuid from generate_series(1,4)',[fresh]),e=>e.code==='P0422')
  assert.equal((await db.query('select count(*)::int n from chat_rules where tenant_id=$1',[fresh])).rows[0].n,0)
 }finally{await db.close()}
})
