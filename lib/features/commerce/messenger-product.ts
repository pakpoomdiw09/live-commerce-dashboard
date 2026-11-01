/** Messenger product inquiries are read-only; checkout happens on the sales page. */
export type MessengerProduct = {
  id: string
  name: string
  price: number | string
  description: string | null
  images: string[]
  store_slug: string
  sales_page_url: string | null
  variant_id: string | null
  variant_label: string | null
}

export type MessengerProductReply = ReturnType<typeof buildProductReply>

/** Keep codes exact (including leading zeroes); never extract a number from ordinary prose. */
export function extractProductCode(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > 200) return null
  const source = text.normalize('NFKC').trim()
  // UUIDs can begin with CF/FC; do not mistake those bytes for a shopping prefix.
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(source)) return source.toUpperCase()
  const prefix = /^(?:cf|fc|สนใจ|เอา|รับ|จอง)\s*[:.#-]?\s*/iu
  const prefixed = prefix.test(source)
  const candidate = (prefixed ? source.replace(prefix, '') : source)
    .replace(/^[\s#*]+|[\s!.*]+$/g, '')
    .trim()
  // A code is one token. Spaces around SKU separators are harmless; words/quantities are not.
  const code = candidate.replace(/\s*([-_])\s*/g, '$1')
  if (!/^[a-z0-9][a-z0-9_-]{0,59}$/i.test(code)) return null
  if (!prefixed && !/\d/.test(code)) return null
  return code.toUpperCase()
}

function webUrl(raw: string | null | undefined, origin?: string): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw, origin)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

const shorten = (value: string, length: number) => Array.from(value).slice(0, length).join('')

export function buildProductReply(product: MessengerProduct, appOrigin: string | undefined) {
  const url =
    webUrl(product.sales_page_url, appOrigin) ??
    webUrl(`/s/${encodeURIComponent(product.store_slug)}`, appOrigin)
  if (!url) return null
  const target = new URL(url)
  target.searchParams.set('product', product.id)
  if (product.variant_id) target.searchParams.set('variant', product.variant_id)
  const amount = Number(product.price)
  if (!Number.isFinite(amount) || amount < 0 || !product.name.trim()) return null
  const price = `฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const name = [product.name.trim(), product.variant_label].filter(Boolean).join(' · ')
  const description = (product.description ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const imageUrl = product.images.map((image) => webUrl(image)).find(Boolean) ?? null
  const body = [name, `ราคา ${price}`, description, `สั่งซื้อผ่านเซลเพจ 🛒 ${target.href}`]
    .filter(Boolean)
    .join('\n')
  return {
    body,
    imageUrl,
    message: {
      attachment: {
        type: 'template' as const,
        payload: {
          template_type: 'generic' as const,
          elements: [
            {
              title: shorten(name, 80),
              subtitle: shorten([`ราคา ${price}`, description].filter(Boolean).join(' · '), 80),
              ...(imageUrl ? { image_url: imageUrl } : {}),
              buttons: [
                { type: 'web_url' as const, title: 'สั่งซื้อผ่านเซลเพจ 🛒', url: target.href },
              ],
            },
          ],
        },
      },
    },
  }
}

export async function handleInboundProductMessage(
  text: unknown,
  dependencies: {
    findProduct: (code: string) => Promise<MessengerProduct | null>
    appOrigin: string | undefined
    sendReply: (reply: NonNullable<MessengerProductReply>) => Promise<unknown>
  },
): Promise<boolean> {
  const code = extractProductCode(text)
  if (!code) return false
  const product = await dependencies.findProduct(code)
  if (!product) return false
  const reply = buildProductReply(product, dependencies.appOrigin)
  if (!reply) return false
  await dependencies.sendReply(reply)
  return true
}
