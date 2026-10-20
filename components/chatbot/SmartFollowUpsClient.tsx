'use client'
import {ManualFollowUpDialog} from './ManualFollowUpDialog'
import {createBackgroundRefresh} from '@/lib/background-refresh'
import Link from 'next/link'
import {useRouter} from 'next/navigation'
import {useCallback,useEffect,useRef,useState} from 'react'
import {CalendarClock,Lock,Plus,Save,Sparkles,Trash2} from 'lucide-react'
import {supabaseBrowser} from '@/lib/supabase/browser'
import {apiError,baht,customerName,when} from '@/lib/utils'
import {Button} from '@/components/ui/button'
import {Card,CardHeader,PageHeader} from '@/components/ui/card'
import {Switch} from '@/components/ui/Switch'
import {Notice,inputClass} from '@/components/ui/field'
import {DEFAULT_STEPS,WORKFLOW_LABELS,JOB_LABELS,REASON_LABELS,PRECHECK_LABELS,renderSmartFollowUp,type WorkflowKind,type SmartJob,type SmartDashboard} from '@/lib/features/follow-ups/smart-followup-types'
import {PLANS} from '@/lib/features/billing/plans'
import {serializeFollowUpWorkflows,type FollowUpWorkflowDraft} from '@/lib/features/follow-ups/followup-settings-draft'

