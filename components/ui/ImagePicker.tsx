'use client'

import { useMemo, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { IMAGE_TYPES, uploadPublicImage } from '@/lib/upload'

/** Upload one public image (JPG/PNG/GIF, 8 MB) or show the current one with a remove button. */
export function ImagePicker({
  value,
  onChange,
  folder,
  onError,
  label = 'คลิกเพื่ออัปโหลดรูปภาพ',
  onUploadingChange,
}: {
  value: string | null
  onChange: (url: string | null) => void
  folder: string
  onError: (message: string | null) => void
  label?: string
  onUploadingChange?: (uploading: boolean) => void
}) {
  const db = useMemo(() => supabaseBrowser(), [])
  const [uploading, setUploading] = useState(false)

  async function upload(file: File) {
    setUploading(true)
    onUploadingChange?.(true)
    onError(null)
    try {
      const r = await uploadPublicImage(db, file, folder)
      if ('error' in r) onError(r.error)
      else onChange(r.url)
    } catch { onError('อัปโหลดไม่สำเร็จ กรุณาลองใหม่') }
    finally { setUploading(false); onUploadingChange?.(false) }
  }

  if (value) {
    return (
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt="" className="max-h-56 w-full rounded-xl bg-slate-50 object-contain ring-1 ring-slate-200" />
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="ลบรูป"
          className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-slate-600 shadow hover:text-rose-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }
  return (
    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 transition hover:border-orange-300 hover:bg-orange-50/40">
      {uploading ? <Loader2 className="h-7 w-7 animate-spin text-orange-500" aria-hidden /> : <ImagePlus className="h-7 w-7 text-slate-400" aria-hidden />}
      {uploading ? 'กำลังอัปโหลด...' : label}
      <span className="text-xs text-slate-400">JPG, PNG, GIF ไม่เกิน 8 MB</span>
      <input
        type="file"
        accept={IMAGE_TYPES.join(',')}
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
        className="sr-only"
      />
    </label>
  )
}
