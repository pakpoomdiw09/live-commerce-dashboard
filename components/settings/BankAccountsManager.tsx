'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { findBank, isSupportedBank } from '@/lib/features/banking/banks'
import { bankAccountError, formatBankAccount, type BankAccount } from '@/lib/features/banking/bank-accounts'
import { BankLogo } from '@/components/banking/BankLogo'
import { BankSelector } from '@/components/banking/BankSelector'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Notice, Field } from '@/components/ui/field'
import { QRCodeSVG } from 'qrcode.react'
import { Switch } from '@/components/ui/Switch'

const blank={bank_code:'KBANK',account_name:'',account_number:'',is_active:true}
const input='w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100'
export function BankAccountsManager({tenantId,canManage,onSelectQr}:{tenantId:string;canManage:boolean;onSelectQr?:(account:BankAccount)=>void}){
 const router=useRouter()
 const locked=useRef(false)
 const [audit,setAudit]=useState<{id:string;action:string;last_four:string;created_at:string}[]>([])
 const [qrId,setQrId]=useState('')
 const endpoint=`/api/bank-accounts?tenantId=${encodeURIComponent(tenantId)}`
 async function reload(){const r=await fetch(endpoint,{cache:'no-store'}),v=await r.json();if(!r.ok)throw Error(v.error??'โหลดบัญชีไม่ได้ ตรวจสอบ slip-bank-controls.sql');setAccounts(v.accounts);setAudit(v.audit??[])}
 const [accounts,setAccounts]=useState<BankAccount[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
 const [editing,setEditing]=useState<string|null>(null),[draft,setDraft]=useState(blank)
 const [notice,setNotice]=useState<{tone:'success'|'error';text:string}|null>(null)
 useEffect(()=>{const abort=new AbortController();setLoading(true);fetch(endpoint,{cache:'no-store',signal:abort.signal}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error??'โหลดบัญชีไม่ได้');if(!abort.signal.aborted){setAccounts(v.accounts);setAudit(v.audit??[])}}).catch(e=>{if(!abort.signal.aborted)setNotice({tone:'error',text:e.message})}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});return()=>abort.abort()},[endpoint])
 const open=(account?:BankAccount)=>{setEditing(account?.id??'new');setDraft(account?{bank_code:account.bank_code,account_name:account.account_name,account_number:account.account_number,is_active:account.is_active}:{...blank});setNotice(null)}
 async function save(){
  if(!canManage||locked.current||!editing)return
  const error=bankAccountError(draft.bank_code,draft.account_name,draft.account_number)
  if(error)return setNotice({tone:'error',text:error})
  if(!confirm('ยืนยันบันทึกบัญชีรับเงิน? การเปลี่ยนนี้มีผลต่อการตรวจสลิปและบัญชีที่แสดงให้ลูกค้า'))return
  locked.current=true;setBusy(true);setNotice(null)
  try{
   const row={...draft,account_name:draft.account_name.trim(),account_number:draft.account_number.replace(/[\s-]/g,'')}
   const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...row,action:'save',id:editing==='new'?null:editing,confirmed:true})}),v=await r.json()
   if(!r.ok)throw Error(v.error??'บันทึกบัญชีไม่ได้')
   await reload();setEditing(null);setNotice({tone:'success',text:editing==='new'?'เพิ่มบัญชีรับเงินแล้ว':'แก้ไขบัญชีรับเงินแล้ว'});router.refresh()
  }catch(e){setNotice({tone:'error',text:e instanceof Error?e.message:'บันทึกไม่ได้'})}finally{locked.current=false;setBusy(false)}
 }
 async function change(account:BankAccount,remove=false,primary=false){
  if(!canManage||locked.current||!confirm(primary?'ยืนยันใช้บัญชีนี้เป็นบัญชีหลักที่แสดงให้ลูกค้า?':remove?'ยืนยันลบบัญชีรับเงินนี้?':'ยืนยันเปลี่ยนสถานะบัญชีสำหรับตรวจสลิป?'))return
  locked.current=true;setBusy(true);setNotice(null)
  try{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:primary?'primary':remove?'delete':'toggle',id:account.id,confirmed:true})}),v=await r.json();if(!r.ok)throw Error(v.error??'บันทึกไม่ได้');await reload();setNotice({tone:'success',text:'บันทึกบัญชีรับเงินแล้ว'});router.refresh()}catch(e){setNotice({tone:'error',text:e instanceof Error?e.message:'บันทึกไม่ได้'})}finally{locked.current=false;setBusy(false)}
 }
 return <Card><CardHeader title="บัญชีรับเงินที่เพิ่มไว้" description="เพิ่มบัญชีรับเงินได้เฉพาะธนาคารที่ระบบตรวจสอบสลิปรองรับ" action={canManage&&<Button size="sm" className="bg-orange-500 hover:bg-orange-600" onClick={()=>open()} disabled={busy||loading||!!editing}><Plus className="h-4 w-4"/>เพิ่มบัญชีรับเงิน</Button>}/><div className="space-y-4 p-5" onKeyDown={event=>{if(!event.defaultPrevented&&editing&&event.key==='Enter'&&event.target instanceof HTMLElement&&event.target.getAttribute('role')!=='combobox'&&event.target instanceof HTMLInputElement&&event.target.type!=='radio'){event.preventDefault();void save()}}}>
 {notice&&<Notice tone={notice.tone}>{notice.text}</Notice>}
 {loading?<p className="text-sm text-slate-500">กำลังโหลดบัญชี…</p>:accounts.length===0?<p className="text-sm text-slate-500">ยังไม่มีบัญชีรับเงิน กดเพิ่มบัญชีเพื่อเริ่มใช้งาน</p>:<div className="grid gap-3 md:grid-cols-2">{accounts.map(account=><div key={account.id} className={`rounded-xl border p-4 ${account.is_active?'border-orange-200 bg-orange-50/40':'border-slate-200 bg-slate-50'}`}><div className="flex items-center gap-3"><BankLogo code={account.bank_code} size="lg" className="h-14 w-14"/><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{findBank(account.bank_code)?.name}</p>{!isSupportedBank(account.bank_code)&&<p className="mt-1 text-xs text-amber-700">ตรวจสลิปอัตโนมัติ: ยังไม่รองรับ · ให้แอดมินตรวจสอบ</p>}<p className="truncate text-sm text-slate-600">{account.account_name}</p></div><Switch checked={account.is_active} disabled={!canManage||busy||!!editing||(!account.is_active&&!isSupportedBank(account.bank_code))} label={`${account.is_active?'ปิด':'เปิด'}บัญชี ${account.account_name}`} onChange={()=>void change(account)}/></div><p className="mt-3 font-mono text-base text-slate-900">{canManage?formatBankAccount(account.account_number,account.bank_code):account.account_number}</p>{canManage&&<button className="mt-2 text-xs text-orange-700 underline" onClick={()=>void navigator.clipboard.writeText(account.account_number).then(()=>setNotice({tone:"success",text:"คัดลอกเลขบัญชีแล้ว"})).catch(()=>setNotice({tone:"error",text:"คัดลอกไม่ได้"}))}>คัดลอกเลขบัญชี</button>}{onSelectQr&&account.is_active&&account.bank_code==='PROMPTPAY'&&<Button size="sm" variant="secondary" onClick={()=>onSelectQr(account)}>ตกแต่ง QR / อัปเดตรูป</Button>}<div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className={`text-xs ${account.is_active?'text-orange-700':'text-slate-500'}`}>{account.is_primary?'บัญชีหลัก · แสดงให้ลูกค้า':account.is_active?'ใช้ตรวจสลิป':'ปิดใช้งาน'}</span>{canManage&&<div className="flex flex-wrap gap-2">{account.is_active&&!account.is_primary&&isSupportedBank(account.bank_code)&&<Button size="sm" variant="secondary" disabled={busy||!!editing} onClick={()=>void change(account,false,true)}>{"ใช้เป็นบัญชีหลัก"}</Button>}<Button size="sm" variant="secondary" disabled={busy||!!editing} onClick={()=>open(account)}><Pencil className="h-3.5 w-3.5"/>แก้ไข</Button><Button size="sm" variant="ghost" className="text-rose-600" disabled={busy||!!editing} onClick={()=>void change(account,true)} aria-label={`ลบบัญชี ${account.account_name}`}><Trash2 className="h-4 w-4"/></Button></div>}</div>{canManage&&account.is_active&&account.qrPayload&&<div className="mt-4 flex justify-center rounded-xl bg-white p-2"><QRCodeSVG value={account.qrPayload} size={144} marginSize={4} aria-label={`QR พร้อมเพย์ของ ${account.account_name}`} className="h-auto max-w-full"/></div>}</div>)}</div>}
 {editing&&<div className="space-y-4 rounded-xl border border-orange-200 p-4"><h3 className="font-semibold">{editing==='new'?'เพิ่มบัญชีรับเงิน':'แก้ไขบัญชีรับเงิน'}</h3><fieldset disabled={busy}><BankSelector value={draft.bank_code} onChange={bank_code=>setDraft({...draft,bank_code})} disabled={busy} label="เลือกธนาคาร"/><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="ชื่อบัญชี"><input className={input} maxLength={120} value={draft.account_name} onChange={e=>setDraft({...draft,account_name:e.target.value})}/></Field><Field label={draft.bank_code==='PROMPTPAY'?'เบอร์โทร / เลขบัตร / เลขพร้อมเพย์':'เลขบัญชี'}><input className={input} inputMode="numeric" value={draft.account_number} onChange={e=>setDraft({...draft,account_number:e.target.value})}/></Field></div></fieldset><div className="flex items-center justify-between"><span className="text-sm">เปิดใช้งานบัญชี</span><Switch checked={draft.is_active} disabled={busy} label="เปิดใช้งานบัญชีที่กำลังแก้ไข" onChange={is_active=>setDraft({...draft,is_active})}/></div><div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={()=>setEditing(null)}>ยกเลิก</Button><Button loading={busy} onClick={()=>void save()} className="bg-orange-500 hover:bg-orange-600">บันทึกบัญชี</Button></div></div>}
 {!loading&&accounts.length>0&&!accounts.some(a=>a.is_active)&&<p className="text-sm text-amber-700">ทุกบัญชีปิดใช้งานอยู่ ระบบจะไม่ยอมรับสลิปจนกว่าจะเปิดบัญชีอย่างน้อยหนึ่งรายการ</p>}
 {canManage&&!onSelectQr&&<section className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4"><h3 className="font-semibold">QR Code รับเงิน</h3><p className="my-2 text-xs text-slate-500">เลือกบัญชีพร้อมเพย์ที่เปิดใช้งาน ระบบไม่ใช้เลขบัญชีธนาคารแทนหมายเลขพร้อมเพย์</p><select aria-label="เลือกบัญชีพร้อมเพย์สำหรับ QR" className="w-full rounded-xl border bg-white p-2 text-sm" value={qrId} onChange={e=>setQrId(e.target.value)}><option value="">เลือกบัญชีพร้อมเพย์</option>{accounts.filter(a=>a.is_active&&a.qrPayload).map(a=><option key={a.id} value={a.id}>{a.account_name} · {a.account_number}</option>)}</select>{accounts.find(a=>a.id===qrId)?.qrPayload&&<div className="mt-4 flex justify-center rounded-xl bg-white p-3"><QRCodeSVG size={192} marginSize={4} value={accounts.find(a=>a.id===qrId)!.qrPayload!}/></div>}</section>}
 {canManage&&<details className="rounded-xl border border-orange-100 p-4"><summary className="cursor-pointer text-sm font-medium">ประวัติการเปลี่ยนบัญชีรับเงิน</summary><ul className="mt-3 space-y-2 text-xs text-slate-500">{audit.map(a=><li key={a.id}>{new Date(a.created_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})} · {({save:'บันทึกบัญชี',primary:'เปลี่ยนบัญชีหลัก',toggle:'เปลี่ยนสถานะ',delete:'ลบบัญชี'} as Record<string,string>)[a.action]||'เปลี่ยนการตั้งค่า'} · ลงท้าย {a.last_four??'—'}</li>)}</ul>{!audit.length&&<p className="mt-2 text-xs text-slate-500">ยังไม่มีประวัติ</p>}</details>}
 </div></Card>
}
