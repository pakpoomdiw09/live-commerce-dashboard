'use client'
import {useEffect,useRef,useState} from 'react'
import {Pencil,Plus,Save,ScrollText,Trash2,X} from 'lucide-react'
import {STORE_RULES_MAX_LENGTH} from '@/lib/features/store-rules/shop-persona-settings'
import {parseStoreRules,validateStoreRules,readStoreRuleItems,serializeStoreRuleItems,STORE_RULE_CATEGORIES,type StoreRuleItem,type StoreRuleCategory} from '@/lib/features/store-rules/store-rule-items'
import {StoreRulesRecovery} from '@/components/chatbot/StoreRulesRecovery'
import {StoreRulesErrorBoundary} from '@/components/chatbot/StoreRulesErrorBoundary'

type RuleEditor=StoreRuleItem&{previousBody?:string;previousCategory?:StoreRuleCategory;previousEnabled?:boolean}
type RuleChange={id:string;body?:string;category?:StoreRuleCategory;enabled?:boolean;previousBody?:string;previousCategory?:StoreRuleCategory;previousEnabled?:boolean}
const previous=(item:StoreRuleItem)=>({previousBody:item.body,previousCategory:item.category??'general',previousEnabled:item.enabled!==false})
type Props={tenantId:string;initial:string;onSaved:()=>Promise<void>;disabled:boolean}
export function StoreRulesSettings(props:Props){
 const state=parseStoreRules(props.initial)
 const recovery=<StoreRulesRecovery key={props.tenantId} {...props} issues={state.ok?[{path:'$',code:'RENDER_ERROR',message:'แสดงผลกฎไม่สำเร็จ กรุณาโหลดข้อมูลใหม่หรือสำรองข้อมูลก่อนแก้ไข'}]:state.issues}/>
 if(!state.ok)return recovery
 return <StoreRulesErrorBoundary resetKey={props.tenantId+'\0'+props.initial} fallback={recovery}><StoreRulesTable key={props.tenantId} {...props}/></StoreRulesErrorBoundary>
}
function StoreRulesTable({tenantId,initial,onSaved,disabled}:Props){
 const [items,setItems]=useState(()=>readStoreRuleItems(initial)),[editor,setEditor]=useState<RuleEditor|null>(null)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[deleting,setDeleting]=useState<StoreRuleItem|null>(null)
 const lock=useRef(false),dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{if(deleting&&!dialog.current?.open)dialog.current?.showModal()},[deleting])
 useEffect(()=>{setItems(readStoreRuleItems(initial))},[initial])
 async function mutate(method:'POST'|'PATCH'|'DELETE',value:RuleChange){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('')
  try{
   const response=await fetch(`/api/agent-control/rules?tenantId=${encodeURIComponent(tenantId)}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),data=await response.json()
   if(!response.ok)throw Error(data.error??'บันทึกกฎไม่สำเร็จ')
   if(typeof data.instructions!=='string')throw Error('ข้อมูลกฎที่ได้รับไม่สมบูรณ์ กรุณาโหลดข้อมูลใหม่')
   const saved=validateStoreRules(data.instructions)
   setItems(saved.items);setEditor(null);setDeleting(null);setMessage(method==='DELETE'?'ลบกฎแล้ว':'บันทึกกฎแล้ว')
   try{await onSaved()}catch{setMessage('บันทึกสำเร็จแล้ว แต่ยังโหลดข้อมูลส่วนอื่นไม่ได้ กรุณาอัปเดตข้อมูลอีกครั้ง')}
  }catch(error){setError(error instanceof Error?error.message:'ดำเนินการไม่สำเร็จ')}
  finally{lock.current=false;setBusy(false)}
 }
 function edit(item:StoreRuleItem){if(editor||disabled||busy)return;setEditor({...item,category:item.category??'general',enabled:item.enabled!==false,...previous(item)});setError('');setMessage('')}
 const isNew=!!editor&&!items.some(item=>item.id===editor.id)
 const rows=isNew?[...items,editor!]:items
 const prospective=editor?rows.map(item=>item.id===editor.id?{id:editor.id,body:editor.body,category:editor.category??'general',enabled:editor.enabled!==false}:item):items
 const length=serializeStoreRuleItems(prospective).length,overLimit=length>STORE_RULES_MAX_LENGTH
 const button='inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition disabled:opacity-50'
 return <section aria-labelledby="store-rules-title" aria-busy={busy} className="min-w-0 space-y-5 rounded-3xl border border-orange-100 bg-white p-4 shadow-sm md:p-6">
  <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="rounded-2xl bg-orange-50 p-3 text-orange-600"><ScrollText aria-hidden="true" className="h-5 w-5"/></span><div><h2 id="store-rules-title" className="text-lg font-bold">กฎของทางร้าน</h2><p className="mt-1 text-sm leading-6 text-slate-500">จัดหมวดหมู่และเปิดใช้เฉพาะกฎที่ต้องการให้ผู้ช่วยนำไปตอบลูกค้า</p></div></div><button type="button" disabled={disabled||busy||!!editor||items.length>=200} className={`${button} bg-orange-500 text-white hover:bg-orange-600`} onClick={()=>{setEditor({id:crypto.randomUUID(),body:'',category:'general',enabled:true});setError('');setMessage('')}}><Plus className="h-4 w-4"/>เพิ่มกฎข้อใหม่</button></div>
  {message&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
  {error&&<div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><p>{error}</p><button type="button" disabled={busy} className={`${button} mt-2 border border-rose-200`} onClick={()=>{void onSaved().catch(()=>setError('โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง'))}}>โหลดข้อมูลใหม่</button></div>}
  <div role="region" aria-label="ตารางกฎของทางร้าน" tabIndex={0} className="overflow-x-auto rounded-2xl border border-slate-200 focus-visible:outline-2 focus-visible:outline-orange-400">
   <table className="w-full min-w-[980px] table-fixed text-left text-sm"><caption className="sr-only">กฎของทางร้าน แก้ไขรายละเอียดในแถวแล้วบันทึก หมวดหมู่และสวิตช์บันทึกทันทีเมื่อไม่ได้แก้ไขข้อความ</caption><colgroup><col className="w-16"/><col className="w-48"/><col/><col className="w-40"/><col className="w-44"/></colgroup>
    <thead className="bg-orange-50 text-xs text-slate-600"><tr>{['ลำดับ','หัวข้อ/ประเภท','รายละเอียดกฎ','สถานะ (เปิด/ปิดใช้งาน)','จัดการ (แก้ไข/ลบ)'].map(label=><th key={label} scope="col" className="px-4 py-4 font-semibold">{label}</th>)}</tr></thead>
    <tbody className="divide-y divide-slate-100">{rows.map((item,index)=>{
     const active=editor?.id===item.id,draft=active?editor!:item,rowDisabled=disabled||busy||!!editor&&!active,enabled=draft.enabled!==false
     return <tr key={item.id} className={active?'bg-orange-50/40':enabled?'bg-white hover:bg-slate-50/40':'bg-slate-50/80'}>
      <td className="px-4 py-5 align-top font-medium tabular-nums text-slate-500">{index+1}</td>
      <td className="px-3 py-4 align-top"><select aria-label={`ประเภทกฎข้อ ${index+1}`} disabled={rowDisabled} value={draft.category??'general'} onChange={event=>{const category=event.target.value as StoreRuleCategory;if(active)setEditor({...editor!,category});else void mutate('PATCH',{id:item.id,category,...previous(item)})}} className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-xs outline-none focus:border-orange-400 disabled:opacity-60">{Object.entries(STORE_RULE_CATEGORIES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></td>
      <td className="px-3 py-3 align-top"><textarea id={active?'store-rule-editor':undefined} aria-label={isNew&&active?'รายละเอียดกฎข้อใหม่':`รายละเอียดกฎข้อ ${index+1}`} autoFocus={isNew&&active} rows={3} maxLength={STORE_RULES_MAX_LENGTH} readOnly={!active} disabled={rowDisabled} value={draft.body} onFocus={()=>{if(!active)edit(item)}} onChange={event=>{if(active)setEditor({...editor!,body:event.target.value})}} placeholder="พิมพ์กฎ เช่น ตัดรอบส่งสินค้าเวลา 15:00 น." className={`w-full resize-y whitespace-pre-wrap break-words rounded-xl border p-3 text-sm leading-6 outline-none disabled:opacity-60 ${active?'border-orange-300 bg-white ring-2 ring-orange-100':'border-transparent bg-transparent focus:border-orange-300'}`}/>{active&&<p className="mt-1 text-xs text-orange-700">แก้ไขแล้วกดบันทึกในแถวนี้</p>}</td>
      <td className="px-4 py-5 align-top"><button type="button" role="switch" aria-label={`เปิดใช้กฎข้อ ${index+1}`} aria-checked={enabled} disabled={rowDisabled} onClick={()=>{if(active)setEditor({...editor!,enabled:!enabled});else void mutate('PATCH',{id:item.id,enabled:!enabled,...previous(item)})}} className={`inline-flex h-6 w-11 items-center rounded-full p-0.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-50 ${enabled?'bg-orange-500':'bg-slate-300'}`}><span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled?'translate-x-5':'translate-x-0'}`}/></button><p className={`mt-2 text-xs ${enabled?'text-orange-700':'text-slate-500'}`}>{enabled?'เปิดใช้งาน':'ปิดใช้งาน'}</p></td>
      <td className="px-3 py-4 align-top"><div className="flex flex-wrap gap-1">{active?<><button type="button" disabled={disabled||busy||!editor!.body.trim()||overLimit} onClick={()=>void mutate(isNew?'POST':'PATCH',editor!)} className={`${button} bg-orange-500 text-white`}><Save className="h-4 w-4"/>{busy?'กำลังบันทึก…':'บันทึกกฎข้อนี้'}</button><button type="button" disabled={busy} onClick={()=>setEditor(null)} className={`${button} text-slate-500`}><X className="h-4 w-4"/>ยกเลิก</button></>:<><button type="button" aria-label={`แก้ไขกฎข้อ ${index+1}`} disabled={rowDisabled} onClick={()=>edit(item)} className={`${button} text-slate-600 hover:bg-orange-50`}><Pencil className="h-4 w-4"/>แก้ไข</button><button type="button" aria-label={`ลบกฎข้อ ${index+1}`} disabled={rowDisabled} className={`${button} text-rose-600 hover:bg-rose-50`} onClick={()=>{setDeleting(item);setError('')}}><Trash2 className="h-4 w-4"/>ลบ</button></>}</div></td>
     </tr>
    })}{!rows.length&&<tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">ยังไม่มีกฎ กด “เพิ่มกฎข้อใหม่” เพื่อแทรกแถวแรก</td></tr>}</tbody>
   </table>
  </div>
  <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-400"><p role={overLimit?'alert':undefined} className={overLimit?'text-rose-600':''}>{items.length} / 200 ข้อ · รวมข้อมูลจัดเก็บ {length.toLocaleString('th-TH')} / 50,000 ตัวอักษร</p><p>หน้าจอเล็กสามารถเลื่อนตารางไปทางซ้าย–ขวาได้</p></div>
  {deleting&&<dialog ref={dialog} role="alertdialog" aria-labelledby="delete-store-rule" onCancel={event=>{event.preventDefault();if(!busy)setDeleting(null)}} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 backdrop:bg-slate-900/30"><h3 id="delete-store-rule" className="font-semibold">ลบกฎข้อนี้หรือไม่?</h3><p className="mt-2 text-sm text-slate-500">ผู้ช่วยจะไม่นำกฎข้อนี้ไปใช้ในคำตอบครั้งถัดไป</p>{error&&<p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button autoFocus type="button" disabled={busy} className={`${button} border border-slate-200`} onClick={()=>setDeleting(null)}>ยกเลิก</button><button type="button" disabled={busy} className={`${button} bg-rose-600 text-white`} onClick={()=>void mutate('DELETE',{id:deleting.id,...previous(deleting)})}>{busy?'กำลังลบ…':'ยืนยันลบ'}</button></div></dialog>}
 </section>
}
