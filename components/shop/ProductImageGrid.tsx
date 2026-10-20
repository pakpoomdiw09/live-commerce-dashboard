'use client'
import {useRef,useState} from 'react'
import {ImagePlus,Loader2,X} from 'lucide-react'

export function ProductImageGrid({images,disabled,upload,onChange}:{images:string[];disabled:boolean;upload:(file:File)=>Promise<string|null>;onChange:(images:string[])=>void}) {
 const input=useRef<HTMLInputElement>(null),lock=useRef(false)
 const [uploading,setUploading]=useState(false),[error,setError]=useState('')
 async function add(file:File) {
  if(lock.current||disabled||images.length>=8)return
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){setError('กรุณาเลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB');return}
  lock.current=true;setUploading(true);setError('')
  try{const url=await upload(file);if(url)onChange([...images,url].slice(0,8));else setError('อัปโหลดรูปไม่สำเร็จ กรุณาลองอีกครั้ง')}
  catch{setError('อัปโหลดรูปไม่สำเร็จ กรุณาลองอีกครั้ง')}
  finally{lock.current=false;setUploading(false)}
 }
 return <section className="space-y-3 md:col-span-2" aria-label="รูปสินค้า">
  <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium text-slate-800">รูปสินค้า</h3><span role="status" className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{images.length}/8 รูป</span></div>
  <input ref={input} type="file" aria-label="อัปโหลดรูปสินค้า" className="sr-only" tabIndex={-1} accept="image/jpeg,image/png,image/webp" disabled={disabled||uploading||images.length>=8} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void add(file)}}/>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
   {Array.from({length:8},(_,i)=>images[i]?<div key={i} className="group relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
    <img src={images[i]} alt={`รูปสินค้าที่ ${i+1}`} className="h-full w-full object-cover"/>
    {i===0&&<span className="absolute bottom-2 left-2 rounded-md bg-white/95 px-2 py-1 text-[10px] font-medium text-slate-700 shadow-sm">รูปหลัก</span>}
    <button type="button" aria-label={`ลบรูปสินค้าที่ ${i+1}`} disabled={disabled||uploading} onClick={()=>onChange(images.filter((_,j)=>j!==i))} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-slate-600 shadow-sm transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40"><X size={15}/></button>
   </div>:<button key={i} type="button" disabled={disabled||uploading} onClick={()=>input.current?.click()} aria-label={`เพิ่มรูปสินค้าช่องที่ ${i+1}`} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-2 text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
    {uploading&&i===images.length?<Loader2 size={23} className="animate-spin"/>:<ImagePlus size={23}/>}<span className="text-xs">{uploading&&i===images.length?'กำลังอัปโหลด…':'เพิ่มรูปภาพ'}</span>
   </button>)}
  </div>
  <p className="text-xs leading-5 text-slate-500">รองรับ JPG, PNG และ WebP ไม่เกิน 5 MB ต่อรูป · รูปแรกใช้เป็นรูปหลัก</p>
  {error&&<p role="alert" className="text-xs text-rose-600">{error}</p>}
 </section>
}
