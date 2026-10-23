/** One owner per request scope. Invalidates responses even when transport ignores abort. */
export class LatestInboxRequest {
  private generation = 0
  private controller: AbortController | null = null
  begin() {
    this.cancel()
    const generation = this.generation
    const controller = new AbortController()
    this.controller = controller
    return {
      signal: controller.signal,
      current: () => generation === this.generation && !controller.signal.aborted,
    }
  }
  cancel() {
    this.generation++
    this.controller?.abort()
    this.controller = null
  }
}
/** Identical INSERT/UPDATE replay is ignored; legitimate status changes still pass. */
export class InboxEventDeduplicator {
  private seen = new Map<string, string>()
  accept(id: string, value: unknown) {
    const signature = JSON.stringify(value)
    if (this.seen.get(id) === signature) return false
    this.seen.delete(id)
    this.seen.set(id, signature)
    if (this.seen.size > 1000) this.seen.delete(this.seen.keys().next().value!)
    return true
  }
}
