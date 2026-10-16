'use client'
import {useState} from 'react'
import Image from 'next/image'
import {Landmark} from 'lucide-react'

/** Local raster/SVG brand asset; a failed request always produces an explicit fallback. */
export function BankLogoImage({src,name}:{src:string;name:string}){
 const [failed,setFailed]=useState(false)
 if(failed)return <Landmark role="img" aria-label={`ไอคอนสำรอง ${name} · โหลดโลโก้ไม่สำเร็จ`} className="h-1/2 w-1/2"/>
 return <Image src={src} width={56} height={56} unoptimized alt={`โลโก้${name}`} onError={()=>setFailed(true)} className="h-3/4 w-3/4 object-contain"/>
}
