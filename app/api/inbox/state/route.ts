import {NextRequest,NextResponse} from 'next/server'
import {inboxTenant,inboxError} from '@/lib/inbox-server'
import {hasFeature} from '@/lib/feature-access'
import type {InboxMember,ConversationState} from '@/lib/inbox-types'
const memberCache=new Map<string,{until:number;members:InboxMember[]}>()
async function allPages<T>(query:(offset:number)=>PromiseLike<{data:T[]|null;error:unknown}>){
 const rows:T[]=[]
 for(let offset=0;;offset+=500){const result=await query(offset);if(result.error)throw result.error;rows.push(...(result.data??[]));if((result.data?.length??0)<500)return {data:rows,error:null}}
}
export async function GET(req:NextRequest){try{
 const {db,actor,tenantId}=await inboxTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
 const pro=process.env.SMART_INBOX_PRO_ENABLED==='true'
 const [customers,reads,team,page,rules]=await Promise.all([
  allPages<Omit<ConversationState,'unread_count'>>(offset=>db.from('customers').select('id,assigned_user_id,conversation_status,conversation_version,inbound_seq,bot_enabled'+(pro?',inbox_stage,closed_at,close_reason':'')).eq('tenant_id',tenantId).order('id').range(offset,offset+499).returns<Omit<ConversationState,'unread_count'>[]>()),
  allPages<{customer_id:string;read_seq:number}>(offset=>db.from('conversation_reads').select('customer_id,read_seq,customers!inner(tenant_id)').eq('user_id',actor.id).eq('customers.tenant_id',tenantId).order('customer_id').range(offset,offset+499)),
  allPages<{user_id:string;role:string}>(offset=>db.from('tenant_members').select('user_id,role').eq('tenant_id',tenantId).order('user_id').range(offset,offset+499)),
  db.from('tenants').select('name,page_name').eq('id',tenantId).single(),
  db.from('chat_rules').select('reply_text').eq('tenant_id',tenantId).eq('is_active',true).eq('reply_type','text').order('priority',{ascending:false}).limit(20),
 ])
 for(const result of [customers,reads,team,page,rules])if(result.error)throw result.error
 if(!page.data)throw new Error('Page unavailable')
 const memberIds=(team.data??[]).map(row=>row.user_id).sort().join(',')
 const cacheKey=`${tenantId}:${memberIds}`
 const cached=memberCache.get(cacheKey)
 const members=cached&&cached.until>Date.now()?[...cached.members]:await Promise.all((team.data??[]).map(async({user_id})=>{
  const {data,error}=await db.auth.admin.getUserById(user_id)
  if(error)throw error
  const user=data.user
  return {id:user_id,name:String(user?.user_metadata?.full_name||user?.user_metadata?.name||user?.email?.split('@')[0]||user_id.slice(0,8))}
 }))
 if(!cached||cached.until<=Date.now()){
  if(memberCache.size>100)memberCache.clear()
  memberCache.set(cacheKey,{until:Date.now()+60000,members:[...members]})
 }
 if(!members.some(member=>member.id===actor.id))members.push({id:actor.id,name:'คุณ'})
 const readMap=new Map((reads.data??[]).map(row=>[row.customer_id,Number(row.read_seq)]))
 return NextResponse.json({canManageTeam:actor.isPlatformAdmin||(team.data??[]).some(member=>member.user_id===actor.id&&member.role==='owner'),proEnabled:pro,viewerId:actor.id,members,aiAllowed:await hasFeature(db,tenantId,'ai_agent'),autoClaimOnReply:process.env.SNAPBOT_SAFETY_ENABLED==='true',pageName:page.data.page_name||page.data.name,
  quickReplies:(rules.data??[]).map(row=>row.reply_text).filter((text):text is string=>typeof text==='string'&&!!text.trim()),
  conversations:(customers.data??[]).map(row=>({...row,unread_count:Math.max(0,Number(row.inbound_seq)-(readMap.get(row.id)??0))})),
 },{headers:{'Cache-Control':'no-store'}})
 }catch(error){return inboxError(error)}}
