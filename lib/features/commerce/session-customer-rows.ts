import type { SessionSnapshot, SessionTab } from './live-session-types'

export type SessionCustomerRow = {
  id: string
  fbId: string | null
  customerId: string | null
  name: string
  at: string | null
  comments: number
  matched: boolean
  note: string
  noteRevision: number
  tab: SessionTab | null
}
/** Merge by stable identities, never by display name. Billed customers remain visible without a recent comment. */
export function sessionCustomerRows(data: SessionSnapshot | null): SessionCustomerRow[] {
  if (!data) return []
  const tabsByCustomer = new Map(data.tabs.map((tab) => [tab.customerId, tab]))
  const tabsByFb = new Map(data.tabs.filter((tab) => tab.fbId).map((tab) => [tab.fbId!, tab]))
  const usedTabs = new Set<string>()
  const rows: SessionCustomerRow[] = (data.commenters ?? []).map((person) => {
    const tab =
      (person.customerId ? tabsByCustomer.get(person.customerId) : undefined) ??
      tabsByFb.get(person.fbId) ??
      null
    if (tab) usedTabs.add(tab.id)
    return {
      id: `fb:${person.fbId}`,
      fbId: person.fbId,
      customerId: tab?.customerId ?? person.customerId ?? null,
      name: person.name,
      at: person.at,
      comments: person.comments,
      matched: person.matched === true || tab?.matched === true,
      note: tab?.note ?? person.note ?? '',
      noteRevision: tab?.noteRevision ?? person.noteRevision ?? 0,
      tab,
    }
  })
  for (const tab of data.tabs) {
    if (usedTabs.has(tab.id)) continue
    rows.push({
      id: tab.fbId ? `fb:${tab.fbId}` : `customer:${tab.customerId}`,
      fbId: tab.fbId ?? null,
      customerId: tab.customerId,
      name: tab.name,
      at: null,
      comments: 0,
      matched: tab.matched === true,
      note: tab.note ?? '',
      noteRevision: tab.noteRevision ?? 0,
      tab,
    })
  }
  return rows
}
