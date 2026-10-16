import 'server-only'
import type {NextRequest} from 'next/server'
import {inboxTenant,InboxError} from './inbox-server'
import {hasFeature} from './feature-access'
import type {CommunicationPolicy,FollowUpWorkflow,SmartDashboard,SmartJob,ExecutionLog} from './smart-followup-types'
import {DEFAULT_POLICY,DEFAULT_STEPS} from './smart-followup-types'
import {UUID} from './utils'
import {getBilling} from './billing'
export async function followUpTenant(req:NextRequest,tenantId:string){
 const scope=await inboxTenant(req,tenantId)
 if(!(await hasFeature(scope.db,tenantId,'customer_follow_up')))throw new InboxError('อัปเกรดแพ็กเกจเพื่อใช้ผู้ช่วยติดตามลูกค้า',403,'FEATURE_LOCKED')
 return scope
}
export async function followUpDashboard(db:Awaited<ReturnType<typeof followUpTenant>>['db'],tenantId:string,before?:string|null,beforeId?:string|null):Promise<SmartDashboard>{
 if(before&&(!Number.isFinite(Date.parse(before))||!UUID.test(beforeId??'')))throw new InboxError('ตัวแบ่งหน้าไม่ถูกต้อง')
 let query=db.from('follow_up_jobs').select('id,tenant_id,customer_id,order_id,kind,step,text,run_at,status,reason,sent_at,responded_at,attempts,dispatch_started_at,created_at,customers(display_name,platform_user_id,assigned_user_id,followup_opted_out),orders(product_name,amount,status)').eq('tenant_id',tenantId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100)
 if(before){const time=new Date(before).toISOString();query=query.or(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${beforeId})`)}
 const [policy,workflows,jobs,logs,overview,ai,billing]=await Promise.all([
  db.from('follow_up_policies').select('*').eq('tenant_id',tenantId).maybeSingle(),db.from('follow_up_workflows').select('*').eq('tenant_id',tenantId).order('kind'),query,
  db.from('follow_up_execution_logs').select('id,job_id,status,reason,created_at').eq('tenant_id',tenantId).order('created_at',{ascending:false}).limit(100),
  db.rpc('follow_up_overview',{p_tenant:tenantId}),hasFeature(db,tenantId,'ai_agent'),getBilling(db,tenantId),
 ])
 for(const result of [policy,workflows,jobs,logs,overview])if(result.error)throw result.error
 const configured=workflows.data as FollowUpWorkflow[]
 return {policy:(policy.data??{...DEFAULT_POLICY,tenant_id:tenantId}) as CommunicationPolicy,
  workflows:(['payment','interested','after_sales'] as const).map(kind=>configured.find(w=>w.kind===kind)??{id:'',tenant_id:tenantId,kind,enabled:false,use_ai:false,stop_on_reply:true,version:0,steps:DEFAULT_STEPS[kind]}),
  jobs:(jobs.data??[]) as unknown as SmartJob[],logs:(logs.data??[]) as ExecutionLog[],overview:overview.data,
  billing:{plan:billing.plan,planExpiresAt:billing.planExpiresAt,monthly:billing.monthly,allowance:billing.allowance,topup:billing.topup,slipRemaining:billing.slipRemaining},
  aiAllowed:ai,sendEnabled:process.env.SMART_FOLLOW_UP_SEND_ENABLED==='true',hasMore:jobs.data?.length===100}
}
