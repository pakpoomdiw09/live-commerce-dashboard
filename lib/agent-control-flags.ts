import 'server-only'
import type {SupabaseClient} from '@supabase/supabase-js'
import {AGENT_FLAGS,type AgentFlags} from './agent-control-core'
const dev=()=>process.env.NODE_ENV==='development'
// Local development enables the full Control Center without changing production or tenant settings.
export const agentControlAvailable=()=>(dev()||process.env.AGENT_CONTROL_ENABLED==='true')&&process.env.AGENT_CONTROL_KILL_SWITCH!=='true'
export async function agentControlConfig(db:SupabaseClient,tenantId:string):Promise<{flags:AgentFlags;monthlyLimit:number;rateLimit:number}|null>{
 if(!agentControlAvailable())return null
 const result=await db.from('agent_control_settings').select('flags,ai_monthly_limit,requests_per_minute').eq('tenant_id',tenantId).maybeSingle()
 if(result.error)throw new Error('Agent Control migration unavailable')
 const row=result.data
 // Dev forces every UI flag on, but the orchestrator still follows the tenant row because it changes live replies.
 if(dev())return {flags:{...Object.fromEntries(Object.keys(AGENT_FLAGS).map(k=>[k,true])) as AgentFlags,agent_orchestrator_enabled:row?.flags?.agent_orchestrator_enabled===true},monthlyLimit:row?.ai_monthly_limit??0,rateLimit:row?.requests_per_minute??10}
 if(!row)return null
 return {flags:Object.fromEntries(Object.keys(AGENT_FLAGS).map(k=>[k,row.flags?.[k]===true])) as AgentFlags,monthlyLimit:row.ai_monthly_limit,rateLimit:row.requests_per_minute}
}
