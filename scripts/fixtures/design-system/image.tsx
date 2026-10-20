import type { CSSProperties } from 'react'

export default function Image({ src, alt = '', fill, className, width, height, style }: {
  src: string; alt?: string; fill?: boolean; className?: string; width?: number; height?: number; style?: CSSProperties
}) {
  // Browser fixtures serve local assets directly; production keeps next/image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={width} height={height} className={className} style={fill ? { ...style, position: 'absolute', inset: 0, width: '100%', height: '100%' } : style}/>
}
