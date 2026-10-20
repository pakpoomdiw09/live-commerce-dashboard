'use client'

import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {MessageSquareText,Plus,X,Trash2,Pencil,MoreHorizontal,Search,ArrowLeft} from 'lucide-react'
import {apiError} from '@/lib/utils'

type SavedReply={id:string;body:string;shortcut?:string}
const editHeading='แก้ไขการตอบกลับ'
const updateLabel='บันทึกการแก้ไข'
const confirmDelete='ต้องการลบคำตอบด่วนนี้หรือไม่?'
export function QuickRepliesMenu({tenantId,disabled,onSelect,onOpen}:{tenantId:string;disabled:boolean;onSelect:(reply:string)=>boolean;onOpen:()=>void}) {
 const [open,setOpen]=useState(false),[stored,setStored]=useState<SavedReply[]>([])
 const [shortcut,setShortcut]=useState(''),[body,setBody]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false),[notice,setNotice]=useState('')
 const dialog=useRef<HTMLDialogElement>(null),shortcutInput=useRef<HTMLInputElement>(null)
 const pending=useRef<{body:string;shortcut:string;requestId:string}|null>(null),lock=useRef(false)
 const [deleting,setDeleting]=useState<string|null>(null)
 const [editingId,setEditingId]=useState<string|null>(null)
 const [view,setView]=useState<'list'|'form'>('list')
 const [query,setQuery]=useState(''),[menuId,setMenuId]=useState<string|null>(null)
 const busy=saving||deleting!==null
 const menuTrigger=useRef<HTMLButtonElement|null>(null)
 function back(){if(lock.current)return;resetForm();setView('list');setError('');setMenuId(null)}
 function add(){if(lock.current)return;resetForm();setView('form');setError('');setNotice('');setMenuId(null)}
 function resetForm(){setEditingId(null);setBody('');setShortcut('');pending.current=null}
 function edit(reply:SavedReply){
  if(lock.current||loading)return
  setEditingId(reply.id);setBody(reply.body);setShortcut(reply.shortcut??'');setError('');setNotice('');pending.current=null
  setView('form');setMenuId(null)
 }
 async function remove(reply:SavedReply){
  if(lock.current||loading)return
  if(!window.confirm(confirmDelete))return
  setMenuId(null)
  lock.current=true;setDeleting(reply.id);setError('');setNotice('')
  try{
   const res=await fetch('/api/inbox/quick-replies?tenantId='+encodeURIComponent(tenantId)+'&id='+encodeURIComponent(reply.id),{method:'DELETE'})
   if(!res.ok)throw new Error(await apiError(res))
   setStored(previous=>previous.filter(item=>item.id!==reply.id))
   if(editingId===reply.id)resetForm()
   setNotice('ลบคำตอบด่วนแล้ว')
  }catch(e){setError(e instanceof Error?e.message:'ลบคำตอบด่วนไม่สำเร็จ กรุณาลองอีกครั้ง')}
  finally{lock.current=false;setDeleting(null)}
 }
 function close(){if(lock.current)return;dialog.current?.close();setOpen(false)}
 useEffect(()=>{if(!open)return;const element=dialog.current;if(element&&!element.open)element.showModal();return()=>{element?.close()}},[open])
 useEffect(()=>{if(open&&view==='form')shortcutInput.current?.focus()},[open,view])
 useEffect(()=>{
  if(!menuId)return
  const dismiss=(event:PointerEvent)=>{if(!(event.target instanceof Element)||!event.target.closest('[data-reply-actions]'))setMenuId(null)}
  document.addEventListener('pointerdown',dismiss)
  return()=>document.removeEventListener('pointerdown',dismiss)
 },[menuId])
 useEffect(()=>{if(!open)return;const controller=new AbortController();setLoading(true);setError('')
  void fetch('/api/inbox/quick-replies?tenantId='+tenantId,{cache:'no-store',signal:controller.signal}).then(async res=>{if(!res.ok)throw new Error(await apiError(res));const result=await res.json();if(!controller.signal.aborted)setStored(result.replies)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[open,tenantId])
 async function save(){if(lock.current||loading||!body.trim()||!shortcut.trim())return
  lock.current=true;setSaving(true);setError('');setNotice('')
  const value=body.trim(),name=shortcut.trim()
  if(pending.current?.body!==value||pending.current?.shortcut!==name)pending.current={body:value,shortcut:name,requestId:crypto.randomUUID()}
  try{const res=await fetch('/api/inbox/quick-replies?tenantId='+tenantId,{method:editingId?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(editingId?{id:editingId,body:value,shortcut:name}:pending.current)});if(!res.ok)throw new Error(await apiError(res));const result=await res.json();setStored(previous=>editingId?previous.map(reply=>reply.id===result.reply.id?result.reply:reply):[...previous.filter(reply=>reply.id!==result.reply.id),result.reply]);resetForm();setView('list');setQuery('');setNotice('บันทึกแล้ว เลือกคำตอบจากรายการเพื่อแทรกลงในแชท')
  }catch(e){setError(e instanceof Error?e.message:'บันทึกคำตอบไม่ได้ กรุณาลองอีกครั้ง')}finally{lock.current=false;setSaving(false)}
 }
 // Manual replies have one source: /api/inbox/quick-replies. Never merge bot rules.
 const available=stored
 const search=query.trim().toLocaleLowerCase()
 const filtered=available.filter(reply=>`${reply.shortcut??''} ${reply.body}`.toLocaleLowerCase().includes(search))
 return <div>
  <button type="button" aria-label="คำตอบด่วน" aria-expanded={open} aria-haspopup="dialog" title="การตอบกลับที่บันทึกไว้" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>{onOpen();resetForm();setView('list');setQuery('');setMenuId(null);setNotice('');setOpen(true)}} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-orange-600 transition hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-500 disabled:opacity-40"><MessageSquareText size={19} aria-hidden/></button>
  {open&&createPortal(<dialog ref={dialog} aria-label="การตอบกลับที่บันทึกไว้" onCancel={event=>{event.preventDefault();if(menuId){setMenuId(null);menuTrigger.current?.focus()}else close()}} onClose={()=>setOpen(false)} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-2xl overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40">
   <div className="flex max-h-[90dvh] flex-col">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-7">
     <div className="min-w-0"><h2 className="text-lg font-semibold text-slate-900">{view==='list'?'ข้อความตอบกลับที่บันทึกไว้':editingId?editHeading:'เพิ่มข้อความตอบกลับ'}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{view==='list'?'เลือกข้อความเพื่อแทรกในแชทก่อนส่ง':'ตั้งคีย์ลัดและบันทึกข้อความที่ใช้บ่อย'}</p></div>
     <div className="flex shrink-0 items-center gap-2">{view==='list'&&<button type="button" onClick={add} disabled={loading||busy} className="inline-flex items-center gap-1 rounded-xl bg-orange-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-40"><Plus size={16} aria-hidden/>เพิ่มใหม่</button>}<button type="button" aria-label="ปิดการตอบกลับที่บันทึกไว้" disabled={busy} onClick={close} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X size={20} aria-hidden/></button></div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
     {error&&<p role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
     {notice&&<p role="status" className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}
     {view==='list'?<section aria-label="รายการคำตอบที่บันทึกไว้">
      <div className="relative mb-4"><Search size={17} aria-hidden className="pointer-events-none absolute left-3 top-3 text-slate-400"/><input aria-label="ค้นหาคำตอบด่วน" value={query} onChange={event=>{setQuery(event.target.value);setMenuId(null)}} placeholder="ค้นหาจากข้อความหรือคีย์ลัด…" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-50"/></div>
      <p className="mb-3 text-xs text-slate-400">{filtered.length} รายการ</p>
      {loading&&<p role="status" className="py-6 text-center text-sm text-slate-400">กำลังโหลด…</p>}
      {!loading&&!filtered.length&&<div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">{search?'ไม่พบข้อความที่ตรงกับการค้นหา':'ยังไม่มีคำตอบด่วน กด “เพิ่มใหม่” เพื่อเริ่มต้น'}</div>}
      <ul className="space-y-3 pb-24">{filtered.map(reply=><li key={reply.id} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-2 transition hover:border-orange-200">
       <button type="button" data-reply-body={reply.body} disabled={disabled||busy} onClick={()=>{if(onSelect(reply.body))close();else setError('ข้อความรวมยาวเกิน 2,000 ตัวอักษร กรุณาย่อข้อความในแชทก่อน')}} className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-orange-400 disabled:opacity-40">{reply.shortcut&&<span className="mb-2 inline-block max-w-full truncate rounded-md bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700">{reply.shortcut}</span>}<span className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{reply.body}</span></button>
       {stored.some(item=>item.id===reply.id)&&<div data-reply-actions className="relative shrink-0">
        <button type="button" aria-label={`จัดการคำตอบ ${reply.shortcut||reply.body}`} aria-expanded={menuId===reply.id} aria-controls={menuId===reply.id?'saved-reply-actions':undefined} disabled={loading||busy} onClick={event=>{menuTrigger.current=event.currentTarget;setMenuId(current=>current===reply.id?null:reply.id)}} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-orange-500 disabled:opacity-40"><MoreHorizontal size={20} aria-hidden/></button>
        {menuId===reply.id&&<div id="saved-reply-actions" role="group" aria-label="จัดการคำตอบด่วน" className="absolute right-0 top-11 z-10 w-36 rounded-xl border border-slate-100 bg-white p-1 shadow-lg">
         <button type="button" onClick={()=>edit(reply)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-orange-500"><Pencil size={15} aria-hidden/>แก้ไข</button>
         <button type="button" onClick={()=>void remove(reply)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-rose-600 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-rose-500"><Trash2 size={15} aria-hidden/>ลบ</button>
        </div>}
       </div>}
      </li>)}</ul>
     </section>:<form id="saved-reply-form" onSubmit={event=>{event.preventDefault();void save()}} className="space-y-5">
      <label className="block text-sm font-medium text-slate-700">คีย์ลัด (Shortcut)<input ref={shortcutInput} required maxLength={60} value={shortcut} disabled={busy} onChange={event=>setShortcut(event.target.value)} placeholder="เช่น ขอบคุณลูกค้า หรือ แจ้งเลขพัสดุ" className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-50"/><span className="mt-1 block text-xs font-normal text-slate-400">ตั้งชื่อสั้น ๆ เพื่อให้ค้นหาได้ง่าย</span></label>
      <label className="block text-sm font-medium text-slate-700">ข้อความ<textarea required rows={8} maxLength={2000} value={body} disabled={busy} onChange={event=>setBody(event.target.value)} placeholder="พิมพ์ข้อความที่ต้องการบันทึก…" className="mt-2 min-h-48 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm font-normal leading-6 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-50"/><span className="mt-1 block text-right text-xs font-normal tabular-nums text-slate-400">{body.length.toLocaleString()} / 2,000 ตัวอักษร</span></label>
     </form>}
    </div>
    {view==='form'&&<footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 sm:px-7"><button type="button" disabled={busy} onClick={back} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ArrowLeft size={16} aria-hidden/>ย้อนกลับ</button><button type="submit" form="saved-reply-form" disabled={loading||busy||!body.trim()||!shortcut.trim()} className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-40">{saving?'กำลังบันทึก…':editingId?updateLabel:'บันทึก'}</button></footer>}
   </div>
  </dialog>,document.body)}
 </div>
}
