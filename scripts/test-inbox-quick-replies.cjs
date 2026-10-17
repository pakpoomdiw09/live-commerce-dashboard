const assert=require('node:assert/strict'),fs=require('node:fs'),{test}=require('node:test'),{PGlite}=require('@electric-sql/pglite')

const vm=require('node:vm'),ts=require('typescript')
function load(file,deps={},env={}){const c={exports:{},Date,process:{env},require:n=>{if(n==='./feature-flags')return load('lib/feature-flags.ts',{},env);if(n in deps)return deps[n];throw Error(n)}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,c);return c.exports}

test('quick reply storage: tenant/plan guards, durable retries, bounded input, rate and service-only access',async()=>{
 const db=new PGlite();try{
 await db.exec(fs.readFileSync('scripts/test-smart-inbox-sql.cjs','utf8').split('await db.exec(`')[1].split('`)')[0])
 const sql=fs.readFileSync('supabase/inbox-quick-replies.sql','utf8');await db.exec(sql);await db.exec(sql);await db.exec('set role service_role')
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
 const actor=(await one('insert into auth.users default values returning id')).id,foreign=(await one('insert into auth.users default values returning id')).id
 const tenant=(await one('insert into tenants default values returning id')).id,other=(await one('insert into tenants default values returning id')).id
 await db.query("insert into tenant_members values($1,$2,'staff'),($3,$4,'owner')",[tenant,actor,other,foreign])
 const save=(a=actor,key=crypto.randomUUID(),body='คำตอบจากร้าน')=>db.query('select save_inbox_quick_reply($1,$2,$3,$4)',[tenant,a,key,body])
 await assert.rejects(save(foreign),e=>e.code==='42501')
 await db.query("update tenants set plan='free' where id=$1",[tenant]);await assert.rejects(save(),e=>e.code==='42501');await db.query("update tenants set plan='starter' where id=$1",[tenant])
 for(const text of ['', ' ', 'x'.repeat(2001)])await assert.rejects(save(actor,crypto.randomUUID(),text),e=>e.code==='22023')
 const key=crypto.randomUUID();await save(actor,key);await save(actor,key);assert.equal((await one('select count(*) n from inbox_quick_replies')).n,1)
 const named=await one('select save_inbox_quick_reply($1,$2,$3,$4,$5) result',[other,foreign,crypto.randomUUID(),'สวัสดีค่ะ','ทักทาย']);assert.equal(named.result.shortcut,'ทักทาย');assert.equal((await one('select shortcut from inbox_quick_replies where tenant_id=$1',[other])).shortcut,'ทักทาย')
 await assert.rejects(db.query('select save_inbox_quick_reply($1,$2,$3,$4,$5)',[other,foreign,crypto.randomUUID(),'test','x'.repeat(61)]),e=>e.code==='22023')
 await assert.rejects(save(actor,key,'Changed'),e=>e.code==='22023')
 for(let i=0;i<29;i++)await save()
 await assert.rejects(save(),e=>e.code==='P0429')
 await db.exec("update inbox_quick_replies set created_at='2000-01-01'")
 for(let i=0;i<70;i++){await save();if(i%20===19)await db.exec("update inbox_quick_replies set created_at='2000-01-01'")}
 await assert.rejects(save(),e=>e.code==='22023')
 assert.equal((await one('select count(*) n from inbox_quick_replies')).n,101)
 assert.equal((await one('select count(*) n from messages')).n,0)
 await db.exec('reset role;set role authenticated');await assert.rejects(save(),e=>e.code==='42501');await assert.rejects(db.query('select * from inbox_quick_replies'),e=>e.code==='42501')
 }finally{await db.close()}
})
test('quick reply API authorizes before reads/mutations and rejects cross-site writes',async()=>{
 let accesses=0,rpc=0;class InboxError extends Error{constructor(message,status=400){super(message);this.status=status}}
 const deps={'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},'@/lib/utils':{UUID:/^[a-f0-9-]{36}$/},'@/lib/inbox-server':{InboxError,inboxError:e=>({status:e.status??503}),checkRpc:()=>{},inboxTenant:async()=>{accesses++;throw new InboxError('Forbidden',403)}}}
 const route=load('app/api/inbox/quick-replies/route.ts',deps),req={nextUrl:{origin:'https://shop.test',searchParams:new URLSearchParams('tenantId=tenant')},headers:{get:()=>null}}
 assert.equal((await route.GET(req)).status,403);assert.equal(accesses,1)
 assert.equal((await route.POST({...req,headers:{get:key=>key==='origin'?'https://evil.test':null}})).status,403);assert.equal(accesses,1)
 deps['@/lib/inbox-server'].inboxTenant=async()=>({tenantId:'tenant',actor:{id:'actor'},db:{rpc:async(name,args)=>{rpc++;assert.equal(args.p_tenant,'tenant');assert.equal(args.p_actor,'actor');assert.equal(args.p_shortcut,'ขอบคุณ');return {data:{id:args.p_key,body:args.p_body},error:null}}}})
 const authorized=load('app/api/inbox/quick-replies/route.ts',deps)
 assert.equal((await authorized.POST({...req,json:async()=>({body:'  '})})).status,400);assert.equal(rpc,0)
 const result=await authorized.POST({...req,json:async()=>({requestId:crypto.randomUUID(),body:' ข้อความร้าน ',shortcut:' ขอบคุณ '})});assert.equal(result.status,200);assert.equal(result.body.reply.body,'ข้อความร้าน');assert.equal(rpc,1)
})
