'use client'

import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {MessageSquareText,Plus,X} from 'lucide-react'
import {apiError} from '@/lib/utils'

type SavedReply={id:string;body:string;shortcut?:string}
export function QuickRepliesMenu({tenantId,replies,disabled,onSelect,onOpen}:{tenantId:string;replies:string[];disabled:boolean;onSelect:(reply:string)=>boolean;onOpen:()=>void}) {
 const [open,setOpen]=useState(false),[stored,setStored]=useState<SavedReply[]>([])
 const [shortcut,setShortcut]=useState(''),[body,setBody]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false),[notice,setNotice]=useState('')
 const dialog=useRef<HTMLDialogElement>(null),shortcutInput=useRef<HTMLInputElement>(null)
 const pending=useRef<{body:string;shortcut:string;requestId:string}|null>(null),lock=useRef(false)
 function close(){if(lock.current)return;dialog.current?.close();setOpen(false)}
 useEffect(()=>{if(!open)return;const element=dialog.current;if(element&&!element.open)element.showModal();return()=>{element?.close()}},[open])
 useEffect(()=>{if(!open)return;const controller=new AbortController();setLoading(true);setError('')
  void fetch('/api/inbox/quick-replies?tenantId='+tenantId,{cache:'no-store',signal:controller.signal}).then(async res=>{if(!res.ok)throw new Error(await apiError(res));const result=await res.json();if(!controller.signal.aborted)setStored(previous=>{const rows=new Map<string,SavedReply>(result.replies.map((reply:SavedReply)=>[reply.id,reply]));for(const reply of previous)if(!rows.has(reply.id))rows.set(reply.id,reply);return [...rows.values()]})}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[open,tenantId])
 async function save(){if(lock.current||!body.trim()||!shortcut.trim())return
  lock.current=true;setSaving(true);setError('');setNotice('')
  const value=body.trim(),name=shortcut.trim()
  if(pending.current?.body!==value||pending.current?.shortcut!==name)pending.current={body:value,shortcut:name,requestId:crypto.randomUUID()}
  try{const res=await fetch('/api/inbox/quick-replies?tenantId='+tenantId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.current)});if(!res.ok)throw new Error(await apiError(res));const result=await res.json();setStored(previous=>[...previous.filter(reply=>reply.id!==result.reply.id),result.reply]);pending.current=null;setBody('');setShortcut('');setNotice('บันทึกแล้ว เลือกคำตอบจากรายการเพื่อแทรกลงในแชท')
  }catch(e){setError(e instanceof Error?e.message:'บันทึกคำตอบไม่ได้ กรุณาลองอีกครั้ง')}finally{lock.current=false;setSaving(false)}
 }
 const available:SavedReply[]=[...stored,...replies.filter(text=>!stored.some(reply=>reply.body===text)).map((text,index)=>({id:'rule-'+index,body:text,shortcut:''}))]
 return <div>
  <button type="button" aria-label="คำตอบด่วน" aria-expanded={open} aria-haspopup="dialog" title="การตอบกลับที่บันทึกไว้" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>{onOpen();setOpen(true)}} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-orange-600 transition hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-500 disabled:opacity-40"><MessageSquareText size={19} aria-hidden/></button>
  {open&&createPortal(<dialog ref={dialog} role="dialog" aria-label="การตอบกลับที่บันทึกไว้" aria-modal="true" onCancel={event=>{event.preventDefault();close()}} onClose={()=>setOpen(false)} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-4xl overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40">
   <div className="flex max-h-[90dvh] min-h-0 flex-col">
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7"><div><h2 className="text-lg font-semibold text-slate-900">การตอบกลับที่บันทึกไว้</h2><p className="mt-1 text-xs text-slate-500">เก็บข้อความที่ใช้บ่อย แล้วเลือกแทรกในแชทก่อนส่ง</p></div><button type="button" aria-label="ปิดการตอบกลับที่บันทึกไว้" onClick={close} disabled={saving} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X size={20}/></button></header>
    <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[16rem_minmax(0,1fr)]">
     <section aria-label="รายการคำตอบที่บันทึกไว้" className="border-b border-slate-100 bg-slate-50/60 p-4 md:border-b-0 md:border-r"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold text-slate-600">คำตอบของร้าน</h3><span className="text-xs text-slate-400">{available.length}</span></div>
      <button type="button" onClick={()=>{setBody('');setShortcut('');setNotice('');shortcutInput.current?.focus({preventScroll:true})}} disabled={saving} className="mb-3 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-xs font-medium text-orange-700 hover:bg-orange-50"><Plus size={14}/>เพิ่มคำตอบด่วนใหม่</button>
      {loading&&<p role="status" className="mb-2 text-xs text-slate-400">กำลังโหลด…</p>}
      {!loading&&!available.length&&<p className="rounded-xl border border-dashed border-slate-200 p-4 text-xs leading-6 text-slate-400">ร้านยังไม่มีคำตอบด่วน สร้างข้อความแรกได้ในฟอร์มนี้</p>}
      <ul className="max-h-40 space-y-1.5 overflow-y-auto md:max-h-[26rem]">{available.map(reply=><li key={reply.id}><button type="button" data-reply-body={reply.body} disabled={disabled||saving} onClick={()=>{if(onSelect(reply.body))close();else setError('ข้อความรวมยาวเกิน 2,000 ตัวอักษร กรุณาย่อข้อความในแชทก่อน')}} className="w-full rounded-xl border border-slate-100 bg-white px-3 py-3 text-left hover:border-orange-200 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-400 disabled:opacity-40">{reply.shortcut&&<span className="mb-1 block truncate text-xs font-semibold text-orange-700">{reply.shortcut}</span>}<span className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">{reply.body}</span></button></li>)}</ul>
     </section>
     <section aria-label="สร้างการตอบกลับที่บันทึกไว้" className="space-y-5 px-5 py-5 sm:px-7"><div><h3 className="text-sm font-semibold text-slate-800">สร้างการตอบกลับ</h3><p className="mt-1 text-xs text-slate-500">บันทึกไว้ให้ผู้ดูแลในร้านเลือกใช้ได้</p></div>
      <label className="block text-sm font-medium text-slate-700">ทางลัด<input ref={shortcutInput} aria-label="ทางลัด" maxLength={60} value={shortcut} disabled={saving} onChange={event=>setShortcut(event.target.value)} placeholder="เช่น ขอบคุณลูกค้า หรือ แจ้งเลขพัสดุ" className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-50"/><span className="mt-1 block text-[11px] font-normal text-slate-400">ตั้งชื่อสั้น ๆ เพื่อให้หาคำตอบเจอง่าย</span></label>
      <label className="block text-sm font-medium text-slate-700">ข้อความ<textarea aria-label="ข้อความคำตอบด่วนใหม่" rows={9} maxLength={2000} value={body} disabled={saving} onChange={event=>setBody(event.target.value)} placeholder="พิมพ์ข้อความที่ต้องการบันทึก…" className="mt-2 min-h-48 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm font-normal leading-6 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-50"/><span role="status" className="mt-1 block text-right text-xs font-normal tabular-nums text-slate-400">{body.length.toLocaleString()} / 2,000 ตัวอักษร</span></label>
      <p className="text-[11px] leading-5 text-slate-400">บันทึกเฉพาะข้อความ หากต้องการแนบรูปภาพ ให้เลือกจากแถบพิมพ์หลังแทรกคำตอบ</p>
      {error&&<p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      {notice&&<p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}
     </section>
    </div>
    <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4 sm:px-7"><button type="button" disabled={saving} onClick={close} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">ยกเลิก</button><button type="button" disabled={saving||!body.trim()||!shortcut.trim()} onClick={()=>void save()} className="rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-40">{saving?'กำลังบันทึก…':'บันทึก'}</button></footer>
   </div>
  </dialog>,document.body)}
 </div>
}
