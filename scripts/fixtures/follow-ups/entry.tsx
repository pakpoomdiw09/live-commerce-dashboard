import {createRoot} from 'react-dom/client'
import {SmartFollowUpsClient} from '../../../components/chatbot/SmartFollowUpsClient'
import {DEFAULT_POLICY,DEFAULT_STEPS,type SmartDashboard} from '../../../lib/features/follow-ups/smart-followup-types'

const tenantId='11111111-1111-4111-8111-111111111111'
let data:SmartDashboard={
 policy:{...DEFAULT_POLICY,tenant_id:tenantId},
 workflows:(['payment','interested','after_sales'] as const).map(kind=>({id:kind,tenant_id:tenantId,kind,enabled:false,use_ai:false,stop_on_reply:true,version:1,steps:DEFAULT_STEPS[kind]})),
 jobs:[],logs:[{id:'test-log',job_id:tenantId,status:'precheck_blocked',reason:'slip_received',created_at:new Date().toISOString()}],overview:{},
 billing:{plan:'pro',planExpiresAt:null,monthly:100,allowance:100,topup:0,slipRemaining:50},aiAllowed:true,sendEnabled:true,hasMore:false,
}
const state={saves:[] as unknown[],unexpected:[] as string[]}
Object.assign(window,{followUpTest:state})
window.fetch=async(input,init)=>{
 const url=String(input)
 if(url.startsWith('/api/follow-ups?')&&!init?.method)return new Response(JSON.stringify(data),{status:200})
 if(url.startsWith('/api/follow-ups/workflows/')&&init?.method==='PATCH'){
  const saved=JSON.parse(String(init.body)),kind=url.split('/').at(-1);state.saves.push(saved)
  const existing=data.workflows.find(w=>w.kind===kind)!
  const steps=saved.index==null?saved.steps:existing.steps.map((step,index)=>index===saved.index?saved.steps[0]:step)
  const workflow={...existing,...saved.config,steps,version:existing.version+1}
  data={...data,workflows:data.workflows.map(w=>w.kind===kind?workflow:w)}
  return new Response(JSON.stringify({workflow}),{status:200})
 }
 state.unexpected.push(url);throw new Error('Unexpected request: '+url)
}
createRoot(document.getElementById('root')!).render(<SmartFollowUpsClient tenantId={tenantId} initial={data}/> )
