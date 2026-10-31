'use client'

import { useEffect, useId, useState } from 'react'
import Image from 'next/image'

/** Attachment and preview only; the parent form saves the account and QR together. */
export function BankAccountQrUpload({
  file,
  onChange,
  imageUrl = '',
  disabled = false,
}: {
  file: File | null
  onChange: (file: File | null) => void
  imageUrl?: string
  disabled?: boolean
}) {
  const id = useId()
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
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
    if (!selected || disabled) return
    if (
      !['image/png', 'image/jpeg'].includes(selected.type) ||
      !selected.size ||
      selected.size > 5 * 1024 * 1024
    ) {
      setError('เลือกรูป PNG/JPG ไม่เกิน 5 เมกะไบต์')
      return
    }
    setError('')
    onChange(selected)
  }
  const source = preview || (!file ? imageUrl : '')
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className="block text-sm leading-relaxed">
        QR Code รับเงิน
      </label>
      <div
        className={`rounded-xl border-2 border-dashed p-3 text-center ${dragging ? 'border-orange-500 bg-orange-50' : 'border-orange-200 bg-orange-50/20'}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          choose(event.dataTransfer.files[0])
        }}
      >
        {source && (
          <Image
            unoptimized
            src={source}
            width={144}
            height={144}
            alt={file ? 'รูป QR ที่เลือก รอยืนยันการบันทึก' : 'QR Code ประจำบัญชีที่บันทึกไว้'}
            className="mx-auto mb-2 h-36 w-36 max-w-full rounded-lg object-contain"
          />
        )}
        <label
          htmlFor={id}
          className="inline-flex cursor-pointer rounded-lg border border-orange-200 bg-white px-3 py-2 text-xs font-medium text-orange-800 focus-within:outline-2"
        >
          {source ? 'เปลี่ยนรูป QR' : 'เลือกรูป QR'}
          <input
            id={id}
            type="file"
            lang="th"
            disabled={disabled}
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={(event) => {
              choose(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
        <p className="mt-2 text-xs text-slate-500">หรือลากรูปมาวาง</p>
        <p className="mt-1 text-[11px] text-slate-400">PNG/JPG ไม่เกิน 5 เมกะไบต์</p>
        {file && (
          <>
            <p className="mt-2 break-all text-[11px] text-orange-700">{file.name}</p>
            <button
              type="button"
              disabled={disabled}
              className="mt-1 text-xs text-slate-500 underline"
              onClick={() => {
                setError('')
                onChange(null)
              }}
            >
              นำรูปที่เลือกออก
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  )
}
