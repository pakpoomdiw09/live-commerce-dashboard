'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {supabaseBrowser} from '@/lib/supabase/browser'
import type {InboxState} from '@/lib/features/inbox/inbox-types'
import {apiError} from '@/lib/utils'
import {LatestInboxRequest} from '@/lib/features/inbox/inbox-request'
import {inboxChannelName} from '@/lib/features/inbox/inbox-realtime'

export function useInboxState(tenantId:string|undefined,customerIds:readonly string[]=[]){
 const [data,setData]=useState<InboxState|null>(null),[error,setError]=useState<string|null>(null)
 const idsKey=[...new Set(customerIds)].sort().join(',')
 const generation=useRef(0)
 const gate=useRef(new LatestInboxRequest())
 const refresh=useCallback(async()=>{
  if(!tenantId)return
  const request=++generation.current
  const ticket=gate.current.begin()
  try{
   const ids=idsKey?idsKey.split(','):[]
   let next:InboxState|null=null
   for(let offset=0;offset<Math.max(1,ids.length);offset+=500){
    const query=ids.length?'&customerIds='+encodeURIComponent(ids.slice(offset,offset+500).join(',')):''
    const res=await fetch('/api/inbox/state?tenantId='+tenantId+query,{cache:'no-store',signal:ticket.signal})
    if(!res.ok)throw new Error(await apiError(res))
    const page=await res.json() as InboxState
    next=next?{...page,conversations:[...next.conversations,...page.conversations]}:page
    if(!ticket.current())return
   }
   if(ticket.current()&&request===generation.current){setData(next);setError(null)}
  }
  catch(e){if(ticket.current()&&request===generation.current)setError(e instanceof Error?e.message:'โหลดสถานะแชทไม่สำเร็จ')}
 },[tenantId,idsKey])
 const latestRefresh=useRef(refresh)
 const scheduleRefresh=useRef<()=>void>(()=>{})
 const previousIds=useRef(idsKey)
 useEffect(()=>{latestRefresh.current=refresh},[refresh])
 useEffect(()=>{
  const activeGate=gate.current
  const invalidate=()=>{++generation.current}
  setData(null);setError(null)
  console.log('[DEBUG-REALTIME] Metadata effect mounted:',{tenantId:tenantId??null})
  if(!tenantId){console.warn('[DEBUG-REALTIME] Metadata subscription skipped: no tenant');return}
  const db=supabaseBrowser();let timer:ReturnType<typeof setTimeout>|undefined
  let live=false,lastRefresh=Date.now(),running=false,dirty=false,disposed=false
  const sync=async()=>{
   if(disposed||document.visibilityState==='hidden')return
   if(running){dirty=true;return}
   running=true;lastRefresh=Date.now()
   try{await latestRefresh.current()}finally{running=false;if(dirty&&!disposed){dirty=false;schedule()}}
  }
  const schedule=()=>{if(timer||disposed)return;timer=setTimeout(()=>{timer=undefined;void sync()},Math.max(1000,5000-(Date.now()-lastRefresh)))}
  scheduleRefresh.current=schedule
  void sync()
  let channel:ReturnType<typeof db.channel>|undefined
  let reconnectTimer:ReturnType<typeof setTimeout>|undefined
  let retries=0,fallback=false,connecting=false
  // Retire the specific instance before awaiting removal. Late CLOSED/events
  // from it cannot change the replacement's status or schedule more retries.
  const remove=async(old:NonNullable<typeof channel>)=>{
   try{await db.removeChannel(old)}catch{console.warn('[inbox-state/realtime] channel cleanup failed',{tenantId})}
  }
  const connect=async()=>{
   if(disposed||connecting)return
   connecting=true
   try{
    const old=channel;channel=undefined
    if(old)await remove(old)
    if(disposed)return
    const channelName=inboxChannelName('inbox-state',tenantId)
    console.log('[DEBUG-REALTIME] Creating metadata channel:',{channelName,customerFilter:`tenant_id=eq.${tenantId}`})
    const next=db.channel(channelName)
    channel=next
    const current=()=>!disposed&&channel===next
    const changed=()=>{if(current())schedule()}
    next.on('postgres_changes',{event:'*',schema:'public',table:'customers',filter:`tenant_id=eq.${tenantId}`},changed)
     .on('postgres_changes',{event:'*',schema:'public',table:'conversation_reads'},changed)
     .subscribe((status,err)=>{
      console.log('[DEBUG-REALTIME] Channel Status:',status,err,{channelName,ignored:!current()})
      if(!current())return
      if(status==='SUBSCRIBED'){
       live=true;fallback=false;retries=0;clearTimeout(reconnectTimer);reconnectTimer=undefined;schedule()
      }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
       live=false
       if(reconnectTimer)return
       if(retries>=3){fallback=true;console.warn('[inbox-state/realtime] retries exhausted; polling every 30 seconds',{status,tenantId});return}
       const delay=1000*2**retries++
       console.warn('[inbox-state/realtime] reconnect scheduled',{status,tenantId,delay})
       reconnectTimer=setTimeout(()=>{reconnectTimer=undefined;void connect()},delay)
      }
     })
   }catch{
    if(!disposed){live=false;fallback=true;console.warn('[inbox-state/realtime] setup failed; polling every 30 seconds',{tenantId})}
   }finally{connecting=false}
  }
  void connect()
  const poll=setInterval(()=>{if((!live&&fallback)||Date.now()-lastRefresh>=120000)void sync()},30000)
  const focus=()=>{
   if(document.visibilityState!=='visible'||disposed)return
   schedule()
   if(!live&&!connecting&&!reconnectTimer){retries=0;void connect()}
  }
  document.addEventListener('visibilitychange',focus);window.addEventListener('online',focus)
  return()=>{
   disposed=true;live=false;scheduleRefresh.current=()=>{};invalidate();activeGate.cancel()
   clearTimeout(timer);clearTimeout(reconnectTimer);clearInterval(poll)
   document.removeEventListener('visibilitychange',focus);window.removeEventListener('online',focus)
   const old=channel;channel=undefined;if(old)void remove(old)
  }
 },[tenantId])
 useEffect(()=>{if(previousIds.current!==idsKey){previousIds.current=idsKey;scheduleRefresh.current()}},[idsKey])
 return {data,error,refresh}
}
