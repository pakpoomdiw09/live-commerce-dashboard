'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { BarChart3, Gavel } from 'lucide-react'
import { LiveAuctionPanel } from './LiveAuctionPanel'
import { LiveSessionDashboard } from './LiveSessionDashboard'
import type { LiveSourcePage } from './LiveSourcePicker'

type View = 'console' | 'summary'
/** Separate control and accounting surfaces; hidden surfaces never poll. */
export function LiveAuctionWorkspace({
  tenantId,
  bankAccounts,
  pages,
  active,
}: {
  tenantId: string
  bankAccounts: { id: string; bank_code: string; account_number: string }[]
  pages: LiveSourcePage[]
  active: boolean
}) {
  const [view, setView] = useState<View>('console')
  const [summaryOpened, setSummaryOpened] = useState(false)
  const tabs = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sync = () => {
      const next =
        new URL(location.href).searchParams.get('auctionView') === 'summary' ? 'summary' : 'console'
      setView(next)
      if (next === 'summary') setSummaryOpened(true)
    }
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  function select(next: View) {
    setView(next)
    if (next === 'summary') setSummaryOpened(true)
    const url = new URL(location.href)
    if (next === 'summary') url.searchParams.set('auctionView', 'summary')
    else url.searchParams.delete('auctionView')
    history.replaceState(null, '', url)
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 'console'
        : event.key === 'End'
          ? 'summary'
          : view === 'console'
            ? 'summary'
            : 'console'
    select(next)
    tabs.current?.querySelector<HTMLButtonElement>(`#auction-view-${next}`)?.focus()
  }
  return (
    <div className="min-w-0 space-y-4" data-auction-workspace>
      <div
        ref={tabs}
        role="tablist"
        aria-label="พื้นที่โหมดประมูล"
        onKeyDown={keyboard}
        className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 md:grid-cols-2"
      >
        {(
          [
            { id: 'console', label: 'ควบคุมประมูลสด', icon: Gavel },
            { id: 'summary', label: 'สรุปผล & รายรับรายจ่าย Session', icon: BarChart3 },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            id={`auction-view-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            aria-controls={`auction-surface-${tab.id}`}
            tabIndex={view === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-orange-500 ${view === tab.id ? 'bg-orange-50 text-orange-800 ring-1 ring-orange-200' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <tab.icon className="h-4 w-4 shrink-0" />
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id="auction-surface-console"
        role="tabpanel"
        aria-labelledby="auction-view-console"
        hidden={view !== 'console'}
      >
        <LiveAuctionPanel
          tenantId={tenantId}
          bankAccounts={bankAccounts}
          pages={pages}
          active={active && view === 'console'}
          onSessionEnded={() => select('summary')}
        />
      </div>
      <div
        id="auction-surface-summary"
        role="tabpanel"
        aria-labelledby="auction-view-summary"
        hidden={view !== 'summary'}
      >
        {summaryOpened && (
          <LiveSessionDashboard tenantId={tenantId} active={active && view === 'summary'} />
        )}
      </div>
    </div>
  )
}
