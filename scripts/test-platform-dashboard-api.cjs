// No .env or real network/database access. Exercise real handlers with isolated dependencies.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const tenant = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const owner = { kind: 'user', id, isPlatformAdmin: false }
const admin = { ...owner, isPlatformAdmin: true }
function load(file, dependencies={}, extra={}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(join(__dirname,'..',file),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, {
    exports, Buffer, require: name => {
      if (name === 'server-only') return {}
      if (name in dependencies) return dependencies[name]
      throw Error(`Unexpected dependency: ${name}`)
    }, console, File, FormData, Request, Response, AbortSignal, Date, ...extra,
  }, { filename: file })
  return exports
}
const plans = load('lib/plans.ts')
const validation = load('lib/payment-validation.ts', { '@/lib/banks': { findBank: () => null } })
function fixture(actor=admin, options={}) {
  const calls=[], stored=[], removed=[]
  const db = {
    from: table => {
      calls.push(['from',table])
      const query = {}
      for (const method of ['select','eq','is','update']) query[method] = (...args) => { calls.push([method,...args]); return query }
      query.maybeSingle = async () => ({ data: options.request === null ? null : options.saved === false && calls.some(c=>c[0]==='update') ? null : { id,tenant_id:tenant,status:'pending',proof_path:options.proof ?? null,...options.request }, error: null })
      return query
    },
    rpc: async (name,args) => { calls.push(['rpc',name,args]); return {data:null,error:options.rpcError ?? null} },
    storage: { from: bucket => ({
      upload: async (path,file) => { stored.push({bucket,path,file}); return {error:null} },
      remove: async paths => { removed.push(...paths); return {error:null} },
      createSignedUrl: async (path,ttl) => { calls.push(['signed',path,ttl]); return { data:{signedUrl:'https://storage.example/private?expires=120'},error:null } },
    }) },
  }
  const deps = {
    'next/server': { NextResponse: {json:(value,init)=>Response.json(value,init)} },
    '@/lib/auth': { getActor: async()=>actor, isPlatformAdmin:a=>a.kind==='internal'||a.isPlatformAdmin, canAccessTenant:async()=>options.access !== false },
    '@/lib/supabase/server': {supabaseAdmin:()=>db},
    '@/lib/utils': { UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
    '@/lib/payment-validation': validation,
    '@/lib/billing': { getBilling: async()=>({ plan:'starter',monthly:1500,topup:0,slipRemaining:500 }) },
    '@/lib/billing-verification': {
      APPROVAL_SUCCESS: 'อนุมัติสำเร็จ! ระบบเพิ่มเครดิตให้เรียบร้อยแล้ว',
      BILLING_VERIFICATION_COLUMNS: 'tenant_id,status,proof_path',
      verifyBillingRequest: async()=>({ ok:true,status:'pending',message:'รอตรวจสอบ' }),
    },
    'node:crypto': {randomUUID:()=>id,createHash:require('node:crypto').createHash},
  }
  return { db,deps,calls,stored,removed }
}
const params = {params:Promise.resolve({id:tenant})}
const json = body => new Request('https://local.test/api',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)})

test('owner dashboard redirects non-admins and rejects internal tokens as dashboard identities', async()=>{
  for (const actor of [null,owner,{kind:'internal'}]) {
    const {deps,calls}=fixture(actor)
    const mod=load('lib/admin.ts',{...deps,'next/navigation':{redirect:path=>{throw Error(`REDIRECT:${path}`)}}})
    await assert.rejects(mod.requirePlatformOwner(),/REDIRECT:\/dashboard/)
    assert.equal(calls.length,0)
  }
  const {deps}=fixture(admin)
  const mod=load('lib/admin.ts',{...deps,'next/navigation':{redirect:()=>{throw Error('unexpected redirect')}}})
  assert.equal((await mod.requirePlatformOwner()).id,id)
})

test('tenant management and Provider API refuse unauthenticated/ordinary/internal callers before reads',async()=>{
  for (const actor of [null,owner,{kind:'internal'}]) {
    const f=fixture(actor)
    const manage=load('app/api/admin/tenants/[id]/route.ts',f.deps)
    assert.equal((await manage.PATCH(json({isActive:false}),params)).status,actor?403:401)
    const quota=load('app/api/admin/provider-quota/route.ts',{...f.deps,'@/lib/provider-quota':{getProviderQuota:()=>{throw Error('should not contact Provider')}}})
    assert.equal((await quota.GET()).status,actor?403:401)
    assert.equal(f.calls.length,0)
  }
})

