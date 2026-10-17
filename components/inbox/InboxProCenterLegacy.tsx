'use client'
import {useRef} from 'react'
import Link from 'next/link'
import {BarChart3,HelpCircle,Settings2} from 'lucide-react'
import type {InboxState} from '@/lib/inbox-types'
const INBOX_VIEWS=[['all','แชททั้งหมด'],['waiting','รอแอดมิน'],['ai',"ผู้ช่วยอัจฉริยะ / ระบบอัตโนมัติดูแลอยู่"]] as const
type InboxView='all'|'waiting'|'ai'|'mine'|'team'|'overview'|'reports'|'customers'|'security'
export function InboxProCenterLegacy({inbox,view,onView}:{tenantId:string;inbox:InboxState;view:InboxView;onView:(view:InboxView)=>void}){
 const guide=useRef<HTMLDialogElement>(null)
 return <header className="shrink-0 space-y-3 border-b border-slate-100 bg-white px-4 py-4 sm:px-6">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-semibold text-slate-900">ศูนย์รวมแชท</h1><p className="mt-1 text-xs text-slate-500">{inbox.pageName} · ดูแลลูกค้าได้ในที่เดียว</p></div><div className="flex gap-2"><Link href="/inbox/reports" title="ภาพรวมและรายงานทีม" aria-label="ภาพรวมและรายงานทีม" className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"><BarChart3 className="h-5 w-5"/></Link><button type="button" title="คู่มือการใช้งาน" aria-label="คู่มือการใช้งาน" className="rounded-xl p-2 text-slate-500 hover:bg-slate-50" onClick={()=>guide.current?.showModal()}><HelpCircle className="h-5 w-5"/></button></div></div>
  <nav aria-label="ส่วนการทำงานของกล่องข้อความ" className="flex flex-wrap gap-2">{INBOX_VIEWS.map(([key,label])=><button type="button" key={key} aria-current={view===key?'page':undefined} onClick={()=>onView(key)} className={view===key?'rounded-xl bg-orange-50 px-4 py-2.5 text-xs font-semibold text-orange-800':'rounded-xl px-4 py-2.5 text-xs text-slate-600 hover:bg-slate-50'}>{label}</button>)}<Link href="/chatbot/conversations" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs text-slate-600 hover:bg-slate-50"><Settings2 className="h-4 w-4"/>ตั้งค่า ผู้ช่วยอัจฉริยะ</Link></nav>
  <dialog ref={guide} aria-labelledby="inbox-guide-title" className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-900/40"><h2 id="inbox-guide-title" className="font-semibold">คู่มือดูแลแชท</h2><ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7"><li>เลือกกลุ่มแชทและเลือกลูกค้าที่ต้องการดูแล</li><li>ระบบอัตโนมัติจะหยุดทำงานทันทีเมื่อแอดมินกดรับช่วงดูแลแชท</li><li>ใช้ไอคอนใต้ช่องพิมพ์เพื่อแนบไฟล์ เลือกคำตอบที่บันทึกไว้ หรือให้ผู้ช่วยร่างข้อความ แล้วตรวจทานก่อนส่ง</li><li>ดูข้อมูลลูกค้า ออเดอร์ และสลิปในรายละเอียดด้านขวา ส่วนสถิติอยู่ที่หน้ารายงานทีม</li></ol><button type="button" className="mt-5 rounded-xl bg-orange-500 px-4 py-2.5 text-sm text-white" onClick={()=>guide.current?.close()}>ปิดคู่มือ</button></dialog>
 </header>
}
