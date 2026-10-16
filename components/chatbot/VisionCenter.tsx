'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { LockKeyhole, RefreshCw, ScanEye } from 'lucide-react'
import type { VisionSettings, VisionResult, VisionDecision } from '@/lib/vision-types'

type History={id:string;source:string;status:string;result:VisionResult|null;decision:VisionDecision|null;reason:string|null;created_at:string;ai_request_started_at?:string|null;attempts?:number}
type Overview={settings:VisionSettings;usage:{used:number;limit:number;remaining:number;month:string};productSearch:boolean;jobs:History[];automationEnabled:boolean}
const box='rounded-2xl border border-orange-100 bg-white p-5 shadow-sm'
const button='rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50'
const field='rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm'
const statusLabel:Record<string,string>={pending:'รอประมวลผล',processing:'กำลังประมวลผล',completed:'สำเร็จ',requires_review:'รอแอดมินตรวจสอบ',failed:'ไม่สำเร็จ',cancelled:'ยกเลิก'}

export function VisionCenter({tenantId,canManage,children}:{tenantId:string;canManage:boolean;children:ReactNode}) {
  const [data,setData]=useState<Overview|null>(null),[settings,setSettings]=useState<VisionSettings|null>(null)
  const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [file,setFile]=useState<File|null>(null),[requestId,setRequestId]=useState(''),[preview,setPreview]=useState<History|null>(null)
  const [imagePreview,setImagePreview]=useState<string|null>(null)
  useEffect(()=>{if(!file){setImagePreview(null);return}const url=URL.createObjectURL(file);setImagePreview(url);return()=>URL.revokeObjectURL(url)},[file])
  const endpoint=`/api/chatbot/vision?tenantId=${encodeURIComponent(tenantId)}`
  const load=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(endpoint,{cache:'no-store',signal}),value=await response.json()
    if(!response.ok)throw new Error(value.error??'โหลด AI Vision ไม่สำเร็จ')
    setData(value);setSettings(value.settings)
  },[endpoint])
  useEffect(()=>{const abort=new AbortController();void load(abort.signal).catch(e=>{if(!abort.signal.aborted)setError(e.message)});return()=>abort.abort()},[load])
  async function save(){
    if(!settings||!canManage)return
    setBusy(true);setError('');setNotice('')
    try{const response=await fetch(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,tenantId})});const value=await response.json();if(!response.ok)throw new Error(value.error??'บันทึกไม่สำเร็จ');setData(value);setSettings(value.settings);setNotice('บันทึกการตั้งค่าแล้ว')}
    catch(e){setError(e instanceof Error?e.message:'บันทึกไม่สำเร็จ')}finally{setBusy(false)}
  }
  async function test(){
    if(!file||!requestId)return
    setBusy(true);setError('');setNotice('');setPreview(null)
    try{const form=new FormData();form.set('file',file);form.set('requestId',requestId);const response=await fetch(`/api/chatbot/vision/test?tenantId=${encodeURIComponent(tenantId)}`,{method:'POST',body:form});const value=await response.json();if(!response.ok)throw new Error(value.error??'วิเคราะห์ไม่สำเร็จ');setPreview(value.job);await load();setNotice('ประมวลผลคำขอแล้ว ดูผลด้านล่าง · ไม่มีการส่งข้อความหรือตรวจสลิปจริงจากหน้าทดสอบ')}
    catch(e){setError(e instanceof Error?e.message:'วิเคราะห์ไม่สำเร็จ')}finally{setBusy(false)}
  }
  async function retry(jobId:string){
    setBusy(true);setError('');setNotice('')
    try{const response=await fetch(`/api/chatbot/vision/jobs/${jobId}/retry?tenantId=${encodeURIComponent(tenantId)}`,{method:'POST'});const value=await response.json();if(!response.ok)throw new Error(value.error??'ลองใหม่ไม่ได้');await load();setNotice('นำงานที่ยังไม่เคยเรียก AI กลับเข้าคิวแล้ว')}
    catch(e){setError(e instanceof Error?e.message:'ลองใหม่ไม่ได้')}finally{setBusy(false)}
  }
  return <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <header className="rounded-3xl bg-gradient-to-r from-orange-500 to-pink-500 p-6 text-white"><ScanEye className="mb-3 h-8 w-8"/><h1 className="text-2xl font-bold">AI Vision Center</h1><p className="mt-2 text-sm text-white/90">ผู้ช่วยจำแนกรูปภาพ ค้นหาสินค้าจากแคตตาล็อก และส่งสลิปให้ระบบตรวจสอบจริง</p></header>
    {error&&<p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error} {!data&&'หากยังไม่ได้ติดตั้ง กรุณารัน supabase/ai-vision.sql'} </p>}
    {notice&&<p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-800">{notice}</p>}
    {!data?<p className="text-sm text-slate-500">กำลังโหลดข้อมูล Vision จากฐานข้อมูล…</p>:<>
      <div className="grid gap-4 sm:grid-cols-3"><section className={box}><p className="text-sm text-slate-500">ใช้ AI Vision เดือนนี้ (UTC)</p><p className="mt-2 text-3xl font-bold text-orange-600">{data.usage.used.toLocaleString()} <span className="text-sm font-normal">/ {data.usage.limit.toLocaleString()} ภาพ</span></p></section><section className={box}><p className="text-sm text-slate-500">โควตาภาพคงเหลือ</p><p className="mt-2 text-3xl font-bold">{data.usage.remaining.toLocaleString()}</p><p className="mt-1 text-xs text-slate-500">แยกจากเครดิตตรวจสลิปและข้อความ</p></section><section className={box}><p className="text-sm text-slate-500">งานที่ต้องตรวจสอบใน 30 งานล่าสุด</p><p className="mt-2 text-3xl font-bold">{data.jobs.filter(j=>j.status==='requires_review').length}</p><p className="mt-1 text-xs text-slate-500">ภาพไม่ชัด จับคู่ไม่ได้ หรือผลการส่งไม่แน่นอน</p></section></div>
      <section className={box}><h2 className="font-semibold">โหมด Vision และการส่งต่อแอดมิน</h2><p className="mt-2 text-sm text-slate-500">การส่งข้อความจริงต้องเปิดทั้งสวิตช์ร้านนี้และ AI_VISION_AUTOMATION_ENABLED บนเซิร์ฟเวอร์ สถานะเซิร์ฟเวอร์: {data.automationEnabled?'เปิด':'ปิด'}</p><fieldset disabled={!canManage||busy} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings?.enabled??false} onChange={e=>setSettings(s=>s&&({...s,enabled:e.target.checked}))}/>เปิดรับงานรูปภาพอัตโนมัติของร้าน</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings?.handoff_enabled??true} onChange={e=>setSettings(s=>s&&({...s,handoff_enabled:e.target.checked}))}/>พักบอทและส่งต่อแอดมินเมื่อไม่มั่นใจ</label>
        <label className="grid gap-2 text-sm">รูปแบบคำตอบ<select className={field} value={settings?.mode??'rules'} onChange={e=>setSettings(s=>s&&({...s,mode:e.target.value as VisionSettings['mode']}))}><option value="rules">เลือกกฎตามประเภทภาพ</option><option value="catalog" disabled={!data.productSearch}>ค้นหาสินค้าในแคตตาล็อก (Pro)</option></select></label>
        <label className="grid gap-2 text-sm">ความมั่นใจขั้นต่ำ (0.80–1.00)<input className={field} type="number" min={0.8} max={1} step={0.01} value={settings?.confidence_threshold??0.8} onChange={e=>setSettings(s=>s&&({...s,confidence_threshold:Number(e.target.value)}))}/></label>
      </fieldset><button className={`${button} mt-4`} disabled={!canManage||busy} onClick={()=>void save()}>บันทึกการตั้งค่า</button></section>
      <section className={box}><h2 className="font-semibold">ทดลองวิเคราะห์ภาพจริง</h2><p className="mt-2 text-sm text-slate-500">ใช้โควตา Vision 1 ภาพต่อการประมวลผลใหม่ รองรับ JPG / PNG / WebP ไม่เกิน 5 MB · ทดสอบการจำแนกและเลือกคำตอบเท่านั้น ไม่ส่ง Messenger และไม่เรียก SlipOK</p><div className="mt-4 flex flex-wrap items-center gap-3"><input aria-label="รูปภาพสำหรับทดลอง AI Vision" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setRequestId(crypto.randomUUID());setPreview(null)}}/><button className={button} disabled={!file||busy||data.usage.remaining<=0} onClick={()=>void test()}>{busy?'กำลังดำเนินการ…':'วิเคราะห์ภาพ'}</button></div>
        {imagePreview&&<Image src={imagePreview} alt="ภาพที่เลือกสำหรับทดลอง AI Vision" width={192} height={192} unoptimized className="mt-4 h-48 w-48 rounded-xl border border-orange-100 object-contain"/>}
        {preview&&<div className="mt-4 space-y-2 rounded-xl bg-orange-50 p-4 text-sm"><p>สถานะ: {statusLabel[preview.status]??preview.status}</p>{preview.result&&<><p>ประเภท: {preview.result.category} · ความมั่นใจ {Math.round(preview.result.confidence*100)}%</p><p>{preview.result.description}</p></>}{preview.decision&&<><p>การดำเนินการ: {preview.decision.action}</p><p>{preview.decision.responseText??'ส่งต่อแอดมินหรือระบบตรวจสลิปตามสิทธิ์'}</p>{preview.decision.mediaUrl&&<a className="text-orange-700 underline" href={preview.decision.mediaUrl} target="_blank" rel="noreferrer">ดูรูปภาพแนบจากกฎ</a>}</>}<p className="text-xs text-slate-500">{preview.reason}</p></div>}
      </section>
      <section className={box}><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">ประวัติรูปภาพ · 30 งานล่าสุด</h2><button className="flex items-center gap-2 text-sm text-orange-700" disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}><RefreshCw className="h-4 w-4"/>รีเฟรช</button></div><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">เวลา</th><th className="p-2">ที่มา / ประเภท</th><th className="p-2">สถานะ</th><th className="p-2">เหตุผล</th><th className="p-2">จัดการ</th></tr></thead><tbody>{data.jobs.map(job=><tr key={job.id} className="border-b border-slate-100"><td className="whitespace-nowrap p-2">{new Date(job.created_at).toLocaleString('th-TH')}</td><td className="p-2">{job.source==='test'?'ทดสอบ':'Messenger'} · {job.result?.category??'—'}</td><td className="p-2">{statusLabel[job.status]??job.status}</td><td className="p-2 text-xs text-slate-500">{job.reason??job.decision?.reason??'—'}</td><td className="space-y-2 p-2"><a className="block whitespace-nowrap text-orange-700 underline" href={`/api/chatbot/vision/jobs/${job.id}/image?tenantId=${encodeURIComponent(tenantId)}`} target="_blank" rel="noreferrer">ดูภาพ</a>{canManage&&['requires_review','cancelled'].includes(job.status)&&!job.ai_request_started_at&&(job.attempts??0)<3&&<button disabled={busy} className="whitespace-nowrap text-xs text-orange-700 underline" onClick={()=>void retry(job.id)}>นำกลับเข้าคิว</button>}</td></tr>)}</tbody></table>{!data.jobs.length&&<p className="p-4 text-sm text-slate-500">ยังไม่มีประวัติการวิเคราะห์ภาพ</p>}</div></section>
      <section className="rounded-2xl bg-orange-50 p-5 text-sm text-orange-900"><p className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4"/>แพ็กเกจและเครดิต</p><p className="my-2">Starter ใช้กฎตอบภาพและจำแนกภาพได้ · Pro เพิ่มการจับคู่สินค้าจากแคตตาล็อก · Free ถูกล็อกตามสิทธิ์เดิม เมื่อโควตาภาพหมดจะหยุด AI Vision โดยไม่ใช้เครดิตตรวจสลิปแทน</p><Link href="/billing" className="font-semibold underline">ดูแพ็กเกจ / เติมเครดิตตรวจสลิปและข้อความ</Link></section>
    </>}
    <div className="-mx-4 md:-mx-8">{children}</div>
  </div>
}
