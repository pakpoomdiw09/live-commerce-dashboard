'use client'
import {useEffect,useState} from 'react'
import type {CustomerRow} from '@/lib/types'
import {apiError,baht,when} from '@/lib/utils'
import type {InboxMember} from '@/lib/inbox-types'
type Detail={orders:{id:string;product_name:string;amount:number;status:string;created_at:string}[];events:{id:string;actor_id:string|null;next_assignee:string|null;action:string;created_at:string;reason?:string|null}[];followups?:{id:string;kind:string;status:string;run_at:string;sent_at:string|null}[]}
const ACTION:Record<string,string>={claim:'รับแชท',transfer:'โอนแชท',close:'ปิดแชท',reopen:'เปิดแชทใหม่',pause:"หยุดตอบอัตโนมัติชั่วคราว",bot:"เปิดการตอบอัตโนมัติ",handover:"ระบบอัตโนมัติส่งต่อให้แอดมิน",release:'คืนคิวรอรับ',start:'เริ่มดูแล',resolve:'แก้ไขเสร็จแล้ว'}
export function ConversationHistory({customer,members,section}:{customer:CustomerRow;members:InboxMember[];section?:'orders'|'history'}){
 const [detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState('')
 useEffect(()=>{const controller=new AbortController();setDetail(null);setError('');void(async()=>{try{
  const res=await fetch(`/api/inbox/conversations/${customer.id}`,{signal:controller.signal,cache:'no-store'});if(!res.ok)throw new Error(await apiError(res));const next=await res.json();if(!controller.signal.aborted)setDetail(next)
 }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'โหลดประวัติไม่สำเร็จ')}})();return()=>controller.abort()},[customer.id,customer.conversation_version])
 return <section className="space-y-3 border-t border-slate-100 pt-4 text-xs">
  <dl className="space-y-1 text-slate-500"><div><dt className="inline">รหัสลูกค้า: </dt><dd className="break-all font-mono">{customer.id}</dd></div><div><dt className="inline">ข้อความล่าสุด: </dt><dd className="inline">{customer.last_message_at?when(customer.last_message_at):'ยังไม่มี'}</dd></div></dl>
  {section!=='history'&&<> <h3 className="font-semibold text-slate-700">ออเดอร์ล่าสุด</h3>
  {error&&<p role="alert" className="text-rose-600">{error}</p>}
  {!detail&&!error&&<p className="text-slate-400">กำลังโหลดประวัติ…</p>}
  {detail?.orders.length===0&&<p className="text-slate-400">ยังไม่มีออเดอร์</p>}
  {detail?.orders.map(order=><div key={order.id} className="rounded-lg bg-orange-50 p-2"><p className="font-medium">{order.product_name} · {baht(order.amount)}</p><p className="mt-1 text-slate-500">{({pending_payment:'รอชำระ',paid:'ชำระแล้ว',cancelled:'ยกเลิก',shipped:'จัดส่งแล้ว'} as Record<string,string>)[order.status]||'รอตรวจสอบ'} · {when(order.created_at)}</p></div>)}
  </>}{section!=='orders'&&<><h3 className="font-semibold text-slate-700">ประวัติการติดตาม</h3>
  {detail?.followups?.length===0&&<p className="text-slate-400">ยังไม่มีงานติดตามที่เข้าถึงได้</p>}
  {detail?.followups?.map(job=><div key={job.id} className="rounded-lg bg-orange-50 p-2"><p>{({payment:"ติดตามการชำระเงิน",interested:"ติดตามความสนใจ",after_sales:"ดูแลหลังขาย"} as Record<string,string>)[job.kind]||"งานติดตาม"} · {({sent:"ส่งแล้ว",scheduled:"ตั้งเวลาแล้ว",pending:"รอดำเนินการ",processing:"กำลังดำเนินการ",requires_review:"รอตรวจสอบ",cancelled:"ยกเลิก",failed:"ไม่สำเร็จ",skipped:"ข้ามแล้ว"} as Record<string,string>)[job.status]||"รอตรวจสอบ"}</p><time>{when(job.sent_at||job.run_at)}</time></div>)}
  <h3 className="font-semibold text-slate-700">ประวัติการดูแลแชท</h3>
  {detail?.events.length===0&&<p className="text-slate-400">ยังไม่มีประวัติการเปลี่ยนผู้ดูแล</p>}
  {detail?.events.map(event=><div key={event.id} className="border-l-2 border-orange-200 pl-2 text-slate-500"><p>{ACTION[event.action]||'ปรับปรุงข้อมูลการดูแล'} · {event.actor_id?members.find(member=>member.id===event.actor_id)?.name||'ผู้ดูแลเดิม':'ระบบ'}{event.action==='transfer'&&` → ${members.find(member=>member.id===event.next_assignee)?.name||'ผู้ดูแลเดิม'}`}</p>{event.reason&&<p className="mt-1">เหตุผล: {event.reason}</p>}<time className="text-[10px]">{when(event.created_at)}</time></div>)}
 </>}</section>
}
