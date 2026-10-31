'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Image from 'next/image'
import { BankSelector } from '@/components/banking/BankSelector'
import { Button } from '@/components/ui/button'
import { ErrorMessage, LoadingSpinner, SuccessToast } from '@/components/ui/feedback'
import { bankAccountError } from '@/lib/features/banking/bank-accounts'
import type { BankQrState } from '@/lib/features/banking/bank-qr-upload'

const input = 'mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm'
export function BankQrWorkspace({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const id = useId()
  const [data, setData] = useState<BankQrState | null>(null)
  const [bank, setBank] = useState('')
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const lock = useRef(false)
  const endpoint = `/api/bank-accounts/qr?tenantId=${encodeURIComponent(tenantId)}`

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(endpoint, { cache: 'no-store', signal })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || 'โหลดข้อมูลบัญชีรับเงินไม่สำเร็จ')
      if (signal?.aborted) return
      const state = value as BankQrState
      setData(state)
      setBank(state.account?.bank_code ?? '')
      setName(state.account?.account_name ?? '')
      setNumber(state.account?.account_number ?? '')
      setFile(null)
    },
    [endpoint],
  )

  useEffect(() => {
    if (!canManage) return
    const controller = new AbortController()
    setLoading(true)
    setData(null)
    setError('')
    load(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [load, canManage])

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
    if (!selected || busy || loading || !canManage || !data) return
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
    if (lock.current || busy || loading || !canManage || !data) return
    setError('')
    setNotice('')
    const problem = bankAccountError(bank, name, number)
    if (problem) {
      setError(problem)
      return
    }
    if (
      !file &&
      (!data.hasQr ||
        bank !== data.account?.bank_code ||
        number.replace(/[\s-]/g, '') !== data.account?.account_number)
    ) {
      setError('กรุณาเลือกรูป QR ของบัญชีนี้ก่อนบันทึก')
      return
    }
    lock.current = true
    setBusy(true)
    try {
      const form = new FormData()
      form.set('bank_code', bank)
      form.set('account_name', name)
      form.set('account_number', number)
      form.set('version', String(data.version))
      if (file) form.set('file', file)
      const response = await fetch(endpoint, { method: 'POST', body: form })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || 'บันทึก QR รับเงินไม่สำเร็จ')
      try {
        await load()
      } catch {
        throw new Error('บันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณากดโหลดใหม่')
      }
      setNotice('บันทึก QR รับเงินแล้ว ระบบจะใช้บัญชีนี้ตรวจผู้รับเงินในสลิป')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
    } finally {
      lock.current = false
      setBusy(false)
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

  if (!canManage)
    return (
      <p className="rounded-2xl border border-orange-100 bg-white p-5 text-sm text-slate-600">
        เฉพาะเจ้าของร้านหรือผู้ดูแลที่มีสิทธิ์เท่านั้นที่ดูและแก้ไข QR บัญชีรับเงินได้
      </p>
    )
  const image = preview || (!file && data?.hasQr ? `${endpoint}&asset=image&v=${data.version}` : '')
  return (
    <section
      className="mx-auto w-full max-w-3xl space-y-5 rounded-2xl border border-orange-100 bg-white p-5 sm:p-6"
      aria-labelledby={`${id}-title`}
    >
      <div>
        <h3 id={`${id}-title`} className="text-lg font-bold">
          QR Code บัญชีรับเงินของร้าน
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          อัปโหลด QR รับเงินจากแอปธนาคาร และกรอกบัญชีที่ผูกกับ QR นี้เพื่อใช้ตรวจสลิป
        </p>
      </div>
      {loading && <LoadingSpinner label="กำลังโหลดข้อมูลบัญชีรับเงิน…" />}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {notice && <SuccessToast>{notice}</SuccessToast>}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={loading || busy || !data} className="min-w-0 space-y-5">
          <div
            className={`rounded-2xl border-2 border-dashed p-5 text-center ${dragging ? 'border-orange-500 bg-orange-50' : 'border-orange-200 bg-orange-50/30'}`}
            onDragOver={(event) => {
              event.preventDefault()
              if (!loading && !busy && data) setDragging(true)
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
                alt={file ? 'รูป QR ที่เลือก รอยืนยันการบันทึก' : 'QR รับเงินหลักที่ใช้งานอยู่'}
                width={240}
                height={240}
                className="mx-auto mb-4 max-h-60 w-auto max-w-full rounded-lg object-contain"
              />
            )}
            <label
              htmlFor={`${id}-file`}
              className="inline-flex cursor-pointer rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm font-medium text-orange-800 focus-within:outline-2 focus-within:outline-orange-500"
            >
              {image ? 'เปลี่ยนรูป QR รับเงิน' : 'เลือกรูป QR รับเงิน'}
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
            <p className="mt-3 text-sm text-slate-500">หรือลากรูปมาวางที่นี่</p>
            <p className="mt-1 text-xs text-slate-400">รองรับ PNG และ JPG ขนาดไม่เกิน 5 เมกะไบต์</p>
            {file && (
              <p className="mt-2 break-all text-xs text-orange-700">
                {file.name} · ยังไม่ได้บันทึก
              </p>
            )}
          </div>
          <BankSelector
            value={bank}
            onChange={setBank}
            disabled={loading || busy || !data}
            label="ธนาคาร"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium" htmlFor={`${id}-number`}>
              เลขที่บัญชี
              <input
                id={`${id}-number`}
                required
                inputMode="numeric"
                autoComplete="off"
                maxLength={25}
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                className={input}
              />
            </label>
            <label className="block text-sm font-medium" htmlFor={`${id}-name`}>
              ชื่อบัญชี
              <input
                id={`${id}-name`}
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={input}
              />
            </label>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            ใช้เลขที่บัญชีธนาคารที่รับเงินจริง ระบบจะตรวจข้อมูลผู้รับจากสลิปกับบัญชีนี้ รูป QR
            เพียงอย่างเดียวไม่ได้ยืนยันว่าได้รับเงินแล้ว
          </p>
          <Button type="submit" loading={busy} className="bg-orange-500 hover:bg-orange-600">
            บันทึก QR รับเงิน
          </Button>
        </fieldset>
      </form>
      {error && !busy && (
        <Button variant="secondary" disabled={loading} onClick={() => void retry()}>
          โหลดใหม่
        </Button>
      )}
    </section>
  )
}
