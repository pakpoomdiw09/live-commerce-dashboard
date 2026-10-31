/** Retire subscriptions while the tab is hidden; reconnect with a fresh snapshot on return. */
export function subscribeWhileVisible(start: () => () => void) {
  let dispose: (() => void) | undefined
  let stopped = false
  const sync = () => {
    if (stopped) return
    if (document.visibilityState === 'hidden') {
      const previous = dispose
      dispose = undefined
      previous?.()
    } else if (!dispose) dispose = start()
  }
  document.addEventListener('visibilitychange', sync)
  sync()
  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', sync)
    const previous = dispose
    dispose = undefined
    previous?.()
  }
}
