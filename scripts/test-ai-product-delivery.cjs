const {test}=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/load-typescript.cjs')
test('product reply sends text plus an image attachment and tolerates rejected/uncertain media without duplicate text',async()=>{
 let textCalls=0,mediaCalls=0,fail=false,newText=true,attachment
 const api=load('lib/features/agents/product-reply.ts',{'server-only':{},'@/lib/features/slips/notify':{
  deliverOnce:async()=>{textCalls++;return newText},
  deliverRichOnce:async(_db,_to,key,_body,messages,_type,attachments)=>{mediaCalls++;assert.equal(key,'reply:one:image');attachment={messages,attachments};if(fail)throw Error('provider timeout');return true},
 }},{URL,console:{warn(){}}})
 const send=url=>api.deliverProductReply({}, {id:'customer',psid:'sender',token:null},'reply:one','Stored product price',url)
 assert.equal(await send('https://store.test/photo.webp'),true)
 assert.equal(attachment.messages[0].attachment.type,'image');assert.equal(attachment.attachments[0].payload.url,'https://store.test/photo.webp')
 for(const invalid of [null,'','undefined','javascript:alert(1)','https://user:password@store.test/photo'])assert.equal(await send(invalid),true)
 assert.equal(mediaCalls,1)
 fail=true;assert.equal(await send('https://store.test/expired.webp'),true)
 assert.equal(mediaCalls,2);assert.equal(textCalls,7)
 newText=false;assert.equal(await send('https://store.test/photo.webp'),false)
 assert.equal(mediaCalls,2)
})