export function SmartFollowUpsClient({tenantId,initial}:{tenantId:string;initial:SmartDashboard}){
 const [manual,setManual]=useState(false)
 const router=useRouter()
 const [data,setData]=useState(initial),[workflows,setWorkflows]=useState<FollowUpWorkflowDraft[]>(initial.workflows)
 const [kind,setKind]=useState<WorkflowKind>('payment'),[filter,setFilter]=useState('all'),[busy,setBusy]=useState('')
 const [notice,setNotice]=useState<{tone:'error'|'success';text:string}|null>(null),[review,setReview]=useState<SmartJob|null>(null),[draft,setDraft]=useState('')
 const [evidence,setEvidence]=useState<string[]>([])
 const dirty=useRef(false),request=useRef(0)
 const invalidate=useCallback(()=>{++request.current},[])
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  const version=++request.current
  const res=await fetch(`/api/follow-ups?tenantId=${tenantId}`,{cache:'no-store',signal})
  if(!res.ok)throw new Error(await apiError(res))
  const next=await res.json() as SmartDashboard
  if(version!==request.current)return
  setData(previous=>{
   const oldest=next.jobs.at(-1)?.created_at
   const older=oldest?previous.jobs.filter(job=>job.created_at<oldest&&!next.jobs.some(current=>current.id===job.id)):[]
   return {...next,jobs:[...next.jobs,...older],hasMore:older.length?previous.hasMore:next.hasMore}
  });if(!dirty.current){setWorkflows(next.workflows)}
 },[tenantId])
 useEffect(()=>{
  const db=supabaseBrowser();const scheduler=createBackgroundRefresh(signal=>refresh(signal),error=>setNotice({tone:'error',text:error instanceof Error?error.message:'Refresh failed'}),{intervalMs:120000})
  const sync=scheduler.request
  const channel=db.channel(`smart-follow-up:${tenantId}:${crypto.randomUUID()}`)
   .on('postgres_changes',{event:'*',schema:'public',table:'follow_up_jobs',filter:`tenant_id=eq.${tenantId}`},sync)
   .on('postgres_changes',{event:'*',schema:'public',table:'follow_up_workflows',filter:`tenant_id=eq.${tenantId}`},sync)
   .on('postgres_changes',{event:'*',schema:'public',table:'follow_up_policies',filter:`tenant_id=eq.${tenantId}`},sync)
   .subscribe(status=>{if(status==='SUBSCRIBED')sync()})
  const visible=()=>{if(document.visibilityState==='visible')sync()}
  window.addEventListener('online',sync);document.addEventListener('visibilitychange',visible)
  return()=>{invalidate();scheduler.stop();window.removeEventListener('online',sync);document.removeEventListener('visibilitychange',visible);void db.removeChannel(channel)}
 },[tenantId,refresh,invalidate])
 async function perform(key:string,work:()=>Promise<void>,refreshAfter=true){if(busy)return;setBusy(key);setNotice(null);try{await work();if(refreshAfter)await refresh()}catch(e){setNotice({tone:'error',text:e instanceof Error?e.message:'ดำเนินการไม่สำเร็จ'})}finally{setBusy('')}}
 async function save(index?:number){await perform('save',async()=>{
  const selected=workflows.find(item=>item.kind===kind)!
  const steps=serializeFollowUpWorkflows([{...selected,steps:index===undefined?selected.steps:[selected.steps[index]]}])[0].steps
  invalidate()
  const res=await fetch(`/api/follow-ups/workflows/${kind}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId,version:selected.version,index,steps,config:{enabled:selected.enabled,use_ai:selected.use_ai,stop_on_reply:selected.stop_on_reply}})})
  if(!res.ok)throw new Error(await apiError(res))
  const saved=(await res.json()).workflow
  invalidate()
  setWorkflows(previous=>previous.map(item=>item.kind===kind?{...item,id:saved.id,version:saved.version}:item))
  setNotice({tone:'success',text:index===undefined?'บันทึกการตั้งค่าประเภทนี้แล้ว':`บันทึกขั้น ${index+1} เรียบร้อยแล้ว`})
 },true)}
 async function action(job:SmartJob,action:string,text?:string){await perform(job.id,async()=>{
  const res=await fetch(`/api/follow-ups/jobs/${job.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId,action,text})});if(!res.ok)throw new Error(await apiError(res));setReview(null);setNotice({tone:'success',text:action==='approve'?'ตรวจทานแล้ว งานกลับเข้าคิวและจะเช็กเงื่อนไขอีกครั้งก่อนส่ง':'อัปเดตงานแล้ว'})
 })}
 async function stopCustomer(job:SmartJob){await perform(job.id,async()=>{
  const res=await fetch(`/api/follow-ups/customers/${job.customer_id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId,action:'opt_out'})})
  if(!res.ok)throw new Error(await apiError(res))
  setNotice({tone:'success',text:'หยุดติดตามลูกค้ารายนี้แล้ว งานที่ยังไม่ส่งจะถูกยกเลิก เปิดรับใหม่ได้เมื่อลูกค้าส่ง START หรือ เริ่มติดตาม ในแชท'})
 })}
 async function handoff(job:SmartJob){await perform(job.id,async()=>{
  const res=await fetch(`/api/follow-ups/customers/${job.customer_id}/handoff`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId})})
  if(!res.ok)throw new Error(await apiError(res))
  setNotice({tone:'success',text:'รับช่วงแล้ว บอทพักและหยุดงานติดตามที่ยังไม่ส่ง'})
  router.push(`/inbox?customer=${job.customer_id}`)
 })}
 async function aiDraft(){if(!review)return;await perform('draft',async()=>{
  const res=await fetch(`/api/follow-ups/jobs/${review.id}/draft`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId})});if(!res.ok)throw new Error(await apiError(res));const result=await res.json();setDraft(result.draft);setEvidence([result.analysis?.evidence,result.analysis?.transferIssue].filter(Boolean).map(item=>item.messageId+': '+item.quote))
 })}
 async function loadMore(){await perform('more',async()=>{
  const last=data.jobs.at(-1);if(!last)return
  const res=await fetch(`/api/follow-ups?tenantId=${tenantId}&before=${encodeURIComponent(last.created_at)}&beforeId=${last.id}`,{cache:'no-store'});if(!res.ok)throw new Error(await apiError(res));const next=await res.json() as SmartDashboard
  setData(previous=>({...previous,jobs:[...previous.jobs,...next.jobs.filter(job=>!previous.jobs.some(existing=>existing.id===job.id))],hasMore:next.hasMore}))
 },false)}
 function editWorkflow(patch:Partial<FollowUpWorkflowDraft>){dirty.current=true;setWorkflows(previous=>previous.map(w=>w.kind===kind?{...w,...patch}:w))}
 const workflow=workflows.find(w=>w.kind===kind)!,advanced=kind!=='payment'&&!data.aiAllowed
 const visible=data.jobs.filter(job=>filter==='all'||job.status===filter)
 const summary=[['pending','รอติดตาม'],['sent','ส่งสำเร็จ'],['requires_review','รอแอดมิน'],['cancelled','หยุดอัตโนมัติ'],['failed','ส่งไม่สำเร็จ'],['responded','ลูกค้าตอบกลับ']] as const
 return <div className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
  <PageHeader title="ติดตามลูกค้าอัตโนมัติ" description="ตรวจออเดอร์และสลิปล่าสุดก่อนส่งทุกครั้ง พักการติดตามทันทีเมื่อลูกค้าส่งสลิปหรือชำระแล้ว"/>
  {!data.sendEnabled&&<p role="status" className="rounded-xl border border-orange-100 bg-orange-50 p-4 text-sm text-orange-900">ขณะนี้พักการส่งข้อความจริงไว้ คุณยังตั้งค่าและดูคิวติดตามได้ ระบบจะส่งออกเมื่อผู้ดูแลเปิดการส่งจริงเท่านั้น</p>}
  {data.sendEnabled&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">เปิดใช้งานการส่งข้อความจริง · เมื่อเปิดระบบติดตามและถึงกำหนด Worker จะตรวจเงื่อนไขก่อนส่ง งานที่ต้องตรวจร่างยังรอแอดมินอนุมัติตามเดิม</p>}
  {notice&&<Notice tone={notice.tone}>{notice.text}</Notice>}
  <section aria-label="แพ็กเกจและโควตาจริง" className="grid gap-3 md:grid-cols-3">
   <div className="rounded-2xl border border-orange-100 bg-white p-4"><p className="text-xs text-slate-500">แพ็กเกจปัจจุบัน</p><p className="mt-2 font-semibold text-orange-700">{PLANS[data.billing.plan].name}</p><p className="mt-1 text-xs text-slate-500">{data.billing.planExpiresAt?`ใช้งานถึง ${when(data.billing.planExpiresAt)}`:'ไม่มีแพ็กเกจที่มีวันหมดอายุ'}</p><Link href="/billing" className="mt-2 inline-block text-xs text-orange-700 underline">จัดการแพ็กเกจ</Link></div>
   <div className="rounded-2xl border border-orange-100 bg-white p-4"><p className="text-xs text-slate-500">เครดิตส่งข้อความคงเหลือ</p><p className="mt-2 text-2xl font-semibold text-orange-600">{(data.billing.monthly+data.billing.topup).toLocaleString('th-TH')} <span className="text-xs font-normal">ข้อความ</span></p><p className="mt-1 text-xs text-slate-500">แพ็กเกจ {data.billing.monthly.toLocaleString('th-TH')} + เครดิตเติม {data.billing.topup.toLocaleString('th-TH')}</p><p className="mt-1 text-[11px] text-slate-400">ใช้ร่วมกับบรอดแคสต์และตอบอัตโนมัติ</p>{data.billing.monthly+data.billing.topup<=0&&<Link href="/billing" className="mt-2 inline-block text-xs text-orange-700 underline">เติมเครดิตข้อความ S/M/L</Link>}</div>
   <div className="rounded-2xl border border-orange-100 bg-white p-4"><p className="text-xs text-slate-500">โควตาตรวจสลิปคงเหลือ</p><p className="mt-2 text-2xl font-semibold text-orange-600">{data.billing.slipRemaining.toLocaleString('th-TH')} <span className="text-xs font-normal">รายการ</span></p><p className="mt-1 text-xs text-slate-500">แยกจากเครดิตข้อความติดตาม</p></div>
  </section>
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{summary.map(([key,label])=><div key={key} className="rounded-2xl border border-orange-100 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-orange-600">{(data.overview?.[key]??0).toLocaleString('th-TH')}</p><p className="mt-1 text-[10px] text-slate-400">30 วันล่าสุด{key==='responded'?' · ไม่ซ้ำราย':''}</p></div>)}</div>
  <section aria-label="Workflow Templates" className="grid gap-3 md:grid-cols-3">{(['payment','interested','after_sales'] as const).map(item=><button key={item} onClick={()=>setKind(item)} className={`rounded-2xl border p-4 text-left transition ${kind===item?'border-orange-300 bg-gradient-to-br from-orange-50 to-rose-50 ring-1 ring-orange-200':'border-slate-200 bg-white hover:border-orange-200'}`}><span className="flex items-center gap-2 text-sm font-semibold">{item!=='payment'&&!data.aiAllowed?<Lock size={16}/>:<CalendarClock size={16}/>} {WORKFLOW_LABELS[item]}</span><p className="mt-2 text-xs text-slate-500">{item==='payment'?'เริ่มจากออเดอร์ยืนยันรอชำระ':item==='interested'?'AI จำแนกสินค้าที่สนใจ จากรายการสินค้าจริง':'เริ่มเมื่อมีหลักฐานส่งถึงจริงเท่านั้น'}</p></button>)}</section>
  <fieldset disabled={busy==='save'} className="min-w-0 space-y-4">
   <Card><CardHeader title={WORKFLOW_LABELS[kind]} action={<Switch checked={workflow.enabled} disabled={!!busy||(advanced&&!workflow.enabled)} onChange={enabled=>editWorkflow({enabled})} label="เปิดการติดตามประเภทนี้"/>}/>
    <div className="space-y-4 p-5">
     {advanced&&<p className="rounded-xl bg-orange-50 p-3 text-sm text-orange-800"><Lock size={16} className="mr-1 inline"/>Workflow ขั้นสูงสำหรับ Pro <Link className="underline" href="/billing">อัปเกรดแพ็กเกจ</Link></p>}
     <p className="text-xs text-slate-500">{'เริ่มนับจากยืนยันออเดอร์ / ข้อความที่สนใจ / เวลาส่งถึง ตามประเภท ใช้ {ชื่อลูกค้า}, {สินค้า}, {ยอดเงิน} ได้ สูงสุด 3 ขั้นตามสิทธิ์เดิม'}</p>
     <details className="rounded-xl border border-slate-100 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-600">ตัวเลือกเพิ่มเติม</summary>     <div className="mt-3 flex flex-wrap gap-4"><label className="flex items-center gap-2 text-xs"><span>หยุดเมื่อลูกค้าตอบกลับ</span><Switch checked={kind==='interested'||workflow.stop_on_reply} disabled={kind==='interested'} onChange={stop_on_reply=>editWorkflow({stop_on_reply})} label={kind==='interested'?'หยุดเมื่อมีข้อความใหม่ (บังคับ)':'หยุดเมื่อลูกค้าตอบกลับ'}/></label><label className="flex items-center gap-2 text-xs"><span>ให้แอดมินตรวจร่างก่อนส่ง</span><Switch checked={workflow.use_ai} disabled={!data.aiAllowed&&!workflow.use_ai} onChange={use_ai=>editWorkflow({use_ai})} label="ให้แอดมินตรวจร่าง AI ก่อนส่ง"/></label></div>     </details>
     {workflow.steps.map((step,index)=><div key={index} className="space-y-3 rounded-xl border border-orange-100 bg-orange-50/30 p-4">
      <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">{index+1}</span><label className="flex items-center gap-2 text-xs">หลังเหตุการณ์<input type="text" inputMode="numeric" aria-label={`Delay step ${index+1} (minutes)`} onFocus={e=>e.target.select()} value={step.delay_minutes} onChange={e=>{const value=e.target.value;if(/^\d*$/.test(value))editWorkflow({steps:workflow.steps.map((s,i)=>i===index?{...s,delay_minutes:value}:s)})}} className="w-24 rounded-lg border border-orange-200 bg-white px-2 py-1.5"/>นาที</label><button className="ml-auto p-1 text-slate-400 disabled:opacity-30" disabled={workflow.steps.length<2} aria-label={`ลบขั้น ${index+1}`} onClick={()=>editWorkflow({steps:workflow.steps.filter((_,i)=>i!==index)})}><Trash2 size={16}/></button></div>
      <textarea className={inputClass} rows={3} maxLength={2000} value={step.text} aria-label={`ข้อความขั้น ${index+1}`} onChange={e=>editWorkflow({steps:workflow.steps.map((s,i)=>i===index?{...s,text:e.target.value}:s)})}/>
      <Button size="sm" loading={busy==='save'} disabled={!!busy} onClick={()=>void save(index)}><Save size={14}/>บันทึกขั้นนี้</Button>
      <details className="text-xs text-slate-500"><summary className="cursor-pointer">ดูตัวอย่างข้อความ (ข้อมูลตัวอย่าง)</summary><p className="mt-2 whitespace-pre-wrap rounded-xl bg-white p-3">{renderSmartFollowUp(step.text,{name:'ลูกค้าตัวอย่าง',product:'สินค้าตัวอย่าง',total:100})}</p></details>
     </div>)}
     <Button variant="secondary" disabled={!!busy} onClick={()=>void save()}><Save size={16}/>บันทึกทั้งประเภทนี้</Button>
     <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={workflow.steps.length>=3} onClick={()=>editWorkflow({steps:[...workflow.steps,{delay_minutes:Math.min(43200,Number(workflow.steps.at(-1)?.delay_minutes??0)+60),text:DEFAULT_STEPS[kind][0].text}]})}><Plus size={16}/>เพิ่มขั้น</Button><Button variant="ghost" onClick={()=>editWorkflow({steps:DEFAULT_STEPS[kind].map(step=>({...step}))})}>ใช้เทมเพลตเริ่มต้น</Button></div>
    </div>
   </Card>
  </fieldset>
  <Card><CardHeader title="คิวติดตามและประวัติงาน" description="เปิด Inbox เพื่อรับช่วงดูแล งานที่ยังไม่ทราบผลห้ามส่งซ้ำ" action={<div className="flex flex-wrap gap-2"><Button disabled={!!busy} onClick={()=>setManual(true)}><Plus size={16}/>{"\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e23\u0e32\u0e22\u0e0a\u0e37\u0e48\u0e2d"}</Button><select aria-label="กรองคิว" value={filter} onChange={e=>setFilter(e.target.value)} className="rounded-lg border border-orange-200 bg-white p-2 text-xs"><option value="all">ทุกสถานะ</option>{Object.entries(JOB_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>}/>
   <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-orange-50 text-slate-500"><tr>{['ลูกค้า / ผู้ดูแล','Workflow / ออเดอร์','ขั้น / กำหนดส่ง','สถานะ','จัดการ'].map(label=><th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visible.map(job=><tr key={job.id}><td className="p-3"><Link className="font-medium text-orange-700 hover:underline" href={`/inbox?customer=${job.customer_id}`}>{job.customers?customerName(job.customers):'ลูกค้า'}</Link><p className="mt-1 text-slate-400">{job.customers?.assigned_user_id?`ผู้ดูแล ${job.customers.assigned_user_id.slice(0,8)}`:'บอท / ยังไม่มอบหมาย'}</p></td><td className="p-3">{WORKFLOW_LABELS[job.kind]}<p className="mt-1 text-slate-500">{job.orders?`${job.orders.product_name} · ${baht(job.orders.amount)}`:job.kind==='interested'?'อ้างอิงข้อความสนใจสินค้า':'เพิ่มเอง · ไม่ระบุออเดอร์'}</p></td><td className="p-3">ขั้น {job.step}<p className="mt-1 text-slate-400">{when(job.sent_at??job.run_at)}</p></td><td className="p-3"><span className={`inline-block rounded-full px-2 py-1 ${job.status==='requires_review'?'bg-amber-100 text-amber-800':job.status==='sent'?'bg-green-50 text-green-700':'bg-slate-100 text-slate-600'}`}>{JOB_LABELS[job.status]||job.status}</span>{job.reason&&<p className="mt-1 max-w-40 text-slate-400">{PRECHECK_LABELS[job.reason]||REASON_LABELS[job.reason]||job.reason}</p>}{job.responded_at&&<p className="mt-1 text-green-600">ลูกค้าตอบกลับแล้ว</p>}</td><td className="p-3"><div className="flex flex-wrap gap-1">
    {job.status==='requires_review'&&job.reason==='ai_draft'&&!job.dispatch_started_at&&<Button size="sm" variant="secondary" onClick={()=>{setReview(job);setDraft(job.text);setEvidence([])}}>ตรวจร่าง</Button>}
    {job.status==='requires_review'&&!job.dispatch_started_at&&['quota_exhausted','worker_restarted','no_token'].includes(job.reason??'')&&<Button size="sm" variant="secondary" disabled={!!busy} onClick={()=>void action(job,'retry')}>ตรวจเงื่อนไขใหม่</Button>}
    {['pending','failed'].includes(job.status)&&!job.dispatch_started_at&&<Button size="sm" variant="ghost" disabled={!!busy} onClick={()=>void action(job,'cancel')}>ยกเลิก</Button>}
    {job.status==='requires_review'&&<Button size="sm" variant="ghost" disabled={!!busy} onClick={()=>void action(job,'skip')}>ข้าม</Button>}
    {['pending','processing','requires_review'].includes(job.status)&&<><Button size="sm" variant="secondary" disabled={!!busy} onClick={()=>void handoff(job)}>รับช่วงใน Inbox</Button>{!job.customers?.followup_opted_out&&<Button size="sm" variant="ghost" disabled={!!busy} onClick={()=>void stopCustomer(job)}>หยุดติดตามรายนี้</Button>}</>}
   </div></td></tr>)}</tbody></table>{visible.length===0&&<p className="p-10 text-center text-sm text-slate-400">ยังไม่มีงานตรงกับสถานะนี้</p>}</div>
   {data.hasMore&&<div className="p-3 text-center"><Button variant="secondary" disabled={!!busy} onClick={()=>void loadMore()}>โหลดงานเก่าเพิ่มเติม</Button></div>}
  </Card>
  <Card><CardHeader title="ประวัติการประมวลผล" description="100 เหตุการณ์ล่าสุดของร้าน"/><div className="max-h-72 overflow-y-auto p-4">{data.logs.length===0?<p className="text-center text-sm text-slate-400">ยังไม่มีประวัติ</p>:data.logs.map(log=><div key={log.id} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-xs"><span>{PRECHECK_LABELS[log.status]||JOB_LABELS[log.status]||log.status} · {PRECHECK_LABELS[log.reason??'']||REASON_LABELS[log.reason??'']||log.reason||'ดำเนินการตามเงื่อนไข'}<span className="ml-2 font-mono text-slate-400">{log.job_id.slice(0,8)}</span></span><time className="text-slate-400">{when(log.created_at)}</time></div>)}</div></Card>
  {manual&&<ManualFollowUpDialog tenantId={tenantId} onClose={()=>setManual(false)} onAdded={async()=>{setFilter("all");await refresh()}}/>}
  {review&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><section role="dialog" aria-modal="true" aria-labelledby="follow-up-draft" className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h2 id="follow-up-draft" className="font-semibold">ตรวจทานข้อความก่อนเข้าคิว</h2><p className="text-xs text-slate-500">ตรวจราคา ข้อเสนอ และข้อมูลจริงก่อนอนุมัติ ระบบจะเช็กสิทธิ์และสถานะลูกค้าซ้ำก่อนส่ง</p><div className="space-y-2">{evidence.map((item,index)=><p key={index} className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">{item}</p>)}</div><textarea autoFocus rows={6} className={inputClass} maxLength={2000} value={draft} onChange={e=>setDraft(e.target.value)}/><div className="flex flex-wrap gap-2">{data.aiAllowed&&<Button variant="secondary" loading={busy==='draft'} disabled={!!busy} onClick={()=>void aiDraft()}><Sparkles size={15}/>AI ช่วยร่าง</Button>}<Button disabled={!!busy||!draft.trim()} onClick={()=>void action(review,'approve',draft)}>อนุมัติร่างเข้าคิว</Button><Button variant="ghost" disabled={!!busy} onClick={()=>setReview(null)}>ปิด</Button></div></section></div>}
 </div>
}
