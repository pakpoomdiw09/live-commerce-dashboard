// Isolated PostgreSQL/WASM. No configured Supabase, real orders or external services.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',foreign='33333333-3333-4333-8333-333333333333'
test('commerce migration, tenant guards, product versioning, publication, atomic stock and idempotent checkout',async()=>{
 const db=new PGlite()
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table tenants(id uuid primary key,name text,is_active boolean default true,plan text default 'starter',plan_expires_at timestamptz default now()+interval '1 month');
   create table tenant_members(tenant_id uuid,user_id uuid,role text);create table platform_admins(user_id uuid);create table customers(id uuid primary key);
   create table products(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),code text,name text,price numeric(12,2) check(price>0),stock integer check(stock>=0),is_active boolean default true,description text check(length(description)<=2000),image_url text,created_at timestamptz default now());
   create table orders(id uuid primary key default gen_random_uuid(),tenant_id uuid,customer_id uuid,product_id uuid,product_name text,amount numeric,message_id uuid);
   create unique index products_tenant_code on products(tenant_id,lower(code));`)
  const sql=fs.readFileSync('supabase/commerce-v2.sql','utf8');await db.exec(sql);await db.exec(sql)
  await db.query("insert into tenants(id,name) values($1,'Shop'),($2,'Other')",[tenant,foreign]);await db.query("insert into tenant_members values($1,$2,'owner')",[tenant,actor])
  const manage=(action,value)=>db.query('select commerce_manage($1,$2,$3,$4) id',[tenant,actor,action,JSON.stringify(value)])
  const value={code:'A1',name:'Real test product',description:'Test only',price:10,stock:1,images:[],category_id:null,compare_price:null,cost:null,featured:false,is_active:true,variants:[]}
  await assert.rejects(db.query('select commerce_save_product($1,$2,null,$3)',[foreign,actor,JSON.stringify(value)]))
  const product=(await db.query('select commerce_save_product($1,$2,null,$3) id',[tenant,actor,JSON.stringify(value)])).rows[0].id
  await assert.rejects(db.query('select commerce_save_product($1,$2,$3,$4,0)',[tenant,actor,product,JSON.stringify(value)]))
  const category=(await manage('category',{name:'Test category'})).rows[0].id
  const version=(await db.query('select commerce_version from products where id=$1',[product])).rows[0].commerce_version
  await db.query('select commerce_save_product($1,$2,$3,$4,$5)',[tenant,actor,product,JSON.stringify({...value,category_id:category,name:'Updated product'}),version])
  assert.equal((await db.query('select name from products where id=$1',[product])).rows[0].name,'Updated product')
  await manage('category_delete',{id:category})
  assert.equal((await db.query('select commerce_category_id from products where id=$1',[product])).rows[0].commerce_category_id,null)
  await manage('store',{slug:'test-shop',name:'Shop',description:'',logo:'',banner:'',contact:'Contact the test shop',is_open:true})
  const design={theme:'#f97316',blocks:[]},page=(await manage('page',{slug:'home',name:'Home',design})).rows[0].id
  await manage('publish',{id:page,version:0});assert.ok((await db.query('select published from commerce_pages where id=$1',[page])).rows[0].published)
  await manage('page',{id:page,version:1,slug:'home',name:'Home',design:{theme:'#db2777',blocks:[]}})
  assert.equal((await db.query('select published from commerce_pages where id=$1',[page])).rows[0].published.theme,'#f97316')
  await manage('unpublish',{id:page,version:2});assert.equal((await db.query('select published from commerce_pages where id=$1',[page])).rows[0].published,null)
  const request={key:'44444444-4444-4444-8444-444444444444',name:'Sandbox recipient',phone:'0800000000',address:'Local test only',items:[{product_id:product,variant_id:null,qty:1,price:0.01}]}
  const checkout=(v)=>db.query('select commerce_checkout($1,$2) result',['test-shop',JSON.stringify(v)])
  const foreignProduct=(await db.query("insert into products(tenant_id,code,name,price,stock) values($1,'FOREIGN','Other shop',10,1) returning id",[foreign])).rows[0].id
  await assert.rejects(checkout({...request,key:'99999999-9999-4999-8999-999999999999',items:[{product_id:foreignProduct,variant_id:null,qty:1}]}))
  assert.equal((await db.query('select stock from products where id=$1',[foreignProduct])).rows[0].stock,1)
  const result=(await checkout(request)).rows[0].result;assert.equal(Number(result.total),10)
  assert.equal((await checkout(request)).rows[0].result.number,result.number)
  assert.equal((await db.query('select stock from products where id=$1',[product])).rows[0].stock,0)
  await assert.rejects(checkout({...request,name:'Changed'}))
  await assert.rejects(checkout({...request,key:'55555555-5555-4555-8555-555555555555'}))
  assert.equal((await db.query('select count(*)::int n from commerce_orders')).rows[0].n,1)
  const order=(await db.query('select id from commerce_orders')).rows[0].id
  await assert.rejects(db.query("select commerce_move_order($1,$2,$3,'paid','No review')",[tenant,actor,order]))
  await db.query("select commerce_move_order($1,$2,$3,'cancelled','Local cancellation proof')",[tenant,actor,order])
  await db.query("select commerce_move_order($1,$2,$3,'cancelled','Repeated cancellation')",[tenant,actor,order])
  assert.equal((await db.query('select stock from products where id=$1',[product])).rows[0].stock,1)
  const variants={...value,code:'V1',stock:1,variants:[{label:'Black / M',price:25,stock:1}]}
  const vp=(await db.query('select commerce_save_product($1,$2,null,$3) id',[tenant,actor,JSON.stringify(variants)])).rows[0].id
  const vi=(await db.query('select id from commerce_variants where product_id=$1',[vp])).rows[0].id
  assert.equal((await db.query('select r_status from place_cf_order($1,$2,$3,$4)',[tenant,actor,actor,'V1'])).rows[0].r_status,'no_match')
  assert.equal((await db.query('select stock from products where id=$1',[vp])).rows[0].stock,1)
  const candidates=await Promise.allSettled(['66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777'].map(key=>checkout({...request,key,items:[{product_id:vp,variant_id:vi,qty:1}]})))
  assert.equal(candidates.filter(r=>r.status==='fulfilled').length,1)
  assert.equal((await db.query('select stock from commerce_variants where id=$1',[vi])).rows[0].stock,0)
  assert.equal((await db.query('select commerce_rate_limit($1,1) ok',['local-test'])).rows[0].ok,true)
  assert.equal((await db.query('select commerce_rate_limit($1,1) ok',['local-test'])).rows[0].ok,false)
  await db.exec('set role authenticated');await assert.rejects(db.query('select * from commerce_customers'));await assert.rejects(checkout(request));await db.exec('reset role')
  const variantOrder=(await db.query('select id from commerce_orders where id<>$1',[order])).rows[0].id
  for(const status of ['payment_review','paid','preparing','shipped','completed'])await db.query('select commerce_move_order($1,$2,$3,$4,$5)',[tenant,actor,variantOrder,status,'Sandbox proof only'])
  assert.equal((await db.query('select status from commerce_orders where id=$1',[variantOrder])).rows[0].status,'completed')
  assert.equal((await db.query('select r_status from place_cf_order($1,$2,$3,$4)',[tenant,actor,actor,'A1'])).rows[0].r_status,'created')
  await db.exec("update commerce_limits set max_products=2 where plan='starter'")
  await assert.rejects(db.query('select commerce_save_product($1,$2,null,$3)',[tenant,actor,JSON.stringify({...value,code:'THIRD'})]))
  await assert.rejects(db.query("insert into products(tenant_id,code,name,price,stock) values($1,'LEGACY','Quota test',1,0)",[tenant]))
  await manage('store',{slug:'test-shop',name:'Shop',description:'',logo:'',banner:'',contact:'',is_open:false})
  assert.equal((await checkout(request)).rows[0].result.number,result.number)
  await manage('archive',{id:vp})
  assert.equal((await db.query('select commerce_archived from products where id=$1',[vp])).rows[0].commerce_archived,true)
  assert.equal((await db.query('select count(*)::int n from commerce_order_items where product_id=$1',[vp])).rows[0].n,1)
  await db.query("update tenants set plan='free' where id=$1",[tenant]);await assert.rejects(checkout({...request,key:'88888888-8888-4888-8888-888888888888'}))
 } finally {await db.close()}
})
