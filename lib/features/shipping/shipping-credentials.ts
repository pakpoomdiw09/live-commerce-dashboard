import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type ShippingCredentials = {
  apiKey?: string
  secretKey?: string
  token?: string
  merchantId?: string
}

function encryptionKey() {
  const configured = process.env.SHIPPING_CREDENTIALS_ENCRYPTION_KEY?.trim()
  if (!configured) throw new Error('SHIPPING_CREDENTIALS_ENCRYPTION_KEY_REQUIRED')
  const key = /^[a-f\d]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64')
  if (key.length !== 32) throw new Error('SHIPPING_CREDENTIALS_ENCRYPTION_KEY_INVALID')
  return key
}

export function encryptShippingCredentials(credentials: ShippingCredentials) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ])
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptShippingCredentials(value: string): ShippingCredentials {
  const [version, encodedIv, encodedTag, encodedData, extra] = value.split('.')
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedData || extra)
    throw new Error('SHIPPING_CREDENTIALS_INVALID')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(encodedIv, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedData, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  const credentials: unknown = JSON.parse(plaintext)
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials))
    throw new Error('SHIPPING_CREDENTIALS_INVALID')
  return credentials as ShippingCredentials
}
