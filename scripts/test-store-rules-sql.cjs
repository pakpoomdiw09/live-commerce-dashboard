const assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite')
;(async()=>{const db=new PGlite();try{
 let fixture=fs.readFileSync('scripts/test-smart-followups-sql.cjs','utf8').split('await db.exec(`')[1].split('`)')[0]
 fixture=fixture.replace("name text default 'Shop',","name text default 'Shop',slip_quota integer default 10,slip_used integer default 0,slip_quota_credits integer default 0,").replace("reply_mode text default 'keyword',","reply_mode text default 'keyword',ai_instructions text check(length(ai_instructions)<=8000),")
 await db.exec(fixture);await db.exec('create table comments(id uuid primary key,tenant_id uuid);create table image_response_rules(id uuid primary key,tenant_id uuid);')
 for(const file of ['feature-access.sql','smart-inbox.sql','smart-follow-ups.sql','agent-control.sql','store-rules.sql','store-rules.sql','store-rule-items.sql','store-rule-items.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'))
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
 const tenant=(await one('insert into tenants default values returning id')).id,other=(await one('insert into tenants default values returning id')).id
 const owner=(await one('insert into auth.users default values returning id')).id,staff=(await one('insert into auth.users default values returning id')).id
 await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')",[tenant,owner,staff])
 const save=(text,actor=owner,shop=tenant)=>db.query('select save_agent_prompt($1,$2,$3)',[shop,actor,text])
 await save('ก'.repeat(50000));assert.equal((await one('select length(ai_instructions) n from bot_settings where tenant_id=$1',[tenant])).n,50000)
 assert.equal((await one('select length(instructions) n from agent_prompt_versions where tenant_id=$1 order by version desc limit 1',[tenant])).n,50000)
 await assert.rejects(save('ก'.repeat(50001)),error=>error.code==='22023')
 await assert.rejects(db.query('update bot_settings set ai_instructions=$2 where tenant_id=$1',[tenant,'ก'.repeat(50001)]),error=>error.code==='23514')
 await assert.rejects(save('unauthorized',staff),error=>error.code==='42501');await assert.rejects(save('foreign',owner,other),error=>error.code==='42501')
 await save('แก้ไขกฎ');assert.equal((await one('select count(*)::int n from agent_prompt_versions where tenant_id=$1',[tenant])).n,2)
 assert.equal((await one("select has_function_privilege('service_role','public.manage_agent_knowledge(uuid,uuid,text,uuid,jsonb)','EXECUTE') allowed")).allowed,false)
 const list=JSON.stringify({snapbot_store_rules:1,rules:[{id:'one',body:'ค่าบริการ 50 บาท'}]})
 await db.query('select save_store_rule_items($1,$2,$3,$4)',[tenant,owner,'แก้ไขกฎ',list])
 await assert.rejects(db.query('select save_store_rule_items($1,$2,$3,$4)',[tenant,owner,'แก้ไขกฎ',list]),error=>error.code==='40001')
 await assert.rejects(db.query('select save_store_rule_items($1,$2,$3,$4)',[tenant,staff,list,list]),error=>error.code==='42501')
 assert.equal((await one('select ai_instructions from bot_settings where tenant_id=$1',[tenant])).ai_instructions,list)
 const metadata=JSON.stringify({snapbot_store_rules:1,rules:[{id:'one',body:'ค่าบริการ 50 บาท',category:'shipping',enabled:false}]})
 await db.query('select save_store_rule_items($1,$2,$3,$4)',[tenant,owner,list,metadata])
 for(const bad of [{category:'invented',enabled:true},{category:'general',enabled:'false'}]){
  const invalid=JSON.stringify({snapbot_store_rules:1,rules:[{id:'one',body:'text',...bad}]})
  await assert.rejects(db.query('select save_store_rule_items($1,$2,$3,$4)',[tenant,owner,metadata,invalid]),error=>error.code==='22023')
 }
 const broken='{"snapbot_store_rules":1,"rules":null}'
 await save(broken)
 await db.query('delete from agent_prompt_versions where tenant_id=$1 and instructions=$2',[tenant,broken])
 const before=(await one('select count(*)::int n from agent_prompt_versions where tenant_id=$1',[tenant])).n
 const validation=fs.readFileSync('supabase/store-rules-validation.sql','utf8');await db.exec(validation);await db.exec(validation)
 assert.equal((await one('select ai_instructions from bot_settings where tenant_id=$1',[tenant])).ai_instructions,broken)
 assert.equal((await one('select count(*)::int n from agent_prompt_versions where tenant_id=$1',[tenant])).n,before)
 await db.query("update bot_settings set reply_mode='keyword' where tenant_id=$1",[tenant])
 for(const invalid of [broken,'{"snapbot_store_rules":2,"rules":[]}','{"snapbot_store_rules":1,"rules":[{"id":"","body":"text"}]}','{"snapbot_store_rules":1,"rules":[],"unknown":true}','{"snapbot_store_rules":1,"rules":[{"id":"x","body":"text","enabled":"false"}]}']){
  await assert.rejects(save(invalid),error=>error.code==='22023')
  await assert.rejects(db.query('update bot_settings set ai_instructions=$2 where tenant_id=$1',[tenant,invalid+' ']),error=>error.code==='22023')
 }
 const recovered='  กฎเดิมที่แก้ไขแล้ว\n'
 await db.query('select save_validated_store_rules($1,$2,$3,$4)',[tenant,owner,broken,recovered])
 assert.equal((await one('select ai_instructions from bot_settings where tenant_id=$1',[tenant])).ai_instructions,recovered)
 assert.equal((await one('select count(*)::int n from agent_prompt_versions where tenant_id=$1 and instructions=$2',[tenant,broken])).n,1)
 await assert.rejects(db.query('select save_validated_store_rules($1,$2,$3,$4)',[tenant,owner,broken,'stale overwrite']),error=>error.code==='40001')
 await assert.rejects(db.query('select save_validated_store_rules($1,$2,$3,$4)',[tenant,staff,recovered,'forged']),error=>error.code==='42501')
 await db.exec('set role authenticated');await assert.rejects(save('direct browser write'),error=>error.code==='42501')
 await assert.rejects(db.query('select save_validated_store_rules($1,$2,$3,$4)',[tenant,owner,recovered,'forged']),error=>error.code==='42501')
 console.log('PASS: 50000-character storage and prompt history, RPC and direct constraint limits, owner/tenant isolation, archived Q&A RPC disabled and migration rerun')
 }finally{await db.close()}})().catch(error=>{console.error(error);process.exitCode=1})
