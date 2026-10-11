import type { LucideIcon } from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/card'

/** Placeholder for a sidebar menu whose screen isn't built yet. */
export function ComingSoon({ title, description, icon: Icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-8">
      <PageHeader title={title} description={description} />
      <Card className="grid place-items-center px-6 py-16 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-linear-to-br from-orange-100 to-pink-100 text-orange-600">
          <Icon className="h-7 w-7" aria-hidden />
        </span>
        <p className="mt-4 font-semibold text-slate-900">กำลังพัฒนา</p>
        <p className="mt-1 max-w-sm text-sm text-slate-500">เมนูนี้จะเปิดใช้งานในเวอร์ชันถัดไป</p>
      </Card>
    </div>
  )
}
