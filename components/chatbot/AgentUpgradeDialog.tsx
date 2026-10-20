'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { CreditCard, X } from 'lucide-react'

export function AgentUpgradeDialog({ message, onClose }: { message: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} aria-labelledby="agent-upgrade-title" onClose={() => { if (!ref.current?.open) onClose() }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-slate-800 shadow-xl backdrop:bg-slate-900/40">
    <div className="flex items-start justify-between gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-600"><CreditCard className="h-6 w-6"/></span><button autoFocus type="button" aria-label="ปิดข้อความแจ้งเตือน" onClick={() => ref.current?.close()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5"/></button></div>
    <h2 id="agent-upgrade-title" className="mt-4 text-lg font-bold">ตรวจสอบแพ็กเกจและโควตา</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
    <p className="mt-2 text-xs leading-5 text-slate-500">ระบบยังไม่ได้เปิดความสามารถนี้ให้ร้านของคุณ</p>
    <div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={() => ref.current?.close()} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm">ไว้ภายหลัง</button><Link href="/billing" className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600">ดูแพ็กเกจและเพิ่มโควตา</Link></div>
  </dialog>
}
