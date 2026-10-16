import 'server-only'
import type {SupabaseClient} from '@supabase/supabase-js'
import {pageTokenFor,sendMessageWithReceipt,SendApiError,isWindowOrTagError} from './facebook'
export type FollowUpRun={sent:number;cancelled:number;failed:number;review:number;skipped:number;remaining:boolean;sendEnabled:boolean}
type Claimed={id:string;tenant_id:string;claim_token:string}
/** DB transactions own claims, preflight checks, leases, quota, durable messages and result persistence. */
export async function runFollowUps(db:SupabaseClient,tenantId?:string,deadline=Date.now()+45000,_legacyBypass=false):Promise<FollowUpRun>{
 const result:FollowUpRun={sent:0,cancelled:0,failed:0,review:0,skipped:0,remaining:false,sendEnabled:process.env.SMART_FOLLOW_UP_SEND_ENABLED==='true'}
 if(!result.sendEnabled)return result
 // Claim one at a time so slow API calls never strand an unprocessed batch of claims.
 for(let n=0;n<10&&Date.now()<deadline-12000;n++){
  const claimed=await db.rpc('claim_follow_up_jobs',{p_tenant:tenantId??null,p_limit:1})
  if(claimed.error)throw new Error('อ่านคิวติดตามไม่ได้ กรุณาตรวจสอบ smart-follow-ups.sql')
  const job=(claimed.data as Claimed[]|null)?.[0]
  if(!job)return result
  result.remaining=true
  if(process.env.SNAPBOT_SAFETY_ENABLED==='true'&&await (await import('./automation-safety')).automationStopped(db,job.tenant_id)){
   const held=await db.from('follow_up_jobs').update({status:'requires_review',reason:'automation_stopped',claim_token:null,claim_until:null}).eq('id',job.id).eq('status','processing').eq('claim_token',job.claim_token)
   if(held.error)throw held.error
   result.review++;continue
  }
  // Obtain the Page token before preflight: a missing token must never consume message credit.
  const page=await db.from('tenants').select('page_id,page_access_token').eq('id',job.tenant_id).maybeSingle()
  if(page.error)throw page.error
  const token=pageTokenFor(page.data)
  if(!token){
   const saved=await db.from('follow_up_jobs').update({status:'requires_review',reason:'no_token',claim_token:null,claim_until:null}).eq('id',job.id).eq('status','processing').eq('claim_token',job.claim_token)
   if(saved.error)throw saved.error
   result.review++;continue
  }
  const prepared=await db.rpc('prepare_follow_up',{p_job:job.id,p_claim:job.claim_token})
  if(prepared.error){console.error('[smart-follow-up] preflight failed',{jobId:job.id,code:prepared.error.code});continue}
  const ready=prepared.data as {status:string;text?:string;psid?:string;reason?:string}
  if(ready.status!=='ready'){
   if(ready.status==='requires_review')result.review++
   else if(ready.status==='cancelled')result.cancelled++
   else result.skipped++
   continue
  }
  // prepare_follow_up commits the message/dispatch marker before this one and only network call.
  let outcome:'sent'|'failed'|'requires_review'='requires_review',provider:string|null=null,reason:string|null='delivery_unknown'
  try{
   if(!ready.text||!ready.psid)throw new Error('Invalid prepared dispatch')
   if(process.env.SNAPBOT_SAFETY_ENABLED==='true')await (await import('./automation-safety')).assertAutomationRunning(db,job.tenant_id)
   provider=await sendMessageWithReceipt(token,ready.psid,{text:ready.text},'UPDATE')
   outcome='sent';reason=null
  }catch(error){
   if((error as {code?:string})?.code==='AUTOMATION_STOPPED'){outcome='failed';reason='automation_stopped'}
   if(error instanceof SendApiError&&error.status<500){outcome=isWindowOrTagError(error)?'requires_review':'failed';reason=isWindowOrTagError(error)?'window_closed':'api_rejected'}
   console.warn('[smart-follow-up] delivery result',{jobId:job.id,outcome,code:error instanceof SendApiError?error.code:'network_unknown'})
  }
  // Explicit window rejection is also known not delivered; refund before putting it in review.
  const settled=await db.rpc('complete_follow_up',{p_job:job.id,p_claim:job.claim_token,p_result:outcome,p_provider:provider,p_reason:reason})
  if(settled.error||settled.data!==true){
   console.error('[smart-follow-up] result persistence requires review',{jobId:job.id,code:settled.error?.code??'claim_changed'})
   result.review++;continue // recovery converts an expired dispatch to review; never resend.
  }
  if(outcome==='sent')result.sent++
  else if(outcome==='failed')result.failed++
  else result.review++
 }
 return result
}
