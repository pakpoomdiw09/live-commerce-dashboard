import React from 'react'
declare const __PAYMENT_QR_FIXTURE__:string
export const account={id:'11111111-1111-4111-8111-111111111111',bank_code:'PROMPTPAY',account_name:'บัญชีทดสอบออฟไลน์',account_number:'0812345678',is_active:true,is_primary:true,qrPayload:__PAYMENT_QR_FIXTURE__}
export const codes:{id:string;account_id:string;label:string;payload:string;amount_satang:number|null;order_id:string|null;source:string;is_active:boolean;available:boolean;created_at:string}[]=[]
export const metrics={designSaves:0,saves:0,imports:0,copied:'',requests:[] as string[]}
export default function MockLink({href,children,scroll,...props}:React.ComponentProps<'a'>&{scroll?:boolean}){void scroll;return <a href={href} {...props} onClick={event=>{event.preventDefault();window.dispatchEvent(new CustomEvent('payment-tab',{detail:new URL(String(href),'https://offline.test').searchParams.get('tab')}))}}>{children}</a>}
export const useRouter=()=>({refresh(){}})
export function supabaseBrowser(){return {from(){const q={select:()=>q,eq:()=>q,single:async()=>({data:{slip_quota:100,slip_quota_credits:0,slip_used:0},error:null})};return q},channel(){const q={on:()=>q,subscribe:()=>q};return q},removeChannel:async()=>{}}}
// Server-only status panel is replaced for this browser sandbox. Production uses real RSC data.
export function PaymentChannelStatus(){return <section className="rounded-2xl border bg-white p-5"><h2>ข้อมูลสถานะทดสอบออฟไลน์</h2><p>ยังไม่เชื่อมต่อผู้ให้บริการจริง การตรวจ Backend อยู่ในชุด API/SQL tests</p></section>}
export function installFetch(){Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{metrics.copied=value}},configurable:true});window.fetch=(async(input:RequestInfo|URL,options?:RequestInit)=>{
 const url=String(input);metrics.requests.push(url)
 if(!url.startsWith('/api/'))throw Error('External network forbidden')
 const json=(data:unknown)=>Promise.resolve(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}))
 if(url.startsWith('/api/payment-designs')){
  if(options?.method==='POST'){
   metrics.designSaves++;const form=options.body as FormData,old=JSON.parse(localStorage.getItem('qr-design')??'null');
   localStorage.setItem('qr-design',JSON.stringify({design:JSON.parse(String(form.get('design'))),payload:__PAYMENT_QR_FIXTURE__,version:(old?.version??0)+1,amount_satang:12500,original_path:form.get('original')?'test-private-original':old?.original_path??null,logo_path:null}));
   await new Promise(resolve=>setTimeout(resolve,100));return json({ok:true})
  }
  return json({design:JSON.parse(localStorage.getItem('qr-design')??'null')})
 }
 if(url.startsWith('/api/payment-codes')){
  if(options?.method==='POST'){
   metrics.saves++;const body=options.body instanceof FormData?Object.fromEntries(options.body.entries()):JSON.parse(String(options.body));if(body.mode==='import')metrics.imports++
   codes.unshift({id:crypto.randomUUID(),account_id:account.id,label:String(body.label),payload:__PAYMENT_QR_FIXTURE__,amount_satang:12500,order_id:null,source:body.mode==='import'?'imported':'generated',is_active:true,available:true,created_at:new Date().toISOString()});await new Promise(resolve=>setTimeout(resolve,50));return json({ok:true,id:codes[0].id,paymentVerified:false})
  }
  if(options?.method==='PATCH'){const body=JSON.parse(String(options.body)),code=codes.find(row=>row.id===body.id);if(code){code.is_active=body.isActive;code.available=body.isActive}return json({ok:true})}
  return json({accounts:[account],codes,orders:[],audit:[]})
 }
 if(url.startsWith('/api/bank-accounts'))return json({accounts:[account],audit:[],canManage:true})
 if(url.startsWith('/api/tenants/'))return json({ok:true})
 throw Error('Unmocked API: '+url)
 }) as typeof fetch}
