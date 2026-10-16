'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {QRCodeCanvas} from 'qrcode.react'
import {Button} from '@/components/ui/button'
import {EmptyState,ErrorMessage,LoadingSpinner,SuccessToast} from '@/components/ui/feedback'
import type {ReceivingAccount,ReceivingCode} from '@/lib/payment-codes-core'

type Code=Omit<ReceivingCode,'payload'>&{payload:string|null;available:boolean}
type Data={accounts:ReceivingAccount[];codes:Code[];orders:{id:string;product_name:string;amount:number}[];audit:{id:string;action:string;created_at:string}[]}
export function ReceivingCodeManager({tenantId}:{tenantId:string}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const [accountId,setAccountId]=useState(''),[mode,setMode]=useState<'generate'|'import'>('generate'),[amountMode,setAmountMode]=useState<'open'|'fixed'|'order'>('open'),[amount,setAmount]=useState(''),[orderId,setOrderId]=useState(''),[label,setLabel]=useState(''),[confirmed,setConfirmed]=useState(false),[file,setFile]=useState<File|null>(null)
 const [selected,setSelected]=useState('')
 const canvas=useRef<HTMLCanvasElement>(null),locked=useRef(false),pending=useRef<{fingerprint:string;id:string}|null>(null)
 const endpoint=`/api/payment-codes?tenantId=${encodeURIComponent(tenantId)}`
 const load=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch(endpoint,{cache:'no-store',signal}),value=await response.json()
  if(!response.ok)throw Error(value.error||'โหลดข้อมูล QR ไม่ได้')
  if(!signal?.aborted)setData(value)
  return value as Data
 },[endpoint])
 useEffect(()=>{const controller=new AbortController();const refresh=()=>void load(controller.signal).catch(error=>{if(!controller.signal.aborted){setData(null);setError(error.message)}});refresh();const timer=setInterval(refresh,30000);return()=>{controller.abort();clearInterval(timer)}},[load])
 async function save(){
  if(locked.current)return
  locked.current=true;setBusy(true);setError('');setNotice('')
  const fingerprint=JSON.stringify([accountId,label,mode,amountMode,amount,orderId,file?.name,file?.size,file?.lastModified])
  if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID()}
  const fields={accountId,label,mode,requestId:pending.current.id,amount:amountMode==='fixed'?amount:'',orderId:amountMode==='order'?orderId:'',confirmed}
  try{
   let body:BodyInit,headers:HeadersInit|undefined
   if(mode==='import'){if(!file)throw Error('กรุณาเลือกรูป QR ก่อน');const form=new FormData();for(const [key,value]of Object.entries(fields))form.set(key,String(value));form.set('file',file);body=form}
   else {body=JSON.stringify(fields);headers={'Content-Type':'application/json'}}
   const response=await fetch(endpoint,{method:'POST',headers,body}),value=await response.json()
   if(!response.ok){if(response.status<500)pending.current=null;throw Error(value.error||'บันทึก QR ไม่สำเร็จ')}
   pending.current=null;await load();setSelected(value.id);setNotice('บันทึก QR แล้ว ยังไม่ได้ยืนยันการรับชำระเงิน')
  }catch(error){setError(error instanceof Error?error.message:'บันทึกไม่สำเร็จ')}finally{locked.current=false;setBusy(false)}
 }
 async function toggle(code:Code){if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');try{const response=await fetch(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:code.id,isActive:!code.is_active})}),value=await response.json();if(!response.ok)throw Error(value.error||'เปลี่ยนสถานะไม่ได้');await load();setNotice('บันทึกสถานะ QR แล้ว')}catch(error){setError(error instanceof Error?error.message:'บันทึกไม่ได้')}finally{locked.current=false;setBusy(false)}}
 const code=data?.codes.find(code=>code.id===selected),account=data?.accounts.find(account=>account.id===(code?.account_id||accountId))
 async function download(){try{if(!canvas.current||!code?.available)return;const image=canvas.current.toDataURL('image/png'),id=code.id,payload=code.payload;const fresh=await load();if(!fresh.codes.some(row=>row.id===id&&row.available&&row.payload===payload))throw Error('QR นี้ไม่พร้อมใช้งานแล้ว กรุณาตรวจข้อมูลล่าสุด');const anchor=document.createElement('a');anchor.href=image;anchor.download=`snapbot-qr-${id}.png`;anchor.click()}catch(error){setError(error instanceof Error?error.message:'ดาวน์โหลดไม่ได้')}}
 async function copy(){try{if(!code?.payload||!code.available)return;const id=code.id,payload=code.payload,fresh=await load();if(!fresh.codes.some(row=>row.id===id&&row.available&&row.payload===payload))throw Error('QR นี้ไม่พร้อมใช้งานแล้ว');await navigator.clipboard.writeText(payload);setNotice('คัดลอกข้อมูล QR แล้ว')}catch(error){setError(error instanceof Error?error.message:'คัดลอกไม่ได้ กรุณาใช้เบราว์เซอร์ที่อนุญาตคลิปบอร์ด')}}
 const input='mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm'
 return <div className="space-y-4">
  {error&&<ErrorMessage>{error}</ErrorMessage>}{notice&&<SuccessToast>{notice}</SuccessToast>}
  {!data&&!error&&<LoadingSpinner/>}
  <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
   <form className="min-w-0 space-y-4 rounded-2xl border border-orange-100 bg-white p-5" onSubmit={event=>{event.preventDefault();void save()}}>
    <h2 className="font-bold">จัดการ QR รับชำระเงิน</h2>
    <p className="text-xs leading-relaxed text-slate-500">รองรับพร้อมเพย์ที่เทียบกับบัญชีที่ร้านบันทึกไว้ รูป QR เป็นคำขอรับเงิน ไม่ใช่หลักฐานชำระเงิน ต้องตรวจชื่อผู้รับในแอปธนาคารก่อนใช้งาน</p>
    <fieldset disabled={busy||!data} className="min-w-0 space-y-3">
     <label className="block text-sm">ช่องทางรับชำระเงิน<select className={input} aria-label="ช่องทางรับชำระเงิน" defaultValue="promptpay"><option value="promptpay">พร้อมเพย์ · สร้างหรือนำเข้า QR</option><option disabled>QR ธนาคารรูปแบบอื่น · ยังไม่เชื่อมต่อ</option><option disabled>Barcode ผู้ให้บริการ · ยังไม่เชื่อมต่อ</option></select></label>
     <label className="block text-sm">บัญชีพร้อมเพย์<select required className={input} aria-label="บัญชีพร้อมเพย์" value={accountId} onChange={event=>{setAccountId(event.target.value);setConfirmed(false)}}><option value="">เลือกบัญชีที่เปิดใช้งาน</option>{data?.accounts.filter(account=>account.is_active&&account.bank_code==='PROMPTPAY').map(account=><option key={account.id} value={account.id}>{account.account_name} · {account.account_number}{account.is_primary?' · บัญชีหลัก':''}</option>)}</select></label>
     <label className="block text-sm">ชื่อ QR สำหรับจัดการ<input required maxLength={100} className={input} value={label} onChange={event=>setLabel(event.target.value)} placeholder="ตัวอย่างชื่อ: รับเงินหน้าร้าน" aria-label="ชื่อ QR"/></label>
     <label className="block text-sm">วิธีเพิ่ม QR<select className={input} aria-label="วิธีเพิ่ม QR" value={mode} onChange={event=>setMode(event.target.value as typeof mode)}><option value="generate">สร้างจากบัญชีพร้อมเพย์ที่เลือก</option><option value="import">อัปโหลดรูป QR ที่มีอยู่</option></select></label>
     {mode==='import'&&<label className="block text-sm">รูป QR ที่มีอยู่<input type="file" accept="image/png,image/jpeg,image/webp" required className={`${input} max-w-full text-xs`} aria-label="อัปโหลดรูป QR" onChange={event=>setFile(event.target.files?.[0]??null)}/><span className="mt-1 block text-xs text-slate-500">PNG/JPG/WebP ไม่เกิน 5 MB ระบบอ่านรหัสและสร้างภาพใหม่ ไม่เก็บรูปต้นฉบับ ไม่รองรับ QR แบบ URL หรือ Barcode</span></label>}
     <label className="block text-sm">รูปแบบยอดเงิน<select className={input} aria-label="รูปแบบยอดเงิน" value={amountMode} onChange={event=>setAmountMode(event.target.value as typeof amountMode)}><option value="open">ไม่ระบุยอด · ลูกค้ากรอกในแอปธนาคาร</option><option value="fixed">ระบุยอดเงินคงที่</option><option value="order">ใช้ยอดออเดอร์จากฐานข้อมูล</option></select></label>
     {amountMode==='fixed'&&<label className="block text-sm">ยอดเงิน (บาท)<input className={input} aria-label="ยอดเงิน QR" required type="number" min="0.01" max="99999999.99" step="0.01" value={amount} onChange={event=>setAmount(event.target.value)}/></label>}
     {amountMode==='order'&&<label className="block text-sm">ออเดอร์ที่รอชำระ<select className={input} aria-label="ออเดอร์สำหรับ QR" required value={orderId} onChange={event=>setOrderId(event.target.value)}><option value="">เลือกออเดอร์ (100 รายการล่าสุด)</option>{data?.orders.map(order=><option key={order.id} value={order.id}>{order.product_name} · {Number(order.amount).toFixed(2)} บาท · {order.id.slice(0,8)}</option>)}</select><span className="mt-1 block text-xs text-slate-500">ยอดมาจาก Backend การผูกออเดอร์ในระบบไม่ได้ใส่เลขออเดอร์เป็นเลขอ้างอิงธนาคาร</span></label>}
     <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} className="mt-1"/>ยืนยันว่าได้ตรวจหมายเลขพร้อมเพย์และข้อมูลบัญชีร้านแล้ว</label>
     <Button type="submit" className="bg-orange-500 hover:bg-orange-600" loading={busy} disabled={!accountId||!confirmed}>{mode==='import'?'อ่านและบันทึก QR':'สร้างและบันทึก QR'}</Button>
    </fieldset>
    {data&&!data.accounts.some(account=>account.is_active&&account.bank_code==='PROMPTPAY')&&<EmptyState>ยังไม่มีบัญชีพร้อมเพย์ที่เปิดใช้งาน กรุณาเพิ่มในแท็บบัญชีธนาคารก่อน</EmptyState>}
   </form>
   <section className="min-w-0 space-y-4 rounded-2xl border border-orange-100 bg-orange-50/40 p-5">
    <h2 className="font-bold">ตัวอย่าง QR ที่บันทึก</h2>
    {code?.available&&code.payload?<><div className="mx-auto w-fit max-w-full rounded-2xl border bg-white p-3"><QRCodeCanvas ref={canvas} value={code.payload} size={240} marginSize={4} level="M" className="h-auto max-w-full"/></div><p className="break-words text-center text-sm">{code.label} · {account?.account_name}<br/>{code.amount_satang===null?'ไม่ระบุยอด':`${(Number(code.amount_satang)/100).toFixed(2)} บาท`}</p><div className="flex flex-wrap justify-center gap-2"><Button type="button" variant="secondary" onClick={()=>void download()}>ดาวน์โหลด PNG</Button><Button type="button" variant="secondary" onClick={()=>void copy()}>คัดลอกข้อมูล QR</Button></div><p className="text-xs text-slate-500">ตรวจรูปแบบรหัสและเทียบข้อมูลร้านแล้ว ยังไม่ได้ยืนยันการลงทะเบียนพร้อมเพย์กับธนาคารหรือการรับเงินจริง</p></>:<EmptyState>{code?'QR นี้ปิดใช้งาน บัญชีเปลี่ยน หรือออเดอร์ไม่รอชำระแล้ว':'เลือกหรือสร้าง QR เพื่อแสดงภาพ'}</EmptyState>}
    <p className="text-xs text-slate-500">ปิด QR ใน SnapBot ไม่ได้ยกเลิกรูปที่ดาวน์โหลดหรือพิมพ์ไปแล้ว</p><h3 className="font-semibold">QR ของร้าน · 100 รายการล่าสุด</h3>
    {!data?.codes.length&&data&&<EmptyState>ยังไม่มี QR ที่บันทึก</EmptyState>}
    <ul className="max-h-96 space-y-2 overflow-y-auto">{data?.codes.map(row=><li key={row.id} className="rounded-xl border border-orange-100 bg-white p-3"><button type="button" aria-pressed={selected===row.id} onClick={()=>setSelected(row.id)} className="w-full break-words text-left text-sm font-medium text-orange-800">{row.label} · {row.available?'พร้อมแสดง QR':'ไม่พร้อมใช้งาน'}</button><p className="mt-1 text-xs text-slate-500">{row.source==='imported'?'นำเข้าจากรูป':'สร้างในระบบ'} · {row.order_id?'ผูกกับออเดอร์':'รับเงินทั่วไป'}</p><button type="button" disabled={busy} onClick={()=>void toggle(row)} className="mt-2 text-xs text-slate-600 underline">{row.is_active?'ปิดใช้งาน QR':'เปิดใช้งาน QR'}</button></li>)}</ul>
   </section>
  </div>
  <details className="rounded-2xl border border-orange-100 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">ประวัติการจัดการ QR</summary><ul className="mt-3 space-y-2 text-xs text-slate-500">{data?.audit.map(event=><li key={event.id}>{new Date(event.created_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})} · {({generated:'สร้าง QR',imported:'นำเข้า QR',enabled:'เปิดใช้งาน',disabled:'ปิดใช้งาน'} as Record<string,string>)[event.action]||'เปลี่ยนการตั้งค่า'}</li>)}</ul>{data&&!data.audit.length&&<p className="mt-2 text-xs text-slate-500">ยังไม่มีประวัติ</p>}</details>
 </div>
}
