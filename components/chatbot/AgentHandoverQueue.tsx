'use client'
import {createBackgroundRefresh} from '@/lib/background-refresh'
import {useCallback,useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {MessageCircle,MessageSquare,Music2,RefreshCw,ShoppingBag} from 'lucide-react'
import {Avatar} from '@/components/inbox/Avatar'
import {supabaseBrowser} from '@/lib/supabase/browser'
import {handoverChannel,handoverCustomerName,type HandoverCustomer} from '@/lib/features/agents/agent-handover'

export function AgentHandoverQueue({tenantId,initial,busy,onAction}:{tenantId:string;initial:HandoverCustomer[];busy:boolean;onAction:(customer:HandoverCustomer,action:string,label:string)=>Promise<void>}){
 const [customers,setCustomers]=useState(initial),[loading,setLoading]=useState(false),[error,setError]=useState('')
 const sequence=useRef(0)
 const invalidate=useCallback(()=>{sequence.current++},[])
 useEffect(()=>{sequence.current++;setCustomers(initial);setLoading(false)},[initial])
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  const request=++sequence.current;setLoading(true)
  try{
   const response=await fetch(`/api/agent-control/handover?tenantId=${encodeURIComponent(tenantId)}`,{cache:'no-store',signal}),value=await response.json()
   if(!response.ok)throw Error(value.error??'โหลดรายชื่อลูกค้าไม่สำเร็จ')
   if(!Array.isArray(value.customers))throw Error('ข้อมูลรายชื่อลูกค้าไม่ถูกต้อง กรุณาอัปเดตรายชื่ออีกครั้ง')
   if(sequence.current===request&&!signal?.aborted){setCustomers(value.customers);setError('')}
  }catch(error){if(sequence.current===request&&!signal?.aborted)setError(error instanceof Error?error.message:'โหลดรายชื่อลูกค้าไม่สำเร็จ')}
  finally{if(sequence.current===request)setLoading(false)}
 },[tenantId])
 useEffect(()=>{
  const db=supabaseBrowser();const scheduler=createBackgroundRefresh(signal=>refresh(signal),()=>{}, {intervalMs:60000})
  const sync=scheduler.request
  const channel=db.channel(`agent-handover:${tenantId}:${crypto.randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table:'customers',filter:`tenant_id=eq.${tenantId}`},sync).subscribe(status=>{if(status==='SUBSCRIBED')sync()})
  window.addEventListener('online',sync);document.addEventListener('visibilitychange',sync);sync()
  return()=>{invalidate();scheduler.stop();window.removeEventListener('online',sync);document.removeEventListener('visibilitychange',sync);void db.removeChannel(channel)}
 },[tenantId,refresh,invalidate])
 return <section aria-labelledby="handover-title" aria-busy={loading||busy} className="min-w-0 space-y-4 rounded-3xl border border-orange-100 bg-white p-4 shadow-sm md:p-6">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="handover-title" className="font-semibold">ผู้ดูแลบทสนทนา · 50 แชทล่าสุด</h2><p className="mt-1 text-sm leading-6 text-slate-500">ดูชื่อลูกค้าและช่องทางก่อนรับช่วง เมื่อแอดมินรับแชท ระบบตอบอัตโนมัติและการติดตามจะหยุด</p></div><button type="button" disabled={loading||busy} onClick={()=>void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-orange-100 px-3 py-2 text-sm text-orange-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`} aria-hidden="true"/>อัปเดตรายชื่อ</button></div>
  {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
  <ul aria-label="รายชื่อลูกค้าในคิวส่งต่อ" className="space-y-3">{customers.map(customer=>{
   const name=handoverCustomerName(customer),channel=handoverChannel(customer.platform),Icon=({facebook:MessageCircle,line:MessageCircle,lazada:ShoppingBag,tiktok:Music2,unknown:MessageSquare})[channel.id as 'facebook'|'line'|'lazada'|'tiktok'|'unknown']
   const status=({AI_ACTIVE:['AI กำลังดูแล','bg-orange-50 text-orange-800'],ADMIN_ACTIVE:['แอดมินกำลังดูแล','bg-blue-50 text-blue-800'],WAITING_ADMIN:['รอแอดมิน','bg-amber-50 text-amber-800'],PAUSED:['พักการตอบอัตโนมัติ','bg-slate-100 text-slate-600']} as const)[customer.ownership]
   return <li key={customer.id} data-handover-customer={customer.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-slate-100 bg-slate-50/30 p-4 md:flex-row md:items-center md:justify-between">
    <div className="flex min-w-0 items-center gap-3"><Avatar c={{...customer,display_name:customer.display_name?.trim()||null}} className="h-12 w-12 text-base"/><div className="min-w-0"><Link href={`/inbox?customer=${encodeURIComponent(customer.id)}`} title={name} className="block truncate font-semibold text-slate-900 hover:text-orange-600">{name}</Link><span className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${channel.color}`}><Icon className="h-3 w-3" aria-hidden="true"/>{channel.label}</span></div></div>
    <div className="flex min-w-0 flex-col gap-2 md:items-end"><span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${status[1]}`}>{status[0]}</span>{customer.agent_opted_out&&<p className="text-xs text-slate-500">ลูกค้าไม่รับข้อความอัตโนมัติ</p>}<div className="flex flex-wrap gap-2">{[['claim','รับแชท'],['pause','พักบอท'],['bot','คืนให้บอท']].map(([action,label])=><button key={action} type="button" disabled={busy||action==='bot'&&customer.agent_opted_out} onClick={()=>void onAction(customer,action,label)} className={`rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-40 ${action==='claim'?'border-orange-500 bg-orange-500 text-white hover:bg-orange-600':'border-slate-200 bg-white text-slate-600 hover:border-orange-200 hover:text-orange-700'}`}>{label}</button>)}</div></div>
   </li>
  })}</ul>
  {!customers.length&&<p className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">ไม่มีรายการแชทที่เข้าถึงได้ · <Link href="/inbox" className="text-orange-700 underline">เปิดกล่องข้อความ</Link></p>}
 </section>
}
