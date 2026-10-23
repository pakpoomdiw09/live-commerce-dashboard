export function inboxWindow(timestamp: string | null | undefined, now = Date.now()) {
  const time = timestamp ? Date.parse(timestamp) : NaN
  const remaining = Number.isFinite(time) && time <= now ? 86400000 - (now - time) : 0
  return {
    allowed: remaining > 0,
    nearExpiry: remaining > 0 && remaining <= 3600000,
    remaining: Math.max(0, remaining),
  }
}

export function messengerWindow(timestamp: string | null | undefined, now = Date.now()) {
  const standard = inboxWindow(timestamp, now)
  const time = timestamp ? Date.parse(timestamp) : NaN
  const valid = Number.isFinite(time) && Number.isFinite(now) && time <= now
  const humanRemaining = valid ? Math.max(0, 7 * 86400000 - (now - time)) : 0
  return {
    ...standard,
    expired: valid && !standard.allowed,
    humanRemaining,
    humanAllowed: humanRemaining > 0,
  }
}

export function formatWindowCountdown(milliseconds: number) {
  const seconds = Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds / 1000)) : 0
  const hours = Math.floor(seconds / 3600)
  return [hours, Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}
