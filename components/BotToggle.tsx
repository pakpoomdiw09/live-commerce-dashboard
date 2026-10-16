'use client'
import {useState} from 'react'
import {apiError} from '@/lib/utils'
/** All bot transitions use the same versioned, audited server action as the Inbox toolbar. */
export function BotToggle({customerId,enabled}:{customerId:string;enabled:boolean}){
 const [pending,setPending]=useState(false),[error,setError]=useState('')
 async function toggle(){setPending(true);setError('');try{
  const current=await fetch(`/api/inbox/conversations/${customerId}`,{cache:'no-store'});if(!current.ok)throw new Error(await apiError(current))
  const {customer}=await current.json()
  const res=await fetch(`/api/inbox/conversations/${customerId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:customer.bot_enabled?'pause':'bot',version:customer.conversation_version})})
  if(!res.ok)throw new Error(await apiError(res))
 }catch(e){setError(e instanceof Error?e.message:'เปลี่ยนสถานะไม่สำเร็จ')}finally{setPending(false)}}
 return <div><button role="switch" aria-checked={enabled} disabled={pending} onClick={()=>void toggle()} className="flex items-center gap-2 text-sm disabled:opacity-50"><span className={`h-5 w-9 rounded-full p-0.5 ${enabled?'bg-orange-500':'bg-slate-300'}`}><span className={`block h-4 w-4 rounded-full bg-white transition-transform ${enabled?'translate-x-4':''}`}/></span>{enabled?'บอทตอบอัตโนมัติ: เปิด':'บอทตอบอัตโนมัติ: ปิด'}</button>{error&&<p role="alert" className="mt-1 text-xs text-rose-600">{error}</p>}</div>
}