test('tenant changes validate server fields and carry verified actor ID, including false status',async()=>{
  const f=fixture()
  const mod=load('app/api/admin/tenants/[id]/route.ts',f.deps)
  for (const body of [{},{plan:'enterprise'},{isActive:'false'},{plan:'pro',credits:999},{p_admin:'spoof'},{isActive:null}]) {
    assert.equal((await mod.PATCH(json(body),params)).status,400)
  }
  assert.equal(f.calls.length,0)
  assert.equal((await mod.PATCH(json({isActive:false}),params)).status,200)
  const rpc=f.calls.find(call=>call[0]==='rpc')
  assert.equal(rpc[1],'platform_update_tenant')
  assert.equal(rpc[2].p_admin,id)
  assert.equal(rpc[2].p_tenant,tenant)
  assert.equal(rpc[2].p_active,false)
  assert.equal(rpc[2].p_plan,null)
})

test('provider quota uses server credentials, validates numeric response and contains no secrets',async()=>{
  let called=0
  for (const body of [{success:true,data:{quota:123,overQuota:0}},{success:true,data:{quota:'123',overQuota:0}},{success:false}]) {
    const mod=load('lib/provider-quota.ts',{}, {
      process:{env:{SLIPOK_BRANCH_ID:'branch',SLIPOK_API_KEY:'private-key'}},
      fetch:async(url,init)=>{called++;assert.equal(url,'https://api.slipok.com/api/line/apikey/branch/quota');assert.equal(init.headers['x-authorization'],'private-key');assert.equal(init.cache,'no-store');return Response.json(body)},
    })
    const quota=await mod.getProviderQuota()
    assert.equal(quota.ok,typeof body.data?.quota==='number')
    assert.equal(JSON.stringify(quota).includes('private-key'),false)
    if (quota.ok) assert.equal(quota.remaining,123)
  }
  assert.equal(called,3)
  const absent=load('lib/provider-quota.ts',{}, {process:{env:{}},fetch:()=>{throw Error('no credentials')}})
  assert.equal((await absent.getProviderQuota()).ok,false)
})

test('proof access is scoped to request ownership and signed URLs expire after 120 seconds',async()=>{
  const denied=fixture(owner,{access:false,proof:'tenant/private.jpg'})
  const route=load('app/api/billing/requests/[id]/proof/route.ts',denied.deps)
  assert.equal((await route.GET(new Request('https://local.test'),params)).status,404)
  assert.equal(denied.calls.some(c=>c[0]==='signed'),false)
  const allowed=fixture(admin,{proof:'tenant/private.jpg'})
  const response=await load('app/api/billing/requests/[id]/proof/route.ts',allowed.deps).GET(new Request('https://local.test'),params)
  assert.equal(response.status,200)
  assert.equal(response.headers.get('cache-control'),'no-store')
  assert.equal(allowed.calls.find(c=>c[0]==='signed')[2],120)
})

test('proof uploads reject forged images, completed orders and replacements; save races remove only the new file',async()=>{
  const upload=async(f,file)=>{
    const form=new FormData();form.set('file',file)
    return load('app/api/billing/requests/[id]/proof/route.ts',f.deps).POST(new Request('https://local.test',{method:'POST',body:form}),params)
  }
  const valid=new File([new Uint8Array([0xff,0xd8,0xff,0,0])],'slip.jpg',{type:'image/jpeg'})
  for (const options of [{proof:'existing.jpg'},{request:{status:'rejected'}},{access:false}]) {
    const f=fixture(owner,options)
    assert.ok((await upload(f,valid)).status>=400)
    assert.equal(f.stored.length,0)
  }
  const bad=fixture(owner)
  assert.equal((await upload(bad,new File(['fake'],'slip.jpg',{type:'image/jpeg'}))).status,400)
  assert.equal(bad.stored.length,0)
  const race=fixture(owner,{saved:false})
  assert.equal((await upload(race,valid)).status,409)
  assert.equal(race.stored.length,1)
  assert.equal(race.removed[0],race.stored[0].path)
  const good=fixture(owner)
  assert.equal((await upload(good,valid)).status,200)
  assert.equal(good.stored[0].bucket,'billing-proofs')
  assert.equal(good.stored[0].path.startsWith(`${tenant}/${tenant}/`),true)
})

test('auth grants admin only from database membership and denies suspended tenant members',async()=>{
  for (const [app,meta,table,expected] of [
    [{},{role:'superadmin',is_platform_admin:true},false,false],
    [{role:'superadmin'},{},false,false], [{is_platform_admin:true},{},false,false],
    [{is_platform_admin:'true'},{},false,false], [{},{},true,true],
  ]) {
    const db={from:name=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:name==='platform_admins'?(table?{user_id:id}:null):name==='tenants'?{is_active:false}:{role:'owner'},error:null})})})})}
    const auth=load('lib/auth.ts',{
      react:{cache:fn=>fn},
      'next/navigation':{redirect(){throw Error('redirect')}},
      '@/lib/supabase/server':{supabaseAdmin:()=>db,supabaseServer:async()=>({auth:{getUser:async()=>({data:{user:{id,app_metadata:app,user_metadata:meta}}})}})},
    },{process:{env:{}}})
    const actor=await auth.getActor()
    assert.equal(actor.isPlatformAdmin,expected)
    assert.equal(await auth.tenantRole(actor,tenant),expected?'admin':null)
  }
})

