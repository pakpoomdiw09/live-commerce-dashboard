'use client'
import Link from 'next/link'
import {Landmark,LayoutDashboard} from 'lucide-react'
import {paymentTabHelp,type PaymentChannelTab} from '@/components/slips/PaymentChannelsGuide'
export function SlipTabs({activeTab,extended=false,designer=false}:{activeTab:'overview'|'settings'|PaymentChannelTab;extended?:boolean;designer?:boolean}){
 const tabs=extended?Object.entries(paymentTabHelp).filter(([id])=>!designer||!['qr','advanced'].includes(id)).map(([id,[label]])=>({id,label,icon:id==='banks'?Landmark:LayoutDashboard})):[{id:'overview',label:'ภาพรวมและตรวจสลิป',icon:LayoutDashboard},{id:'settings',label:'ตั้งค่าบัญชีรับเงินและตรวจสลิป',icon:Landmark}]
 return <nav role="tablist" aria-label="ระบบตรวจสอบสลิป" className="flex flex-wrap gap-2 rounded-2xl border border-orange-100 bg-white p-2 shadow-sm" onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const links=[...e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')],i=links.indexOf(document.activeElement as HTMLElement),next=e.key==='Home'?0:e.key==='End'?links.length-1:(i+(e.key==='ArrowRight'?1:-1)+links.length)%links.length;links[next]?.focus()}}>
 {tabs.map(({id,label,icon:Icon})=><Link id={`slip-tab-${id}`} key={id} role="tab" aria-selected={activeTab===id} aria-controls="slip-tab-panel" tabIndex={activeTab===id?0:-1} href={`/slips?tab=${id}`} scroll={false} className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-orange-500 ${activeTab===id?'bg-linear-to-r from-orange-500 to-pink-500 text-white shadow-sm':'text-slate-600 hover:bg-orange-50'}`}><Icon className="h-4 w-4" aria-hidden/>{label}</Link>)}
 </nav>
}
