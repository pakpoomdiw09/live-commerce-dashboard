import {LoaderCircle} from 'lucide-react'
import type {ReactNode} from 'react'

export function LoadingSpinner({label = 'กำลังโหลด…'}: {label?: string}) {
  return <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-600"><LoaderCircle aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none"/>{label}</span>
}
export function ErrorMessage({children}: {children: ReactNode}) {
  return <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{children}</div>
}
export function EmptyState({children}: {children: ReactNode}) {
  return <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">{children}</p>
}
export function SuccessToast({children}: {children: ReactNode}) {
  return <p role="status" aria-live="polite" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{children}</p>
}