function billingVerificationFixture(options={}) {
  const state={receipt:options.receipt??null,activationCalls:0,providerCalls:0,updates:[]}
  const now=new Date()
  const thai=new Date(now.getTime()+7*3600000).toISOString()
  const reference='verified-billing-ref'
  const amount=options.amount??100
  const valid={verdict:'valid',receiverVerifiedByProvider:true,amount,transRef:reference,raw:{success:true,data:{success:true,amount,transRef:reference,receivingBank:'004',receiver:{account:{value:'xxxxxx7890'}},transDate:thai.slice(0,10).replaceAll('-',''),transTime:thai.slice(11,19)}}}
  const db={
    from:table=>{
      const q={}
      for(const method of ['select','eq'])q[method]=()=>q
      q.update=values=>{state.updates.push(values);return q}
      q.then=(resolve,reject)=>Promise.resolve({data:null,error:null}).then(resolve,reject)
      q.maybeSingle=async()=>({data:table==='billing_payment_receipts'?state.receipt:table==='payment_transfer_ledger'?options.transferClaim??null:table==='payment_image_ledger'?options.imageClaim??null:null,error:null})
      q.insert=async values=>{
        if(options.saveFailure)return {error:{code:'XX001'}}
        state.receipt=values;return {error:null}
      }
      return q
    },
    rpc:async(name,args)=>{assert.equal(name,'activate_billing_payment');assert.equal(args.p_request,id);state.activationCalls++;return options.activationFailure?{data:false,error:{code:'XX001'}}:{data:true,error:null}},
    storage:{from:()=>({download:async()=>({data:new Blob([new Uint8Array([0xff,0xd8,0xff])],{type:'image/jpeg'}),error:null})})},
  }
  const mod=load('lib/billing-verification.ts',{
    'node:crypto':require('node:crypto'),
    '@/lib/billing':{getBilling:async()=>({plan:'starter',monthly:1500,topup:400,slipRemaining:500})},
    '@/lib/payments':{paymentReceiver:()=>({promptpayId:'0812345678',bankAccountNo:'1234567890',bankCode:'004'})},
    '@/lib/payment-validation':validation,
    '@/lib/slip/slipok':{verifyWithSlipOK:async input=>{state.providerCalls++;assert.equal(input.expectedAmount,undefined);return options.verdict?{...valid,...options.verdict}:valid}},
  },{Buffer,process:{env:{SLIPOK_BRANCH_ID:'test-branch',SLIPOK_API_KEY:'test-key'}}})
  const request={tenant_id:tenant,status:'pending',proof_path:'private.jpg',price_baht:100,created_at:new Date(now.getTime()-60000).toISOString(),receiver_promptpay_id:null,receiver_account_no:null,receiver_bank_code:null}
  return {state,run:()=>mod.verifyBillingRequest(db,id,request)}
}

test('real automatic billing validator saves exact payment then activates and returns updated balance',async()=>{
  const f=billingVerificationFixture()
  const result=await f.run()
  assert.equal(result.status,'approved')
  assert.equal(result.message,'อนุมัติสำเร็จ! ระบบเพิ่มเครดิตให้เรียบร้อยแล้ว')
  assert.equal(result.billing.topup,400)
  assert.equal(f.state.receipt.amount,100)
  assert.equal(f.state.providerCalls,1)
  assert.equal(f.state.activationCalls,1)
  await f.run()
  assert.equal(f.state.providerCalls,1) // a retry uses immutable stored proof
})

test('underpayment, provider failure, wrong receiver and shared-ledger duplicate stay pending without credit activation',async()=>{
  for(const options of [
    {amount:99.99}, {verdict:{verdict:'duplicate'}}, {verdict:{verdict:'wrong_receiver',branchReceiverMismatch:true}},
    {verdict:{verdict:'error',providerFault:true}}, {verdict:{verdict:'valid',raw:{success:true,data:{success:false}}}},
    {transferClaim:{source:'sale',source_id:tenant}}, {imageClaim:{source:'package',source_id:tenant}},
    {saveFailure:true},
  ]) {
    const f=billingVerificationFixture(options)
    const result=await f.run()
    assert.equal(result.status,'pending')
    assert.equal(f.state.activationCalls,0)
    assert.equal(f.state.updates.at(-1).verification_status,'failed')
  }
})

test('credit activation failure preserves verified proof and retries without another Provider call',async()=>{
  const f=billingVerificationFixture({activationFailure:true})
  let result=await f.run()
  assert.equal(result.status,'pending')
  assert.equal(result.verified,true)
  assert.equal(f.state.updates.at(-1).verification_status,'verified')
  assert.ok(f.state.receipt)
  result=await f.run()
  assert.equal(result.status,'pending')
  assert.equal(f.state.providerCalls,1)
  assert.equal(f.state.activationCalls,2)
})
