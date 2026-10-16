'use client'
import {useRef,useState} from 'react'
import {Bot,Check,UserRoundCheck} from 'lucide-react'
import type {ConversationState,InboxState} from '@/lib/inbox-types'
import {apiError} from '@/lib/utils'
const stages:Record<string,string>={UNASSIGNED:'รอรับแชท',ASSIGNED:'มอบหมายแล้ว',IN_PROGRESS:'กำลังดูแล',RESOLVED:'แก้ไขเสร็จแล้ว',CLOSED:'ปิดแชทแล้ว'}
export function ConversationActions({state,inbox,onChange}:{state:ConversationState|undefined;inbox:InboxState|null;onChange:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[target,setTarget]=useState(''),[closing,setClosing]=useState(false),[reason,setReason]=useState(''),[notice,setNotice]=useState('')
 const locked=useRef(false)
 const pending=useRef<{signature:string;body:object}|null>(null)
 async function act(action:string){
  if(!state||locked.current)return
  locked.current=true;setBusy(true);setError('');setNotice('')
  const signature=JSON.stringify([state.id,action,target,reason])
  const body=pending.current?.signature===signature?pending.current.body:{action,version:state.conversation_version,assigneeId:target||undefined,...(inbox?.proEnabled?{requestId:crypto.randomUUID(),reason:reason.trim()||undefined}:{})}
  pending.current={signature,body}
  try{
   const res=await fetch('/api/inbox/conversations/'+state.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
   if(!res.ok){if(res.status<500)pending.current=null;throw new Error(await apiError(res))}
   pending.current=null;setClosing(false);setReason('');setNotice('บันทึกสถานะแชทแล้ว')
  }catch(e){setError(e instanceof Error?e.message:'ดำเนินการไม่สำเร็จ')}
  finally{try{await onChange()}catch{setError('บันทึกคำขอแล้ว แต่โหลดสถานะล่าสุดไม่ได้ กรุณาตรวจสถานะก่อนทำซ้ำ')}finally{locked.current=false;setBusy(false)}}
 }
 const button='inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-xs text-orange-800 hover:bg-orange-100 disabled:opacity-40'
 const owner=inbox?.members.find(m=>m.id===state?.assigned_user_id)?.name
 const closed=state?.conversation_status==='closed'
 const canManage=!inbox?.proEnabled||inbox.canManageTeam||state?.assigned_user_id===inbox.viewerId
 return <div className="border-b border-orange-100 bg-orange-50/70 px-4 py-2">
  <p className="mb-2 text-xs text-slate-600">ผู้รับผิดชอบ: {owner||'ยังไม่มอบหมาย'} · {state?.inbox_stage?stages[state.inbox_stage]:closed?'ปิดแชทแล้ว':state?.assigned_user_id?'กำลังดูแล':state?.bot_enabled?'บอทกำลังดูแล':'รอรับแชท'}</p>
  <div className="flex flex-wrap gap-2" aria-busy={busy}>
   <button className={button} disabled={busy||!state||closed||!!state.assigned_user_id} onClick={()=>void act('claim')}><UserRoundCheck size={14}/>รับแชท</button>
   <select aria-label="มอบหมายหรือโอนให้ผู้ดูแล" className="min-w-0 max-w-full rounded-lg border border-orange-200 bg-white px-2 text-xs" disabled={busy||!state||closed} value={target} onChange={e=>setTarget(e.target.value)}><option value="">เลือกผู้ดูแล</option>{inbox?.members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
   <button className={button} disabled={busy||!target||!state||closed||!canManage} onClick={()=>void act('transfer')}>มอบหมาย / โอนแชท</button>
   {inbox?.proEnabled&&<><button className={button} disabled={busy||!state?.assigned_user_id||closed||!canManage} onClick={()=>void act('start')}>เริ่มดูแล</button><button className={button} disabled={busy||!state?.assigned_user_id||closed||!canManage} onClick={()=>void act('resolve')}>แก้ไขเสร็จแล้ว</button><button className={button} disabled={busy||!state?.assigned_user_id||closed||!canManage} onClick={()=>void act('release')}>คืนคิวรอรับ</button></>}
   <button className={button} disabled={busy||!state} onClick={()=>closed?void act('reopen'):inbox?.proEnabled?setClosing(true):void act('close')}><Check size={14}/>{closed?'เปิดแชทใหม่':'ปิดแชท'}</button>
   <button className={button} disabled={busy||!state||closed} onClick={()=>void act(state?.bot_enabled?'pause':'bot')}><Bot size={14}/>{state?.bot_enabled?'พักบอท':'คืนให้บอท'}</button>
  </div>
  {closing&&<form className="mt-3 space-y-2" onSubmit={e=>{e.preventDefault();void act('close')}}><label className="block text-xs">เหตุผลปิดแชท<textarea autoFocus aria-label="เหตุผลปิดแชท" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} required disabled={busy} className="mt-1 block w-full rounded-lg border bg-white p-2" placeholder="ตัวอย่าง: ลูกค้าได้รับคำตอบครบแล้ว"/></label><button className={button} disabled={busy||!reason.trim()}>ยืนยันปิดแชท</button><button type="button" className={button} disabled={busy} onClick={()=>setClosing(false)}>ยกเลิก</button></form>}
  {error&&<p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}{notice&&<p role="status" className="mt-2 text-xs text-green-800">{notice}</p>}
 </div>
}
