export const DEFAULT_FALLBACK_MESSAGE = 'ขอบคุณที่ทักมาค่ะ แอดมินจะเข้ามาตอบโดยเร็วที่สุดนะคะ'
export const MAX_FALLBACK_MESSAGES = 20
export const DEFAULT_HANDOVER_MESSAGE = 'รับทราบค่ะ แอดมินจะเข้ามาตอบโดยเร็วที่สุดนะคะ 🙏'

export function handoverMessages(settings: { handover_messages?: string[]; handover_text?: string | null }): string[] {
  if (Array.isArray(settings.handover_messages)) return settings.handover_messages.map(text => text.trim()).filter(Boolean)
  return settings.handover_text?.trim() ? [settings.handover_text.trim()] : []
}

export function randomHandover(settings: { handover_messages?: string[]; handover_text?: string | null }, random = Math.random): string {
  const messages = handoverMessages(settings)
  return messages.length ? messages[Math.floor(random() * messages.length)] : DEFAULT_HANDOVER_MESSAGE
}

export function fallbackMessages(settings: { fallback_messages?: string[]; fallback_text?: string | null }): string[] {
  if (Array.isArray(settings.fallback_messages)) return settings.fallback_messages.map(text => text.trim()).filter(Boolean)
  return settings.fallback_text?.trim() ? [settings.fallback_text.trim()] : []
}

export function randomFallback(settings: { fallback_messages?: string[]; fallback_text?: string | null }, random = Math.random): string {
  const messages = fallbackMessages(settings)
  return messages.length ? messages[Math.floor(random() * messages.length)] : DEFAULT_FALLBACK_MESSAGE
}
