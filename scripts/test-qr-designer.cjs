const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test'),{PGlite}=require('@electric-sql/pglite')
test('designer validates colors and bounded text; five distinct templates',()=>{
 const context={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/features/payments/qr-design.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context)
 const {validateQrDesign,defaultQrDesign,qrTemplates}=context.exports
 assert.equal(qrTemplates.length,5);assert.equal(new Set(qrTemplates.map(t=>t.frame)).size,5)
 assert.equal(validateQrDesign(defaultQrDesign).caption,'สแกนเพื่อชำระเงิน')
 for(const value of [null,{}, {...defaultQrDesign,frame:'url(evil)'},{...defaultQrDesign,shop:'a'.repeat(81)}])assert.throws(()=>validateQrDesign(value))
})
test('designer SQL: repeatable migration, private assets, owner/tenant gates, optimistic version, audit, preserved account',async()=>{
 const db=new PGlite()
 try{
  await db.exec(fs.readFileSync('scripts/test-bank-accounts-sql.cjs','utf8').split('await db.exec(`')[1].split('`)')[0])
  await db.exec("create table auth.users(id uuid primary key default gen_random_uuid());create function has_tenant_feature(uuid,text) returns boolean language sql as $$select true$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;")
  await db.exec(fs.readFileSync('supabase/bank-accounts.sql','utf8'));await db.exec(fs.readFileSync('supabase/slip-bank-controls.sql','utf8'))
  const sql=fs.readFileSync('supabase/qr-payment-designer.sql','utf8');await db.exec(sql);await db.exec(sql)
  const one=async(q,args=[])=>(await db.query(q,args)).rows[0],owner=(await one('insert into auth.users default values returning id')).id,staff=(await one('insert into auth.users default values returning id')).id
  const shop=(await one('insert into tenants default values returning id')).id,other=(await one('insert into tenants default values returning id')).id
  await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')",[shop,owner,staff])
  const account=(await one("insert into bank_accounts(tenant_id,bank_code,account_name,account_number) values($1,'PROMPTPAY','Test','0812345678') returning id",[shop])).id
  const save=(actor=owner,tenant=shop,version=0,path=`${shop}/${account}/original`)=>db.query('select save_bank_qr_design($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[tenant,actor,account,'0812345678',require('promptpay-qr')('0812345678',{}),null,path,null,{background:'#ffffff',frame:'#f97316',shop:'Test',caption:'Pay'},version])
  await assert.rejects(save(staff),e=>e.code==='42501');await assert.rejects(save(owner,other),e=>e.code==='42501');await assert.rejects(save(owner,shop,0,'other/file'),e=>e.code==='22023')
  await save();await assert.rejects(save(),e=>e.code==='40001');await save(owner,shop,1)
  assert.equal((await one('select version from bank_qr_designs')).version,2)
  assert.equal((await one("select count(*)::int n from bank_account_audit where action='qr_design'")).n,2)
  assert.equal((await one('select public from storage.buckets')).public,false)
  await db.query("update bank_accounts set account_number='0899999999' where id=$1",[account]);await assert.rejects(save(owner,shop,2),e=>e.code==='40001')
  await db.exec('set role authenticated');await assert.rejects(db.query('select * from bank_qr_designs'),e=>e.code==='42501');await assert.rejects(save(owner,shop,2),e=>e.code==='42501')
 }finally{await db.close()}
})
