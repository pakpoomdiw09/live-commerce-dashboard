'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ErrorMessage, LoadingSpinner, SuccessToast } from '@/components/ui/feedback'
import type { BankAccount } from '@/lib/features/banking/bank-accounts'
import type { BankQrState } from '@/lib/features/banking/bank-qr-upload'

export function BankAccountQrUpload({
  tenantId,
  account,
  disabled = false,
  onBusyChange,
}: {
  tenantId: string
  account: BankAccount
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
}) {
  const id = useId()
  const [data, setData] = useState<BankQrState | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const lock = useRef(false)
  const endpoint = `/api/bank-accounts/qr?tenantId=${encodeURIComponent(tenantId)}&accountId=${encodeURIComponent(account.id)}`

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(endpoint, { cache: 'no-store', signal })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || 'โหลด QR ประจำบัญชีไม่สำเร็จ')
      if (!signal?.aborted) {
        setData(value as BankQrState)
        setFile(null)
      }
    },
    [endpoint],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setData(null)
    setError('')
    setNotice('')
    setFile(null)
    load(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [load, account.bank_code, account.account_number])

  useEffect(() => {
    if (!file) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function choose(selected?: File) {
    if (!selected || busy || loading || disabled || !data) return
    setNotice('')
    if (
      !['image/png', 'image/jpeg'].includes(selected.type) ||
      !selected.size ||
      selected.size > 5 * 1024 * 1024
    ) {
      setError('กรุณาเลือกรูป PNG หรือ JPG ขนาดไม่เกิน 5 เมกะไบต์')
      return
    }
    setError('')
    setFile(selected)
  }

  async function save() {
    if (lock.current || loading || disabled || !data || !file) return
    lock.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    setNotice('')
    try {
      const form = new FormData()
      form.set('version', String(data.version))
      form.set('file', file)
      const response = await fetch(endpoint, { method: 'POST', body: form })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || 'บันทึกรูป QR ไม่สำเร็จ')
      try {
        await load()
      } catch {
        throw new Error('บันทึกรูปแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณากดโหลดใหม่')
      }
      setNotice('บันทึกรูป QR ประจำบัญชีแล้ว')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
    } finally {
      lock.current = false
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  async function retry() {
    if (lock.current) return
    lock.current = true
    setLoading(true)
    setError('')
    try {
      await load()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
      lock.current = false
    }
  }

  const image = preview || (!file && data?.hasQr ? `${endpoint}&asset=image&v=${data.version}` : '')
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 border-t border-orange-100 pt-4">
      <h4 id={`${id}-title`} className="font-semibold">
        อัปโหลดรูป QR Code ประจำบัญชี
      </h4>
      <p className="text-xs text-slate-500">
        QR ของบัญชี {account.account_name} · ลงท้าย {account.account_number.slice(-4)}
      </p>
      {loading && <LoadingSpinner label="กำลังโหลดรูป QR…" />}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {notice && <SuccessToast>{notice}</SuccessToast>}
      {disabled && (
        <p className="text-xs text-orange-700">กรุณาบันทึกข้อมูลบัญชีที่แก้ไขก่อนอัปเดตรูป QR</p>
      )}
      <fieldset disabled={disabled || loading || busy || !data} className="space-y-3">
        <div
          className={`rounded-xl border-2 border-dashed p-4 text-center ${dragging ? 'border-orange-500 bg-orange-50' : 'border-orange-200'}`}
          onDragOver={(event) => {
            event.preventDefault()
            if (!disabled && !busy && !loading && data) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            choose(event.dataTransfer.files[0])
          }}
        >
          {image && (
            <Image
              unoptimized
              src={image}
              alt={file ? 'รูป QR ที่เลือก รอยืนยันการบันทึก' : 'QR Code ประจำบัญชีที่บันทึกไว้'}
              width={192}
              height={192}
              className="mx-auto mb-3 max-h-48 w-auto max-w-full rounded-lg object-contain"
            />
          )}
          <label
            htmlFor={`${id}-file`}
            className="inline-flex cursor-pointer rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-medium text-orange-800 focus-within:outline-2 focus-within:outline-orange-500"
          >
            {image ? 'เปลี่ยนรูป QR Code' : 'เลือกรูป QR Code'}
            <input
              id={`${id}-file`}
              type="file"
              lang="th"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={(event) => {
                choose(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
          <p className="mt-2 text-xs text-slate-500">
            หรือลากรูปมาวาง · PNG/JPG ไม่เกิน 5 เมกะไบต์
          </p>
          {file && (
            <p className="mt-2 break-all text-xs text-orange-700">{file.name} · ยังไม่ได้บันทึก</p>
          )}
        </div>
        <Button disabled={!file} loading={busy} onClick={() => void save()}>
          บันทึกการอัปเดตรูป QR Code
        </Button>
      </fieldset>
      {!account.is_active && (
        <p className="text-xs text-slate-500">
          บัญชีนี้ปิดใช้งานอยู่ เปิดใช้งานบัญชีเมื่อต้องการให้ระบบใช้ตรวจสลิป
        </p>
      )}
      {error && !busy && (
        <Button variant="secondary" disabled={loading} onClick={() => void retry()}>
          โหลดใหม่
        </Button>
      )}
    </section>
  )
}
