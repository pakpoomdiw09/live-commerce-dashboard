'use client'

import { neutralSlipText } from '@/lib/ui-labels'
import { useState } from 'react'
import type { ProviderQuota } from '@/lib/provider-quota'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Notice } from '@/components/ui/field'
import { apiError } from '@/lib/utils'

export function ProviderBalance({ initial }: { initial: ProviderQuota }) {
  const [quota, setQuota] = useState(initial)
  const [busy, setBusy] = useState(false)
  async function reload() {
    setBusy(true)
    try {
      const response = await fetch('/api/admin/provider-quota', { cache: 'no-store' })
      if (!response.ok) throw new Error(await apiError(response))
      setQuota(await response.json())
    } catch (error) {
      setQuota({ ok: false, message: error instanceof Error ? error.message : 'อ่านโควตาไม่ได้' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">โควตาตรวจสลิปคงเหลือ</h2>
        <Button size="sm" variant="secondary" loading={busy} onClick={reload}>
          ตรวจสอบอีกครั้ง
        </Button>
      </div>
      {quota.ok ? (
        <>
          <p className="text-4xl font-semibold tabular-nums">
            {quota.remaining.toLocaleString('th-TH')}{' '}
            <span className="text-sm font-normal text-slate-500">รายการ</span>
          </p>
          <p className="text-sm text-slate-500">
            ใช้เกินโควตา {quota.overQuota.toLocaleString('th-TH')} รายการ
          </p>
          <p className="text-xs text-slate-500" suppressHydrationWarning>
            ตรวจล่าสุด{' '}
            {new Date(quota.checkedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
          </p>
        </>
      ) : (
        <Notice tone="error">{neutralSlipText(quota.message)}</Notice>
      )}
      <p className="text-sm text-slate-500">
        ยอดนี้คือโควตาของบัญชีผู้ให้บริการที่ระบบใช้ร่วมกัน
        การเติมสิทธิ์ให้ร้านค้าจะเพิ่มยอดของร้านค้าเท่านั้น
      </p>
    </Card>
  )
}
