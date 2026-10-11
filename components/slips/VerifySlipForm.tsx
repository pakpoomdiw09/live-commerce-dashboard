'use client'

import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Upload a slip image and check it with SlipOK against the active tenant's account. */
export function VerifySlipForm({ tenant, onVerified }: { tenant: { id: string; name: string; expectedAmount: number | null } | null; onVerified: (slipId: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [amount, setAmount] = useState(tenant?.expectedAmount != null ? String(tenant.expectedAmount) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (tenant) fd.append('tenantId', tenant.id)
      if (amount.trim()) fd.append('expectedAmount', amount.trim())
      const res = await fetch('/api/slips/verify', { method: 'POST', body: fd })
      const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null
      if (body?.id) return onVerified(body.id) // even a failed check has a row to show
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ตรวจสลิปไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-xs text-slate-500">
        {tenant ? `ตรวจกับบัญชีของ ${tenant.name} ใช้เครดิต 1 ครั้ง` : 'ยังไม่ได้ตั้งค่าร้านค้า: ระบบจะไม่ตรวจบัญชีผู้รับ'}
      </p>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 transition hover:border-emerald-400 hover:bg-emerald-50/30">
        <ImagePlus className="h-8 w-8 text-slate-400" aria-hidden />
        {file ? <span className="font-medium text-slate-800">{file.name}</span> : 'เลือกรูปสลิป (JPG / PNG / WEBP ไม่เกิน 5 MB)'}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">ยอดที่ต้องชำระ (ไม่บังคับ)</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="เช่น 199"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy} disabled={!file}>
        ตรวจสลิป
      </Button>
    </form>
  )
}
