'use client'
import {useState} from 'react'
import Link from 'next/link'
import {PageHeader} from '@/components/ui/card'
import {useInboxState} from '@/hooks/inbox/useInboxState'
import {InboxReportsPanel,type InboxView} from '@/components/inbox/InboxReportsPanel'
export function InboxReports({tenantId}:{tenantId:string}){
 const inbox=useInboxState(tenantId),[view,setView]=useState<InboxView>('overview')
 return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">{(!inbox.data?.proEnabled||inbox.error)&&<PageHeader title="ภาพรวมและรายงานทีมแชท" description="ติดตามสถานะบทสนทนาและการดูแลลูกค้าของทีม"/>}<Link href="/inbox" className="text-sm text-orange-700 underline">กลับไปดูแลแชท</Link>{inbox.error?<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">โหลดข้อมูลรายงานไม่ได้ กรุณาลองใหม่</p>:!inbox.data?<p role="status" className="p-6 text-sm text-slate-500">กำลังโหลดรายงาน…</p>:inbox.data.proEnabled?<div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><InboxReportsPanel tenantId={tenantId} inbox={inbox.data} view={view} onView={setView}/></div>:<p className="p-6 text-sm text-slate-500">ยังไม่ได้เปิดรายงานทีมสำหรับร้านนี้</p>}</main>
}
