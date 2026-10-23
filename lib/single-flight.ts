/** Coalesce overlapping work in this process; durable DB claims still own job safety. */
const active = new Map<string, Promise<unknown>>()
export function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const pending = active.get(key)
  if (pending) return pending as Promise<T>
  const task = Promise.resolve().then(work)
  active.set(key, task)
  void task.then(
    () => {
      if (active.get(key) === task) active.delete(key)
    },
    () => {
      if (active.get(key) === task) active.delete(key)
    },
  )
  return task
}
