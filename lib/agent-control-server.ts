import 'server-only'
import type {NextRequest} from 'next/server'
import {getActor,canAccessTenant} from './auth'
import {supabaseAdmin} from './supabase/server'
import {hasFeature} from './feature-access'
import {InboxError} from './inbox-server'
import {agentControlConfig,agentControlAvailable} from './agent-control-flags'
import {UUID} from './utils'
import {conversationOwner,redactAgentText} from './agent-control-core'
export async function agentControlTenant(req:NextRequest,tenantId:string,owner=false){
 const actor=await getActor(req)
 if(!actor||actor.kind!=='user')throw new InboxError('กรุณาเข้าสู่ระบบ',401)
 if(!UUID.test(tenantId)||!await canAccessTenant(actor,tenantId))throw new InboxError('ไม่พบร้านค้า',404)
 if(owner&&!await canAccessTenant(actor,tenantId,'owner'))throw new InboxError('เฉพาะเจ้าของร้านเท่านั้น',403)
 const db=supabaseAdmin()
 if(!await hasFeature(db,tenantId,'ai_agent'))throw new InboxError('แพ็กเกจไม่รองรับ AI Agent',403,'FEATURE_LOCKED')
 if(!agentControlAvailable())throw new InboxError('Control Center ยังไม่เปิดหรือถูกพักฉุกเฉิน',403,'FEATURE_DISABLED')
 const config=await agentControlConfig(db,tenantId)
 if(!config?.flags.agent_control_center_enabled)throw new InboxError('Control Center ยังไม่เปิดสำหรับร้านนี้',403,'FEATURE_DISABLED')
 return {db,tenantId,actor,config}
}
export async function agentControlDashboard(db:ReturnType<typeof supabaseAdmin>,tenantId:string,analytics:boolean){
 const month=new Date().toISOString().slice(0,7)+'-01'
 const customersAllowed=await hasFeature(db,tenantId,'customer_management')
 const [sources,versions,usage,jobs,audit,customers,stats,tokens]=await Promise.all([
  db.from('agent_knowledge_sources').select('id,kind,title,content,is_active,updated_at').eq('tenant_id',tenantId).order('created_at',{ascending:false}).limit(100),
  db.from('agent_prompt_versions').select('id,version,instructions,created_at').eq('tenant_id',tenantId).order('version',{ascending:false}).limit(30),
  db.from('agent_ai_monthly_usage').select('used').eq('tenant_id',tenantId).eq('month',month).maybeSingle(),
  db.from('agent_message_jobs').select('id,route,status,reason,created_at').eq('tenant_id',tenantId).order('created_at',{ascending:false}).limit(50),
  db.from('agent_control_audit').select('id,event,detail,created_at').eq('tenant_id',tenantId).order('created_at',{ascending:false}).limit(100),
  customersAllowed?db.from('customers').select('id,display_name,bot_enabled,assigned_user_id,conversation_status,conversation_version,handover_at,agent_opted_out').eq('tenant_id',tenantId).order('last_message_at',{ascending:false}).limit(50):Promise.resolve({data:[],error:null}),
  analytics?db.rpc('agent_control_overview',{p_tenant:tenantId}):Promise.resolve({data:null,error:null}),
  db.from('agent_ai_usage').select('id,status,input_tokens,output_tokens,cost_baht,reason,created_at').eq('tenant_id',tenantId).gte('created_at',month).order('created_at',{ascending:false}).limit(100),
 ])
 for(const result of [sources,versions,usage,jobs,audit,customers,stats,tokens])if(result.error)throw result.error
 return {sources:(sources.data??[]).map(s=>({...s,content:redactAgentText(s.content)})),versions:(versions.data??[]).map(v=>({...v,instructions:redactAgentText(v.instructions??'')})),used:usage.data?.used??0,jobs:jobs.data??[],audit:audit.data??[],customers:(customers.data??[]).map(c=>({...c,ownership:conversationOwner(c)})),stats:stats.data,usage:tokens.data??[],month,costAvailable:false}
}
