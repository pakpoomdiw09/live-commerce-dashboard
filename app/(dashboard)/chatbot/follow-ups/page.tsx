import {hasFeature} from '@/lib/feature-access'
import {FeatureLocked} from '@/components/shared/FeatureLocked'
import {supabaseAdmin,supabaseServer} from '@/lib/supabase/server'
import {getActiveTenant} from '@/lib/tenant'
import {followUpDashboard} from '@/lib/features/follow-ups/smart-followup-server'
import {SetupNotice} from '@/components/shared/SetupNotice'
import {FollowUpsClient} from '@/components/chatbot/FollowUpsClient'
export const metadata={title:'Smart Follow-up Assistant'}
export default async function FollowUpsPage(){
 const [tenant,db]=await Promise.all([getActiveTenant(),supabaseServer()])
 if(!tenant)return <SetupNotice kind="no-tenant"/>
 if(!(await hasFeature(db,tenant.id,'customer_follow_up')))return <FeatureLocked/>
 try{
  const initial=await followUpDashboard(supabaseAdmin(),tenant.id)
  return <FollowUpsClient key={tenant.id} tenantId={tenant.id} initial={initial}/>
 }catch{return <SetupNotice kind="migration" message="กรุณารัน smart-follow-ups.sql หลัง smart-inbox.sql ก่อนใช้งาน Smart Follow-up"/>}
}
