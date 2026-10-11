'use client'

import { AlertOctagon, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Body of every error.tsx boundary. `digest` lets an admin match the error to the server log. */
export function ErrorState({ title = 'เกิดข้อผิดพลาด', error, reset }: { title?: string; error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="grid flex-1 place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-rose-100 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-rose-600">
          <AlertOctagon className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="mt-4 font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">ระบบโหลดข้อมูลส่วนนี้ไม่สำเร็จ ลองใหม่อีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบพร้อมรหัสด้านล่าง</p>
        {error.digest && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-500">รหัส: {error.digest}</p>}
        <Button onClick={reset} variant="secondary" className="mt-5">
          <RotateCcw className="h-4 w-4" aria-hidden />
          ลองอีกครั้ง
        </Button>
      </div>
    </div>
  )
}

/** Inline error for a failed query inside a page that otherwise rendered. */
export function InlineError({ title, message }: { title: string; message?: string }) {
  return (
    <div role="alert" className="rounded-2xl bg-amber-50 p-5 text-sm text-amber-900 ring-1 ring-amber-200">
      <p className="font-semibold">{title}</p>
      {message && <p className="mt-1 font-mono text-xs opacity-80">{message}</p>}
    </div>
  )
}
