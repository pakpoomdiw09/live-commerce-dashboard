'use client'
import { useState } from 'react'
import Image from 'next/image'

export function PlaygroundProductImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  let valid = false
  try {
    const url = new URL(src)
    valid = url.protocol === 'https:' && !url.username && !url.password
  } catch {}
  if (failed || !valid) return null
  return (
    <Image
      src={src}
      alt="รูปสินค้าหรือภาพคำตอบจากร้าน"
      width={640}
      height={480}
      unoptimized
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="mt-3 max-h-64 max-w-full rounded-xl border border-blue-100 bg-white object-contain"
    />
  )
}
