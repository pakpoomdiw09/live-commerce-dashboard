'use client'

import { useEffect, useState, type ReactNode } from 'react'

/**
 * An <img> that renders `fallback` when there is no src or the file fails to load
 * (a brand asset not yet added to public/, or an expired Graph CDN picture URL).
 */
export function FallbackImg({
  src,
  fallbackSrc,
  fallback,
  alt = '',
  size,
  className,
}: {
  src: string | null | undefined
  fallbackSrc?: string | null
  fallback: ReactNode
  alt?: string
  size: number
  className?: string
}) {
  const [failedSources, setFailedSources] = useState<string[]>([])
  useEffect(() => setFailedSources([]), [src, fallbackSrc])
  const currentSrc = [src, fallbackSrc].find((url) => url && !failedSources.includes(url))

  if (!currentSrc) return <>{fallback}</>
  // plain <img>: Graph CDN hosts rotate, so next/image's remote allow-list isn't worth it
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={currentSrc}
      src={currentSrc}
      alt={alt}
      width={size}
      height={size}
      onError={() => setFailedSources((urls) => [...urls, currentSrc])}
      className={className}
    />
  )
}
