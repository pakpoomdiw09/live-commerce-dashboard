import { LoadingLabel, Skeleton } from '@/components/ui/skeleton'

export function TablePageSkeleton({ label, rows = 8 }: { label: string; rows?: number }) {
  return (
    <div aria-busy className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
      <LoadingLabel>{label}</LoadingLabel>
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex justify-between">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="mt-4 space-y-3">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function OverviewSkeleton() {
  return (
    <div aria-busy className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
      <LoadingLabel>กำลังโหลดภาพรวม...</LoadingLabel>
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-6 h-56" />
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function FormPageSkeleton() {
  return (
    <div aria-busy className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
      <LoadingLabel>กำลังโหลดการตั้งค่า...</LoadingLabel>
      <Skeleton className="h-6 w-56" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </div>
      ))}
    </div>
  )
}
