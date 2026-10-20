import 'server-only'
import type {SupabaseClient} from '@supabase/supabase-js'
import {AGENT_FLAGS,type AgentFlags} from '@/lib/features/agents/agent-control-core'
// Billing and quota are database-owned. Keep only the explicit emergency stop.
export const agentControlAvailable=()=>process.env.AGENT_CONTROL_KILL_SWITCH!=='true'
export async function agentControlConfig(db:SupabaseClient,tenantId:string):Promise<{flags:AgentFlags;monthlyLimit:number;rateLimit:number;capabilities?:{answers:boolean;products:boolean;handoff:boolean;intent:boolean}}|null>{
 if(!agentControlAvailable())return null
 const result=await db.from('agent_control_settings').select('flags,ai_monthly_limit,requests_per_minute').eq('tenant_id',tenantId).maybeSingle()
 if(result.error)throw new Error('Agent Control migration unavailable')
 const row=result.data
 const capabilities={answers:row?.flags?.capability_answers!==false,products:row?.flags?.capability_products!==false,handoff:row?.flags?.capability_handoff!==false,intent:row?.flags?.capability_intent!==false}
 const flags={...Object.fromEntries(Object.keys(AGENT_FLAGS).map(k=>[k,row?.flags?.[k]!==false])) as AgentFlags,
  agent_control_center_enabled:true,agent_orchestrator_enabled:row?.flags?.agent_orchestrator_enabled===true}
 return {flags,monthlyLimit:row?.ai_monthly_limit??0,rateLimit:row?.requests_per_minute??10,capabilities}
}
