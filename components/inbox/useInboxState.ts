'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {supabaseBrowser} from '@/lib/supabase/browser'
import type {InboxState} from '@/lib/inbox-types'
import {apiError} from '@/lib/utils'
import {LatestInboxRequest} from '@/lib/inbox-request'

export function useInboxState(tenantId:string|undefined){
 const [data,setData]=useState<InboxState|null>(null),[error,setError]=useState<string|null>(null)
 const generation=useRef(0)
 const gate=useRef(new LatestInboxRequest())
 const invalidate=useCallback(()=>{++generation.current},[])
 const refresh=useCallback(async()=>{
  if(!tenantId)return
  const request=++generation.current
  const ticket=gate.current.begin()
  try{const res=await fetch(`/api/inbox/state?tenantId=${tenantId}`,{cache:'no-store',signal:ticket.signal});if(!res.ok)throw new Error(await apiError(res));const next=await res.json();if(ticket.current()&&request===generation.current){setData(next);setError(null)}}
  catch(e){if(ticket.current()&&request===generation.current)setError(e instanceof Error?e.message:'โหลดสถานะแชทไม่สำเร็จ')}
 },[tenantId])
 useEffect(()=>{
  const activeGate=gate.current
  setData(null);setError(null)
  if(!tenantId)return
  void refresh()
  const db=supabaseBrowser();let timer:ReturnType<typeof setTimeout>|undefined
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),400)}
  const channel=db.channel(`inbox-state:${tenantId}:${crypto.randomUUID()}`)
   .on('postgres_changes',{event:'*',schema:'public',table:'customers',filter:`tenant_id=eq.${tenantId}`},schedule)
   .on('postgres_changes',{event:'*',schema:'public',table:'conversation_reads'},schedule)
   .subscribe(status=>{if(status==='SUBSCRIBED')schedule()})
  const poll=setInterval(()=>void refresh(),30000)
  const focus=()=>{if(document.visibilityState==='visible')void refresh()}
  document.addEventListener('visibilitychange',focus);window.addEventListener('online',focus)
  return()=>{invalidate();activeGate.cancel();clearTimeout(timer);clearInterval(poll);document.removeEventListener('visibilitychange',focus);window.removeEventListener('online',focus);void db.removeChannel(channel)}
 },[tenantId,refresh,invalidate])
 return {data,error,refresh}
}
