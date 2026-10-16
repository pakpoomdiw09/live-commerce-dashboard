import type { MessageRow } from '@/lib/types'
export type ThreadChange = { revision: number; message: MessageRow | null }
/** Replay events received during a snapshot request so late responses cannot erase new messages. */
export function reconcileThread(rows: MessageRow[], changes: Map<string, ThreadChange>, since: number, customerId: string) {
  const messages = new Map(rows.filter(row => row.customer_id === customerId).map(row => [row.id, row]))
  for (const [id, change] of changes) {
    if (change.revision <= since) continue
    if (!change.message) messages.delete(id)
    else if (change.message.customer_id === customerId) messages.set(id, change.message)
  }
  return [...messages.values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}
