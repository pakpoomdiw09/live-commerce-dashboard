import { LoadingLabel, Skeleton } from '@/components/ui/skeleton'

export default function InboxLoading() {
  return (
    <div aria-busy className="grid h-full min-h-0 md:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_21rem] 2xl:grid-cols-[20rem_minmax(0,1fr)_24rem]">
      <LoadingLabel>กำลังโหลดกล่องข้อความ...</LoadingLabel>
      <div className="space-y-3 border-r border-slate-200 bg-white p-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9" />
        <div className="flex gap-1">
          {['w-14', 'w-16', 'w-14', 'w-12'].map((w, i) => (
            <Skeleton key={i} className={`h-6 rounded-full ${w}`} />
          ))}
        </div>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex gap-3 py-2">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden flex-col bg-slate-50 md:flex">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-7 w-40 rounded-full" />
        </div>
        <div className="flex-1 space-y-4 p-6">
          {['w-1/2', 'w-1/3', 'w-2/5', 'w-1/2'].map((w, i) => (
            <div key={i} className={i % 2 ? 'flex justify-end' : 'flex'}>
              <Skeleton className={`h-12 rounded-2xl ${w}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden space-y-4 border-l border-slate-200 bg-white p-5 xl:block">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-20" />
        <Skeleton className="aspect-[3/4]" />
      </div>
    </div>
  )
}
