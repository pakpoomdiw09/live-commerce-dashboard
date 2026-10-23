/** Shared AI/Broadcast clock rule: exact 24h and future timestamps are closed. */
export const STANDARD_MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000
export function withinStandardMessageWindow(
  timestamp: string | null | undefined,
  now = Date.now(),
) {
  const at = Date.parse(timestamp ?? '')
  return Number.isFinite(at) && at <= now && now - at < STANDARD_MESSAGE_WINDOW_MS
}
