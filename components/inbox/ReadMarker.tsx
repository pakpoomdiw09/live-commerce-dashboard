'use client'
import {useEffect,useRef} from 'react'
import type {MessageRow} from '@/lib/types'
export function ReadMarker({customerId,messages,onRead,mobileOpen}:{customerId:string|null;messages:MessageRow[];onRead:()=>Promise<void>;mobileOpen:boolean}){
 const latest=messages.filter(m=>m.customer_id===customerId&&m.sender==='customer').at(-1)?.id
 const completed=useRef('')
 const requests=useRef(new Map<string,Promise<boolean>>())
 useEffect(()=>{
  let disposed=false,pending=false
  const mark=async()=>{
   if(!customerId||!latest||document.visibilityState!=='visible'||completed.current===latest||pending)return
   if(!mobileOpen&&!window.matchMedia('(min-width: 768px)').matches)return
   pending=true
   const key=`${customerId}:${latest}`
   let work=requests.current.get(key)
   if(!work){work=fetch(`/api/inbox/conversations/${customerId}/read`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:latest})}).then(res=>res.ok).catch(()=>false);requests.current.set(key,work)}
   try{if(await work&&!disposed){completed.current=latest;await onRead()}}catch{}finally{requests.current.delete(key);pending=false}
  }
  void mark();document.addEventListener('visibilitychange',mark)
  window.addEventListener('resize',mark)
  return()=>{disposed=true;document.removeEventListener('visibilitychange',mark);window.removeEventListener('resize',mark)}
 },[customerId,latest,onRead,mobileOpen])
 return null
}
