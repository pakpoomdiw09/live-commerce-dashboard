import type {ConversationState} from '@/lib/features/inbox/inbox-types'
export function matchesInboxFilter(filter:string,id:string,state:ConversationState|undefined,viewerId:string|undefined,paymentIds:readonly string[],stars:readonly string[],paidIds:readonly string[]=[],followUpIds:readonly string[]=[]) {
 if(filter==='all')return true
 if(filter==='payment')return paymentIds.includes(id)
 if(filter==='starred')return stars.includes(id)
 if(filter==='tracked')return stars.includes(id)||followUpIds.includes(id)
 if(filter==='paid')return paidIds.includes(id)
 if(!state)return false
 switch(filter){
  case 'unread':return state.unread_count>0
  case 'mine':return !!state.assigned_user_id&&state.assigned_user_id===viewerId
  case 'unassigned':return !state.assigned_user_id&&state.conversation_status!=='closed'
  case 'ai':case 'bot':return state.bot_enabled&&state.conversation_status!=='closed'
  case 'waiting':return !state.bot_enabled&&!state.assigned_user_id&&state.conversation_status!=='closed'&&state.inbox_stage!=='RESOLVED'
  case 'progress':return state.inbox_stage==='IN_PROGRESS'||state.inbox_stage==='ASSIGNED'
  case 'resolved':return state.inbox_stage==='RESOLVED'||state.conversation_status==='closed'
  case 'closed':return state.conversation_status==='closed'
  default:return false
 }
}
