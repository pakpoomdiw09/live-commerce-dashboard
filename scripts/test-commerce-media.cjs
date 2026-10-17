const { test }=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),sharp=require('sharp')
const source=ts.transpileModule(fs.readFileSync('app/api/commerce/media/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
class CommerceError extends Error {constructor(m,status=400){super(m);this.status=status}}
function route({denied=false}={}){
 const uploads=[];let formReads=0
 const deps={'next/server':{NextResponse:{json:value=>value}},'node:crypto':require('node:crypto'),sharp:{__esModule:true,default:sharp},'@/lib/commerce-core':{CommerceError},'@/lib/commerce-server':{
  sameOrigin:()=>{},commerceScope:async()=>{if(denied)throw new CommerceError('Forbidden',403);return{tenantId:'tenant-id',actor:{id:'owner'},db:{rpc:async()=>({data:true,error:null}),storage:{from:bucket=>{assert.equal(bucket,'comment-media');return{upload:async(path,buffer,options)=>{uploads.push({path,buffer,options});return{error:null}},getPublicUrl:path=>({data:{publicUrl:'https://storage.example/'+path}})}}}}}},commerceResponse:error=>({status:error.status??503})}}
 const context={exports:{},File,Buffer,Error,require:name=>{assert.ok(name in deps,name);return deps[name]}}
 vm.runInNewContext(source,context)
 return{uploads,post:async file=>context.exports.POST({headers:new Headers(),nextUrl:new URL('https://shop.example/api?tenantId=tenant-id'),formData:async()=>{formReads++;const f=new FormData();f.set('file',file);return f}}),reads:()=>formReads}
}
test('media validates membership before reading uploads and rejects SVG and disguised files',async()=>{
 const a=route({denied:true});assert.equal((await a.post(new File(['x'],'x.png',{type:'image/png'}))).status,403);assert.equal(a.reads(),0)
 for(const file of [new File(['<svg/>'],'x.svg',{type:'image/svg+xml'}),new File(['<script/>'],'x.jpg',{type:'image/jpeg'}),new File([''],'x.png',{type:'image/png'})]){const f=route();assert.equal((await f.post(file)).status,400);assert.equal(f.uploads.length,0)}
})
test('valid image is re-encoded, metadata removed and stored with a tenant-scoped random server filename',async()=>{
 const pixels=await sharp({create:{width:2,height:2,channels:3,background:'#ff6600'}}).png().toBuffer(),f=route()
 const result=await f.post(new File([pixels],'../../secrets.png',{type:'image/png'}));assert.match(result.url,/https:\/\/storage\.example\/commerce\/tenant-id\/[0-9a-f-]+\.webp$/)
 assert.equal(f.uploads.length,1);assert.equal(f.uploads[0].options.contentType,'image/webp');assert.equal((await sharp(f.uploads[0].buffer).metadata()).format,'webp')
})
