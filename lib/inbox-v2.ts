export function inboxWindow(timestamp: string | null | undefined, now = Date.now()) {
  const time = timestamp ? Date.parse(timestamp) : NaN
  const remaining = Number.isFinite(time) && time <= now ? 86400000 - (now - time) : 0
  return {allowed: remaining > 0, nearExpiry: remaining > 0 && remaining <= 3600000, remaining: Math.max(0, remaining)}
}
