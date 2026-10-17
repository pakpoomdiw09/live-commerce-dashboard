'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import type {InboxState} from '@/lib/inbox-types'

export const INBOX_VIEWS=[['overview','ภาพรวมแชท'],['all','กล่องข้อความทั้งหมด'],['waiting','แชทรอรับ'],['mine','แชทของฉัน'],['team','งานของทีม'],['ai',"ผู้ช่วยอัจฉริยะ และระบบอัตโนมัติ"],['customers','ลูกค้าและประวัติ'],['reports','รายงานประสิทธิภาพ'],['security','ตั้งค่าและความปลอดภัย']] as const
export type InboxView=typeof INBOX_VIEWS[number][0]
type Report={enabled:boolean;counts:{total:number;waiting:number;active:number;closed:number;resolved:number;ai:number;bot:number;overdue:number};averageResponseSeconds:number|null;responseSamples:number;team:{actor_id:string;closed:number;claimed:number}[];overdueMinutes:number;days:number}

export function InboxReportsPanel({tenantId,inbox,view,onView}:{tenantId:string;inbox:InboxState;view:InboxView;onView:(view:InboxView)=>void}){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState('')
 const guide=useRef<HTMLDialogElement>(null)
 useEffect(()=>{
  const controller=new AbortController()
  void(async()=>{try{const response=await fetch(`/api/inbox/pro?tenantId=${encodeURIComponent(tenantId)}`,{signal:controller.signal,cache:'no-store'});const value=await response.json();if(!response.ok)throw Error(value.error||'โหลดรายงานไม่ได้');if(!controller.signal.aborted){setReport(value);setError('')}}catch(error){if(!controller.signal.aborted){setReport(null);setError(error instanceof Error?error.message:'โหลดรายงานไม่ได้')}}})()
  return()=>controller.abort()
 },[tenantId,inbox.conversations])
 const metric=(key:keyof Report['counts'])=>report?.enabled?report.counts[key].toLocaleString():'ยังไม่มีข้อมูล'
 return <header className="shrink-0 border-b border-orange-100 bg-white p-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="font-bold text-orange-800">ภาพรวมและรายงานทีมแชท</h1><p className="text-xs text-slate-500">ศูนย์ดูแลลูกค้า · ศูนย์รวมแชท ทีมแอดมิน ผู้ช่วยอัจฉริยะ และงานติดตาม</p></div><button type="button" className="rounded-xl border border-orange-200 px-3 py-2 text-xs text-orange-800" onClick={()=>guide.current?.showModal()}>คู่มือการใช้งาน</button></div>
  <nav aria-label="ส่วนการทำงานของกล่องข้อความ" className="mt-3 flex gap-1 overflow-x-auto">{INBOX_VIEWS.filter(([key])=>['overview','team','reports'].includes(key)).map(([key,label])=><button type="button" key={key} aria-current={view===key?'page':undefined} onClick={()=>onView(key)} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs ${view===key?'bg-orange-500 font-semibold text-white':'bg-orange-50 text-orange-900'}`}>{label}</button>)}</nav>
  {error&&<p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
  {['overview','reports','team'].includes(view)&&<div className="mt-3 max-h-56 overflow-y-auto rounded-xl bg-orange-50 p-3 text-xs">
   {view==='overview'&&<><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{([['total','ทั้งหมด'],['waiting','รอรับ'],['active','กำลังดูแล'],['resolved','แก้ไขเสร็จ'],['closed','ปิดแล้ว'],['bot',"ระบบอัตโนมัติดูแล"],['ai',"ผู้ช่วยอัจฉริยะดูแล"],['overdue','รอเกิน 15 นาที']] as const).map(([key,label])=><div key={key} className="rounded-lg bg-white p-2"><span>{label}</span><strong className="mt-1 block text-lg">{metric(key)}</strong></div>)}</div><p className="mt-2 text-slate-500">จำนวนจากฐานข้อมูลทั้งร้าน · ระบบอัตโนมัติดูแลอาจใช้คำค้นที่กำหนดหรือผู้ช่วยอัจฉริยะตามการตั้งค่า</p></>}
   {view==='reports'&&<><h2 className="font-semibold">เวลาตอบกลับของแอดมินใน 30 วัน</h2><p className="mt-2">{report?.averageResponseSeconds!=null?`เฉลี่ย ${report.averageResponseSeconds} วินาที จาก ${report.responseSamples} ข้อความลูกค้าที่ได้รับคำตอบ`:'ยังไม่มีข้อมูลเวลาตอบกลับที่ยืนยันการส่งแล้ว'}</p><p className="mt-2 text-slate-500">วัดจากข้อความลูกค้าแต่ละข้อความถึงคำตอบแอดมินที่ส่งสำเร็จครั้งถัดไป ไม่รวมคำตอบระบบอัตโนมัติและการส่งที่ยังไม่ทราบผล</p></>}
   {(view==='team'||view==='reports')&&<><h2 className="mt-2 font-semibold">ผลงานทีมใน 30 วัน</h2>{report?.enabled&&report.team.length?<ul className="mt-2 space-y-2">{report.team.map(row=><li key={row.actor_id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white p-2"><span>{inbox.members.find(member=>member.id===row.actor_id)?.name||'ผู้ดูแลเดิม'}</span><span>รับแชท {row.claimed} · ปิดงาน {row.closed}</span></li>)}</ul>:<p className="mt-2">ยังไม่มีข้อมูลผลงานทีม</p>}<p className="mt-2 text-slate-500">การมอบหมายและโอนแชทอยู่เหนือบทสนทนาที่เลือก เจ้าของร้านจัดการงานทีมได้ตามสิทธิ์</p></>}
  </div>}
  {view==='ai'&&<p className="mt-2 text-xs text-slate-600">การรับแชทจะหยุดตอบอัตโนมัติชั่วคราวและการติดตามตามนโยบายเดิม · <Link className="text-orange-700 underline" href="/chatbot/conversations">ตั้งค่าผู้ช่วย ผู้ช่วยอัจฉริยะ และระบบหยุดฉุกเฉิน</Link></p>}
  {view==='customers'&&<p className="mt-2 text-xs text-slate-600">เลือกลูกค้าแล้วเปิด “รายละเอียด” เพื่อดูข้อมูล แท็ก บันทึก ออเดอร์ สลิป และประวัติการดูแล</p>}
  {view==='security'&&<p className="mt-2 text-xs text-slate-600">ทุกคำสั่งตรวจสิทธิ์ร้านและเวอร์ชันแชท บันทึกผู้ดำเนินการและเหตุผลปิดในประวัติ · ส่งคำสั่งจัดการได้สูงสุด 30 รายการต่อนาทีต่อผู้ดูแลต่อร้าน · การแจ้งเตือนเสียงและการตั้งค่าเวลารอแบบกำหนดเองยังไม่เปิดใช้งาน</p>}
  <dialog ref={guide} aria-labelledby="inbox-guide-title" className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl backdrop:bg-black/50">
   <div className="flex justify-between gap-3"><h2 id="inbox-guide-title" className="font-bold">คู่มือดูแลแชทสำหรับเจ้าของร้านและแอดมิน</h2><button type="button" autoFocus onClick={()=>guide.current?.close()} className="rounded-lg border px-3 py-1 text-sm">ปิดคู่มือ</button></div>
   <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed"><li>เลือกเพจให้ถูกต้อง แล้วใช้กล่องข้อความทั้งหมดหรือค้นหาลูกค้า เลือกรายชื่อซ้ำจะยังคงเปิดเพียงบทสนทนาเดิม</li><li>ใช้ “แชทรอรับ” เพื่อรับแชท หรือให้เจ้าของร้านมอบหมายผู้ดูแล เมื่อรับแล้วระบบอัตโนมัติและงานติดตามจะหยุดตามเงื่อนไขเดิม</li><li>ใช้ “เริ่มดูแล” หรือส่งคำตอบเพื่อเข้าสู่กำลังดูแล หากระบบยังไม่เปิดรับช่วงตอนส่งอัตโนมัติ ให้กดรับแชทก่อนพิมพ์</li><li>ใช้ “มอบหมาย / โอนแชท” เพื่อเปลี่ยนผู้ดูแล หรือ “คืนคิวรอรับ” เพื่อให้ทีมรับต่อ การคืนคิวจะยังหยุดตอบอัตโนมัติชั่วคราว</li><li>เมื่อแก้ปัญหาแล้วกด “แก้ไขเสร็จแล้ว” จากนั้น “ปิดแชท” พร้อมเหตุผล เปิดใหม่ได้ตามสิทธิ์โดยไม่ลบประวัติ หากลูกค้าตอบใหม่ระบบเปิดบทสนทนากลับตามนโยบายเดิม</li><li>ดูรายละเอียดลูกค้า ออเดอร์ สลิป งานติดตาม และประวัติการดำเนินการในคอลัมน์ขวา มือถือใช้ปุ่มรายละเอียด ระบบตรวจสลิปยังต้องผ่านผู้ให้บริการจริง</li><li>อ่านภาพรวมและรายงานจากข้อมูลจริง หากยังไม่มีข้อมูลจะไม่แสดงตัวเลขจำลอง เวลารอเกินกำหนดใช้ 15 นาทีในรุ่นนี้</li><li>หากขึ้นว่าส่งไม่ทราบผล ให้ตรวจข้อความในเพจก่อนส่งใหม่ หากสถานะแชทเปลี่ยนโดยผู้ดูแลอื่น ให้โหลดสถานะล่าสุดก่อนทำรายการซ้ำ</li></ol>
   <p className="mt-4 text-sm text-slate-600">คู่มือและรายงานไม่ส่งข้อความลูกค้า การเปิดการตอบอัตโนมัติต้องตรวจสิทธิ์แพ็กเกจและการตั้งค่าร้าน การพักฉุกเฉินรายร้านต้องเปิดใช้งานระบบความปลอดภัยแยกต่างหาก</p>
  </dialog>
 </header>
}
