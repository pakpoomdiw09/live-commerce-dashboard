import type { SupabaseClient } from '@supabase/supabase-js'

// Messenger accepts these for image attachments
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif']
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024

/**
 * Upload an image to the public comment-media bucket (comment-rules.sql): Meta and the public
 * sale page must load it without a login. Returns the public URL, or an error in Thai.
 */
export async function uploadPublicImage(
  db: SupabaseClient,
  file: File,
  folder: string,
): Promise<{ url: string } | { error: string }> {
  if (!IMAGE_TYPES.includes(file.type)) return { error: 'รองรับเฉพาะไฟล์ JPG, PNG หรือ GIF' }
  if (file.size > IMAGE_MAX_BYTES) return { error: 'ไฟล์ใหญ่เกิน 8 MB' }
  const path = `${folder}/${crypto.randomUUID()}.${file.type.split('/')[1]}`
  const { error } = await db.storage
    .from('comment-media')
    .upload(path, file, { contentType: file.type })
  if (error) return { error: `อัปโหลดไม่สำเร็จ: ${error.message}` }
  return { url: db.storage.from('comment-media').getPublicUrl(path).data.publicUrl }
}
