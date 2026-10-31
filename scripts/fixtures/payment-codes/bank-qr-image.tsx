import React from 'react'
import type { ImageProps } from 'next/image'

export default function BankQrFixtureImage({ src, unoptimized, ...props }: ImageProps) {
  void unoptimized
  const source =
    typeof src === 'string' && src.startsWith('/api/bank-accounts/qr')
      ? (localStorage.getItem(
          `bank-qr-upload-image:${new URL(src, 'https://offline.test').searchParams.get('accountId')}`,
        ) ?? '')
      : String(src)
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} src={source} alt={props.alt} />
}
