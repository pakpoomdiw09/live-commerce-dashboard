import { OverviewSkeleton } from '@/components/shared/PageSkeletons'
import {premiumOverviewEnabled} from '@/lib/features/overview/premium-overview-core'

export default function OverviewLoading() {
  if(premiumOverviewEnabled())return <div role="status" aria-label="กำลังโหลด Premium Dashboard" className="space-y-6 bg-orange-50/30 p-4 md:p-8"><div className="h-16 animate-pulse rounded-2xl bg-slate-100"/><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({length:5},(_,i)=><div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100"/>)}</div><div className="grid gap-5 xl:grid-cols-3"><div className="h-80 animate-pulse rounded-3xl bg-slate-100 xl:col-span-2"/><div className="h-80 animate-pulse rounded-3xl bg-slate-100"/></div></div>
  return <OverviewSkeleton />
}
