const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const jsx=require('react/jsx-runtime')
function load(file,deps){const context={exports:{},require:name=>{if(name in deps)return deps[name];throw Error('Unexpected dependency '+name)}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);return context.exports}
function nodes(value){if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return [];return [value,...nodes(value.props?.children)]}
test('all eight Thai menu buttons switch content without invoking any network or mutation',()=>{
 const flags=Object.fromEntries(['agent_control_center_enabled','agent_orchestrator_enabled','agent_knowledge_base_enabled','agent_playground_enabled','agent_analytics_enabled','agent_advanced_guardrails_enabled'].map(key=>[key,false]))
 const data={config:{flags,monthlyLimit:0,rateLimit:10},canManage:false,versions:[],sources:[],customers:[],jobs:[],audit:[],usage:[],used:0,stats:null}
 const state=[],react={useState(initial){const i=react.index++;if(!(i in state))state[i]=i===1?data:initial;return [state[i],next=>state[i]=next]},useEffect(){},useCallback:fn=>fn,useRef:()=>({current:null})}
 const shared={'react':react,'react/jsx-runtime':jsx,'next/link':'a'}
 const guide=load('components/chatbot/AgentUserGuide.tsx',shared)
 const {AgentControlCenter}=load('components/chatbot/AgentControlCenter.tsx',{...shared,'./AgentUserGuide':guide,'./AutomationEmergencyStop':{AutomationEmergencyStop:'section'},'lucide-react':{Bot:'svg',LockKeyhole:'svg',RefreshCw:'svg'},'@/lib/agent-control-core':{AGENT_FLAG_KEYS:Object.keys(flags)}})
 const render=()=>{react.index=0;return nodes(AgentControlCenter({tenantId:'test-only',children:jsx.jsx('div',{children:'keyword-editor-marker'})}))}
 for(let i=0;i<guide.agentTabs.length;i++){
  let tree=render();const menu=tree.find(n=>n.type==='nav');const buttons=nodes(menu.props.children).filter(n=>n.type==='button');assert.equal(buttons.length,8)
  buttons[i].props.onClick();tree=render();assert.equal(tree.find(n=>n.type==='button'&&n.props['aria-current']==='page').props.children,guide.agentTabs[i][0])
  assert.ok(tree.some(n=>n.type==='h2'&&n.props.children===guide.agentTabs[i][0]))
  assert.equal(tree.some(n=>n.props.children==='keyword-editor-marker'),i===2)
 }
})
