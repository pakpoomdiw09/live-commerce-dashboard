'use client'

import { useEffect, useState, type ReactNode } from 'react'

/**
 * An <img> that renders `fallback` when there is no src or the file fails to load
 * (a brand asset not yet added to public/, or an expired Graph CDN picture URL).
 */
export function FallbackImg({ src, fallback, alt = '', size, className }: { src: string | null | undefined; fallback: ReactNode; alt?: string; size: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  if (!src || failed) return <>{fallback}</>
  // plain <img>: Graph CDN hosts rotate, so next/image's remote allow-list isn't worth it
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={size} height={size} onError={() => setFailed(true)} className={className} />
}
