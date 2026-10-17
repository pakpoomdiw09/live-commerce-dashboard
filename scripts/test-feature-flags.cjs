const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,env){const context={exports:{},process:{env},require:name=>{assert.equal(name,'./feature-flags');return load('lib/feature-flags.ts',env)}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);return context.exports}
for(const [feature,publicKey,legacyKey] of [['sales_page_v2','NEXT_PUBLIC_SALES_PAGE_V2_ENABLED','SALES_PAGE_V2_ENABLED']]){
 test(feature+': defaults off, exact opt-in, public override and legacy fallback',()=>{
  for(const value of [undefined,'false','TRUE','1',''])assert.equal(load('lib/feature-flags.ts',{[publicKey]:value}).isFeatureEnabled(feature),false)
  assert.equal(load('lib/feature-flags.ts',{[publicKey]:'true'}).isFeatureEnabled(feature),true)
  assert.equal(load('lib/feature-flags.ts',{[legacyKey]:'true'}).isFeatureEnabled(feature),true)
  assert.equal(load('lib/feature-flags.ts',{[publicKey]:'false',[legacyKey]:'true'}).isFeatureEnabled(feature),false)
  assert.equal(load('lib/feature-flags.ts',{[publicKey]:'true',[legacyKey]:'false'}).isFeatureEnabled(feature),true)
 })
}
test('shop capabilities use the central public switch',()=>{
 const env={NEXT_PUBLIC_SALES_PAGE_V2_ENABLED:'true'}
 assert.equal(load('lib/commerce-core.ts',env).shopV2(),true)
 env.NEXT_PUBLIC_SALES_PAGE_V2_ENABLED='false'
 assert.equal(load('lib/commerce-core.ts',env).shopV2(),false)
 assert.equal(load('lib/feature-flags.ts',env).isFeatureEnabled('unknown'),false)
})
