const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const code = ts.transpileModule(fs.readFileSync('lib/features/slips/slipok.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
test('platform checks disable branch logging for files/QR while default callers retain it', async () => {
  const bodies=[]
  const context={ exports:{}, FormData, AbortSignal, process:{env:{SLIPOK_API_KEY:'test',SLIPOK_BRANCH_ID:'test'}},
    fetch:async (_url,options)=>{bodies.push(options.body);return {ok:true,json:async()=>({success:true,data:{success:true,amount:9,transRef:'ref',receivingBank:'006',receiver:{account:{value:'9260337828'}}}})}} }
  vm.runInNewContext(code,context)
  const file=new File(['test'],'slip.jpg',{type:'image/jpeg'})
  const local = await context.exports.verifyWithSlipOK({file,log:false})
  assert.equal(local.verdict,'valid')
  assert.equal(local.receiverVerifiedByProvider,false)
  assert.equal(bodies[0].get('log'),'false')
  await context.exports.verifyWithSlipOK({qr:'qr',log:false})
  assert.equal(JSON.parse(bodies[1]).log,false)
  assert.equal((await context.exports.verifyWithSlipOK({file})).receiverVerifiedByProvider,true)
  assert.equal(bodies[2].get('log'),'true')
  context.fetch=async()=>({ok:false,json:async()=>({success:true,data:{success:true}})})
  assert.equal((await context.exports.verifyWithSlipOK({file})).verdict,'error')
  context.fetch=async()=>({ok:true,json:async()=>({success:false,code:1014})})
  assert.equal((await context.exports.verifyWithSlipOK({file})).verdict,'wrong_receiver')
})
