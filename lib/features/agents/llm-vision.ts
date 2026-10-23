import 'server-only'
import { downloadVisionImage } from '@/lib/features/vision/vision-image'

export type LlmImage = { mimeType: string; data: string }
export async function loadCatalogImages(
  products: readonly {
    code: string
    image_url?: string | null
    commerce_images?: string[] | null
  }[],
  tenantId: string,
) {
  const candidates = products.filter((p) => p.image_url || p.commerce_images?.length).slice(0, 12)
  const references: { code: string; image: LlmImage }[] = []
  // Small reference thumbnails, three downloads at a time, not a full-catalog image scan.
  for (let offset = 0; offset < candidates.length; offset += 3) {
    const batch = await Promise.all(
      candidates.slice(offset, offset + 3).map(async (product) => {
        try {
          const file = await downloadVisionImage(
            product.commerce_images?.[0] || product.image_url!,
            { tenantId },
          )
          const sharp = (await import('sharp')).default
          const bytes = await sharp(Buffer.from(await file.arrayBuffer()), {
            limitInputPixels: 16000000,
          })
            .timeout({ seconds: 2 })
            .rotate()
            .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer()
          if (bytes.length > 256 * 1024) return null
          return {
            code: product.code,
            image: { mimeType: 'image/webp', data: bytes.toString('base64') },
          }
        } catch {
          return null
        }
      }),
    )
    references.push(...batch.filter((item): item is NonNullable<typeof item> => item !== null))
  }
  return references
}
/** URLs come from signed Meta attachments; downloader restricts CDN, MIME, size and redirects. */
export async function loadLlmImages(urls: readonly string[]): Promise<LlmImage[]> {
  if (
    !Array.isArray(urls) ||
    !urls.length ||
    urls.some((url) => typeof url !== 'string' || !url.trim())
  )
    throw new Error('VISION_IMAGE_URL_MISSING')
  const unique = [...new Set(urls)]
  if (unique.length > 3) throw new Error('VISION_IMAGE_LIMIT')
  const images: LlmImage[] = []
  for (const url of unique) {
    const file = await downloadVisionImage(url)
    images.push({
      mimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()).toString('base64'),
    })
  }
  return images
}
/** Adapter for a future OpenAI-compatible provider; current transport uses Gemini inlineData. */
export function visionMessageContent(text: string, images: readonly LlmImage[]) {
  return [
    { type: 'text' as const, text },
    ...images.map((image) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    })),
  ]
}
