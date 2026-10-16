'use client'
import {useRef,useState} from 'react'
import Link from 'next/link'
import {Paperclip,SendHorizontal,Sparkles,Smile,Lock,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {apiError} from '@/lib/utils'
import type {InboxMedia,InboxState} from '@/lib/inbox-types'

export function ReplyBox({customerId,tenantId,inbox,enabled,onSent}:{customerId:string;tenantId:string;inbox:InboxState|null;enabled:boolean;onSent:()=>void}){
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[drafting,setDrafting]=useState(false),[uploading,setUploading]=useState(false)
 const [media,setMedia]=useState<InboxMedia|null>(null),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false)
 const clientId=useRef<string|null>(null),fileInput=useRef<HTMLInputElement>(null)
 const sending=useRef(false),draftingRequest=useRef(false)
 function edit(value:string){setText(value);clientId.current=null;setUncertain(false)}
 async function upload(file:File){
  setUploading(true);setError('')
  try{const form=new FormData();form.set('file',file);const res=await fetch(`/api/inbox/media?tenantId=${tenantId}`,{method:'POST',body:form});if(!res.ok)throw new Error(await apiError(res));setMedia(await res.json());clientId.current=null;setUncertain(false)}catch(e){setError(e instanceof Error?e.message:'อัปโหลดไม่สำเร็จ')}finally{setUploading(false);if(fileInput.current)fileInput.current.value=''}
 }
 async function draft(){
  if(draftingRequest.current)return;draftingRequest.current=true;setDrafting(true);setError('')
  try{const res=await fetch(`/api/inbox/conversations/${customerId}/draft`,{method:'POST'});if(!res.ok)throw new Error(await apiError(res));edit((await res.json()).draft)}catch(e){setError(e instanceof Error?e.message:'AI ช่วยร่างไม่ได้')}finally{draftingRequest.current=false;setDrafting(false)}
 }
 async function send(){
  if(sending.current||!enabled||uncertain||(!media&&!text.trim()))return
  sending.current=true
  setBusy(true);setError('');clientId.current??=crypto.randomUUID()
  try{
   const res=await fetch('/api/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerId,clientId:clientId.current,...(media?{mediaId:media.id}:{text:text.trim()})})})
   const result=await res.json()
   if(!res.ok){if(['SEND_UNKNOWN','SEND_ALREADY_CLAIMED'].includes(result.code))setUncertain(true);throw new Error(result.error||'ส่งไม่สำเร็จ')}
   if(media)setMedia(null);else setText('');clientId.current=null;onSent()
  }catch(e){setError(e instanceof Error?e.message:'การเชื่อมต่อขัดข้อง ลองคำขอเดิมอีกครั้งได้ ระบบจะไม่ส่งซ้ำ')}
  finally{sending.current=false;setBusy(false)}
 }
 const tool='inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-orange-50 disabled:opacity-40'
 return <form className="border-t border-orange-100 bg-white p-3" onSubmit={e=>{e.preventDefault();void send()}}>
  {enabled&&inbox?.autoClaimOnReply&&<p className="mb-2 text-xs text-slate-600">เมื่อกดส่ง ระบบจะรับแชทให้คุณและหยุดบอทก่อนส่งข้อความ</p>}
  {!enabled&&<p className="mb-2 rounded-lg bg-orange-50 p-2 text-xs text-orange-800">รับแชทหรือให้ผู้ดูแลโอนแชทให้คุณก่อนตอบ และเปิดแชทหากปิดอยู่</p>}
  {error&&<p role="alert" className="mb-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
  <div className="mb-2 flex flex-wrap items-center gap-1">
   <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" className="hidden" aria-label="แนบรูปภาพหรือ PDF" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file)}}/>
   <button type="button" className={tool} disabled={!enabled||busy||uploading} onClick={()=>fileInput.current?.click()}><Paperclip size={15}/>{uploading?'กำลังอัปโหลด…':'รูป / PDF'}</button>
   <select aria-label="คำตอบด่วน" value="" disabled={!enabled||busy||drafting} className="max-w-40 rounded-lg bg-slate-50 p-1.5 text-xs" onChange={e=>edit(e.target.value)}><option value="">คำตอบด่วนจากกฎร้าน</option>{inbox?.quickReplies.map((reply,i)=><option key={i} value={reply}>{reply.slice(0,45)}</option>)}</select>
   <details className="relative"><summary className={`${tool} cursor-pointer list-none`}><Smile size={15}/>อีโมจิ</summary><div className="absolute bottom-full left-0 z-10 mb-2 flex rounded-xl bg-white p-2 shadow-lg ring-1 ring-orange-100">{['😊','🙏','❤️','👍','🎉','📦'].map(emoji=><button key={emoji} type="button" className="p-1" disabled={!enabled||busy||drafting} onClick={()=>edit(text+emoji)}>{emoji}</button>)}</div></details>
   {inbox?.aiAllowed?<button type="button" className={`${tool} text-orange-700`} disabled={!enabled||busy||drafting} onClick={()=>void draft()}><Sparkles size={15}/>{drafting?'AI กำลังร่าง…':'AI ช่วยร่าง'}</button>:<Link href="/billing" className={`${tool} text-orange-700`}><Lock size={14}/>อัปเกรดเพื่อใช้ AI</Link>}
  </div>
  {media&&<div className="mb-2 flex items-center justify-between rounded-lg bg-orange-50 p-2 text-xs"><span className="truncate">{media.name} · ส่งไฟล์แยกจากข้อความ</span><button type="button" aria-label="นำไฟล์ออก" disabled={busy} onClick={()=>{setMedia(null);clientId.current=null;setUncertain(false)}}><X size={16}/></button></div>}
  <div className="flex items-end gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200 focus-within:ring-orange-400">
   <textarea rows={2} maxLength={2000} value={text} disabled={!enabled||busy||drafting} onChange={e=>edit(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}} placeholder="พิมพ์ตอบลูกค้า · Enter ส่ง / Shift+Enter ขึ้นบรรทัดใหม่" aria-label="ข้อความตอบกลับ" className="min-w-0 flex-1 resize-none bg-transparent p-1.5 text-sm outline-none disabled:opacity-50"/>
   <Button type="submit" loading={busy} disabled={!enabled||uploading||drafting||uncertain||(!media&&!text.trim())} className="bg-orange-500 text-white hover:bg-orange-600"><SendHorizontal size={16}/>ส่ง</Button>
  </div><p className="mt-1 text-[10px] text-slate-400">AI ร่างให้ตรวจทานก่อนส่ง · Messenger อนุญาตตอบภายใน 24 ชั่วโมงหลังลูกค้าส่งข้อความ</p>
 </form>
}
