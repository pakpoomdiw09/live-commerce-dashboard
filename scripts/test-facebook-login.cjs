// Isolated OAuth tests. No .env, real OAuth code, database or Meta network requests.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function load(file, deps={}, globals={}) {
  const exports={}
  const code=ts.transpileModule(readFileSync(join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(code,{exports,URL,URLSearchParams,console,require:name=>{
    if(name in deps)return deps[name]
    throw Error(`Unexpected dependency ${name}`)
  },...globals},{filename:file})
  return exports
}
const oauth=load('lib/oauth.ts')
test('connect callback uses verified Pages and current session user for tenant sync', async () => {
  const calls=[]
  const page={id:'123',name:'Shop',picture:null,accessToken:'secret-page'}
  const api=load('app/api/auth/facebook/callback/route.ts', {
    'next/server':{NextResponse:{redirect:url=>({location:String(url),cookies:{delete(){}}})}},
    '@/lib/auth':{getActor:async()=>({kind:'user',id:'session-user'})},
    '@/lib/integrations/facebook/oauth':{
      STATE_COOKIE:'state',STATE_COOKIE_PATH:'/api/auth/facebook',callbackUrl:origin=>origin+'/callback',
      exchangeCode:async()=>{calls.push('exchange');return 'user-token'},
      listPages:async()=>[page,{...page,id:'unverified'}],
      verifiedAdminPages:async pages=>{calls.push('verify');return pages.filter(p=>p.id==='123')},
      subscribePage:async()=>null,
    },
    '@/lib/supabase/server':{supabaseAdmin:()=>({
      from:()=>({upsert:async()=>({error:null})}),
      rpc:async(name,args)=>{calls.push({name,args});return {data:1,error:null}},
    })},
  })
  const request=state=>{const url=new URL('https://shop.example/api/auth/facebook/callback?code=code&state='+state);return {nextUrl:url,cookies:{get:()=>({value:'expected'})}}}
  await api.GET(request('wrong'))
  assert.equal(calls.length,0)
  const response=await api.GET(request('expected'))
  assert.equal(new URL(response.location).searchParams.get('fb'),'connected')
  const sync=calls.find(c=>typeof c==='object')
  assert.equal(sync.name,'sync_facebook_tenants')
  assert.equal(sync.args.p_user_id,'session-user')
  assert.equal(sync.args.p_pages.length,1)
  assert.equal(sync.args.p_pages[0].page_id,'123')
  assert.ok(calls.indexOf('verify')<calls.indexOf(sync))
})
test('automatic membership requires MANAGE plus a verified Page messaging token', async () => {
  const checked=[]
  const api=load('lib/integrations/facebook/oauth.ts', {'server-only':{}, '@/lib/integrations/facebook/client':{
    graph:path=>path,
    getPageTokenStatus:async(token,id)=>{checked.push(id);return token},
  }}, {console:{warn(){}},process:{env:{}}})
  const pages=[
    {id:'admin',tasks:['MANAGE'],accessToken:'verified'},
    {id:'editor',tasks:['MESSAGING'],accessToken:'verified'},
    {id:'unknown',accessToken:'verified'},
    ...['invalid','limited','unverified'].map(status=>({id:status,tasks:['MANAGE'],accessToken:status})),
  ]
  const result=await api.verifiedAdminPages(pages)
  assert.equal(result.length,1)
  assert.equal(result[0].id,'admin')
  assert.deepEqual(checked,['admin','invalid','limited','unverified'])
})
function callback(options={}) {
  const exchanges=[],logs=[],rpcCalls=[],pageCalls=[],cookieWrites=[]
  const mod=load('app/auth/callback/route.ts',{
    'next/server':{NextResponse:{redirect:url=>({location:String(url),cookies:{set:(...args)=>cookieWrites.push(args)}})}},
    '@/lib/oauth':oauth,
    '@/lib/supabase/server':{
      supabaseServer:async()=>({auth:{exchangeCodeForSession:async(...args)=>{
        exchanges.push(args)
        if(options.throwExchange)throw Error('private-exception-detail')
        return options.exchange??{data:{session:{provider_token:'private-provider-token',user:{id:'user-id'}}},error:null}
      }}}),
      supabaseAdmin:()=>({rpc:async(...args)=>{rpcCalls.push(args);return {data:1,error:options.rpcError??null}}}),
    },
    '@/lib/integrations/facebook/oauth':{verifiedAdminPages:async pages=>pages,listPages:async(token)=>{pageCalls.push(token);if(options.pageError)throw Error('private-graph-detail');return options.pages??[{id:'page-id',name:'Shop',accessToken:'private-page-token'}]}},
  },{console:{error:(...args)=>logs.push(args)}})
  const run=async(path,cookie)=>{
    const url=new URL(path,'http://localhost:3000')
    return mod.GET({url:url.toString(),nextUrl:url,cookies:{get:()=>cookie===undefined?undefined:{value:cookie}}})
  }
  return {run,exchanges,logs,rpcCalls,pageCalls,cookieWrites}
}

test('OAuth callback URL matches the browser origin and never carries the destination query',()=>{
  for(const origin of ['http://localhost:3000','http://localhost:3001','https://shop.example']){
    assert.equal(oauth.facebookRedirectTo(origin),`${origin}/auth/callback`)
  }
  assert.ok(oauth.FACEBOOK_SCOPES.split(',').includes('email'))
  assert.ok(oauth.FACEBOOK_SCOPES.split(',').includes('pages_show_list'))
})

test('destination routing rejects external URLs, backslash redirects and header controls',()=>{
  for(const next of ['https://evil.example','//evil.example','/\\evil.example','/\r\nLocation:evil','javascript:alert(1)'])assert.equal(oauth.safeAuthNext(next),'/overview')
  assert.equal(oauth.safeAuthNext('/admin?tab=pending'),'/admin?tab=pending')
  assert.equal(oauth.safeAuthNext(undefined,'/select-page'),'/select-page')
})

test('routing cookie is scoped to callback, short-lived and never stores credentials',()=>{
  const document={cookie:''}
  const mod=load('lib/oauth.ts',{}, {document,location:{protocol:'https:'}})
  mod.rememberOAuthNext('/admin')
  assert.ok(document.cookie.includes('Path=/auth/callback'))
  assert.ok(document.cookie.includes('Max-Age=600'))
  assert.ok(document.cookie.includes('SameSite=Lax; Secure'))
  assert.ok(document.cookie.includes('%2Fadmin'))
})

test('provider cancellation/email failures reach login with safe distinct errors without code exchange',async()=>{
  for(const [query,expected] of [
    ['error=access_denied','access_denied'],
    ['error=server_error&error_description=Error%20getting%20user%20email%20from%20external%20provider','oauth_email_missing'],
  ]){
    const f=callback()
    const response=await f.run(`/auth/callback?${query}&next=%2Fadmin`)
    const location=new URL(response.location)
    assert.equal(location.pathname,'/login')
    assert.equal(location.searchParams.get('error_code'),expected)
    assert.equal(location.searchParams.get('next'),'/admin')
    assert.equal(f.exchanges.length,0)
    assert.equal(f.rpcCalls.length,0)
  }
})

test('missing/expired verifier errors are explicit and never log authorization codes or tokens',async()=>{
  const f=callback({exchange:{data:{session:null},error:{code:'pkce_code_verifier_not_found',message:'private-auth-code',status:400}}})
  const result=await f.run('/auth/callback?code=private-auth-code')
  assert.equal(new URL(result.location).searchParams.get('error_code'),'pkce_code_verifier_not_found')
  assert.equal(JSON.stringify(f.logs).includes('private-auth-code'),false)
  assert.equal(f.pageCalls.length,0)
  const missing=callback()
  assert.equal(new URL((await missing.run('/auth/callback')).location).searchParams.get('error_code'),'missing_code')
})

test('successful callback forwards PKCE flow ID, preserves safe destination and consumes routing cookie',async()=>{
  const f=callback()
  const flow='a'.repeat(32)
  const result=await f.run(`/auth/callback?code=private-auth-code&sb_flow_id=${flow}`,encodeURIComponent('/admin'))
  assert.equal(result.location,'http://localhost:3000/admin')
  assert.equal(f.exchanges[0][0],'private-auth-code')
  assert.equal(f.exchanges[0][1].flowId,flow)
  assert.equal(f.rpcCalls[0][0],'sync_facebook_tenants')
  assert.equal(f.cookieWrites[0][0],oauth.OAUTH_NEXT_COOKIE)
  assert.equal(f.cookieWrites[0][2].maxAge,0)
  assert.equal(JSON.stringify(f.logs).includes('private-provider-token'),false)
})

test('Page sync errors remain on select-page after login rather than being reported as OAuth failure',async()=>{
  const f=callback({rpcError:{code:'PGRST202',message:'private-detail'}})
  const result=await f.run('/auth/callback?code=test')
  const location=new URL(result.location)
  assert.equal(location.pathname,'/select-page')
  assert.match(location.searchParams.get('fb_error'),/facebook-tenants.sql/)
  assert.equal(location.searchParams.get('error'),null)
  const success=callback()
  assert.equal(new URL((await success.run('/auth/callback?code=test')).location).searchParams.get('fb'),'connected')
})

test('Page listing retries without optional picture permission and redacts Page tokens in debug logs',async()=>{
  const logs=[],requests=[]
  const token='private-page-secret'
  const api=load('lib/integrations/facebook/oauth.ts',{'server-only':{},'@/lib/integrations/facebook/client':{graph:path=>`https://graph.facebook.com/v24.0/${path}`}}, {
    process:{env:{FB_DEBUG:'true'}},AbortSignal,
    console:{log:(...args)=>logs.push(args)},
    fetch:async url=>{
      requests.push(new URL(url))
      return requests.length===1?{ok:false,status:400,json:async()=>({error:{code:100}})}:{ok:true,status:200,json:async()=>({data:[{id:'123',name:'Page',access_token:token}]})}
    },
  })
  const pages=await api.listPages('private-user-secret')
  assert.equal(requests.length,2)
  assert.ok(requests[0].searchParams.get('fields').includes('picture'))
  assert.ok(!requests[1].searchParams.get('fields').includes('picture'))
  assert.equal(pages[0].accessToken,token)
  assert.equal(pages[0].picture,null)
  assert.ok(!JSON.stringify(logs).includes(token))
  assert.ok(!JSON.stringify(logs).includes('private-user-secret'))
})
