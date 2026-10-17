'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import {Paperclip,SendHorizontal,Sparkles,Smile,Lock,X} from 'lucide-react'
import {QuickRepliesMenu} from './QuickRepliesMenu'
import {Button} from '@/components/ui/button'
import {apiError} from '@/lib/utils'
import type {InboxMedia,InboxState} from '@/lib/inbox-types'

export function ReplyBox({customerId,tenantId,inbox,enabled,onSent}:{customerId:string;tenantId:string;inbox:InboxState|null;enabled:boolean;onSent:()=>void}){
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[drafting,setDrafting]=useState(false),[uploading,setUploading]=useState(false)
 const [media,setMedia]=useState<InboxMedia|null>(null),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false)
 const clientId=useRef<string|null>(null),fileInput=useRef<HTMLInputElement>(null)
 const textInput=useRef<HTMLTextAreaElement>(null),emojiPanel=useRef<HTMLDivElement>(null)
 const [emojiOpen,setEmojiOpen]=useState(false)
 function focusComposer(){setEmojiOpen(false);textInput.current?.focus({preventScroll:true})}
 useEffect(()=>{const input=textInput.current;if(input){input.style.height='auto';input.style.height=Math.min(160,Math.max(44,input.scrollHeight))+'px'}},[text])
 useEffect(()=>{if(!emojiOpen)return;const close=(event:PointerEvent)=>{if(!emojiPanel.current?.contains(event.target as Node))setEmojiOpen(false)};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setEmojiOpen(false);emojiPanel.current?.querySelector('button')?.focus()}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape)}},[emojiOpen])
 const sending=useRef(false),draftingRequest=useRef(false)
 function edit(value:string){setText(value);clientId.current=null;setUncertain(false)}
 function insertReply(reply:string){
  const input=textInput.current,start=input?.selectionStart??text.length,end=input?.selectionEnd??start
  const next=text.slice(0,start)+reply+text.slice(end)
  if(next.length>2000){setError('ข้อความรวมยาวเกิน 2,000 ตัวอักษร กรุณาย่อข้อความก่อนเพิ่มคำตอบด่วน');return false}
  setError('');edit(next);setEmojiOpen(false)
  requestAnimationFrame(()=>{input?.focus({preventScroll:true});input?.setSelectionRange(start+reply.length,start+reply.length)})
  return true
 }
 async function upload(file:File){
  setUploading(true);setError('')
  try{const form=new FormData();form.set('file',file);const res=await fetch(`/api/inbox/media?tenantId=${tenantId}`,{method:'POST',body:form});if(!res.ok)throw new Error(await apiError(res));setMedia(await res.json());clientId.current=null;setUncertain(false)}catch(e){setError(e instanceof Error?e.message:'อัปโหลดไม่สำเร็จ')}finally{setUploading(false);if(fileInput.current)fileInput.current.value=''}
 }
 async function draft(){
  if(draftingRequest.current)return;draftingRequest.current=true;setDrafting(true);setError('')
  try{const res=await fetch(`/api/inbox/conversations/${customerId}/draft`,{method:'POST'});if(!res.ok)throw new Error(await apiError(res));edit((await res.json()).draft)}catch(e){setError(e instanceof Error?e.message:"ผู้ช่วยร่างข้อความไม่ได้")}finally{draftingRequest.current=false;setDrafting(false)}
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
 const tool='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-orange-600 transition hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-500 disabled:opacity-40 disabled:hover:bg-transparent'
 const toolDisabled=!enabled||busy||drafting
 return <form className="border-t border-slate-100 bg-white shrink-0 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4" onSubmit={e=>{e.preventDefault();void send()}}>
  {enabled&&inbox?.autoClaimOnReply&&<p className="mb-2 text-xs text-slate-500">ส่งข้อความเพื่อรับช่วงดูแลแชทนี้</p>}
  {!enabled&&<p className="mb-2 rounded-xl bg-orange-50 px-3 py-2 text-xs text-orange-800">รับช่วงดูแลหรือเปิดแชทก่อนตอบลูกค้า</p>}
  {error&&<p role="alert" className="mb-2 rounded-xl bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
  {media&&<div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-orange-50 px-3 py-2 text-xs"><span className="truncate">{media.name} · ส่งแยกจากข้อความ</span><button type="button" aria-label="นำไฟล์ออก" disabled={busy} onClick={()=>{setMedia(null);clientId.current=null;setUncertain(false)}} className="rounded-full p-1 hover:bg-orange-100"><X size={16}/></button></div>}
  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-2 focus-within:border-orange-300 focus-within:ring-2 focus-within:ring-orange-50">
   <textarea ref={textInput} rows={1} maxLength={2000} value={text} disabled={toolDisabled} onChange={e=>edit(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}} placeholder="พิมพ์ข้อความตอบลูกค้า…" aria-label="ข้อความตอบกลับ" className="block max-h-40 min-h-11 w-full resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-sm leading-6 outline-none disabled:opacity-50"/>
   <div className="flex min-w-0 items-center justify-between gap-2">
    <div role="toolbar" aria-label="เครื่องมือข้อความ" className="flex min-w-0 items-center gap-0.5">
     <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" className="hidden" aria-label="แนบรูปภาพหรือ เอกสาร" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file)}}/>
     <button type="button" aria-label="แนบรูปภาพหรือไฟล์" title={uploading?'กำลังอัปโหลด…':"แนบรูปภาพหรือ เอกสาร"} className={tool} disabled={toolDisabled||uploading} onClick={()=>fileInput.current?.click()}><Paperclip aria-hidden size={19}/></button>
     <QuickRepliesMenu tenantId={tenantId} replies={inbox?.quickReplies??[]} disabled={toolDisabled} onSelect={insertReply} onOpen={()=>setEmojiOpen(false)}/>
     <div ref={emojiPanel} className="relative"><button type="button" aria-label="เลือกอีโมจิ" aria-expanded={emojiOpen} title="อีโมจิ" disabled={toolDisabled} className={tool} onClick={()=>setEmojiOpen(open=>!open)}><Smile aria-hidden size={19}/></button>{emojiOpen&&<div role="group" aria-label="อีโมจิ" className="absolute bottom-full left-0 z-20 mb-2 flex max-w-[calc(100vw-3rem)] gap-1 rounded-2xl border border-slate-100 bg-white p-2 shadow-lg">{['😊','🙏','❤️','👍','🎉','📦'].map(emoji=><button key={emoji} type="button" aria-label={emoji} className="rounded-lg p-1.5 text-lg hover:bg-orange-50" disabled={toolDisabled} onClick={()=>{edit(text+emoji);focusComposer()}}>{emoji}</button>)}</div>}</div>
     {inbox?.aiAllowed?<button type="button" className={tool} aria-label="ผู้ช่วยร่างข้อความ" title={drafting?"กำลังร่างข้อความ…":"ผู้ช่วยร่างคำตอบ"} disabled={toolDisabled} onClick={()=>{focusComposer();void draft()}}><Sparkles aria-hidden size={19}/></button>:<Link href="/billing" aria-label="เปลี่ยนแพ็กเกจเพื่อใช้ผู้ช่วยอัจฉริยะ" title="เปลี่ยนแพ็กเกจเพื่อใช้ผู้ช่วยร่างข้อความ" className={tool}><Lock aria-hidden size={17}/></Link>}
    </div>
    <Button type="submit" aria-label="ส่งข้อความ" loading={busy} disabled={!enabled||uploading||drafting||uncertain||(!media&&!text.trim())} className="h-10 shrink-0 rounded-full bg-orange-500 px-3 text-white hover:bg-orange-600"><SendHorizontal aria-hidden size={18}/><span className="hidden sm:inline">ส่ง</span></Button>
   </div>
  </div>
  <p className="mt-1.5 px-1 text-[10px] text-slate-400">ตรวจทานข้อความก่อนส่งทุกครั้ง</p>
 </form>
}
