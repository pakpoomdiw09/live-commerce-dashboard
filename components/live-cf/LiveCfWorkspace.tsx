'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Gavel, ShoppingCart } from 'lucide-react'
import { LiveAuctionPanel } from './LiveAuctionPanel'
import { LiveSessionDashboard } from './LiveSessionDashboard'
import type { LiveSourcePage } from './LiveSourcePicker'

export type LiveCfMode = 'cf' | 'auction'

/** Mode navigation is always rendered, including when auction setup is incomplete. */
export function LiveCfWorkspace({
  tenantId,
  bankAccounts,
  pages = [],
  initialMode = 'cf',
  children,
}: {
  tenantId: string
  bankAccounts: { id: string; bank_code: string; account_number: string }[]
  pages?: LiveSourcePage[]
  initialMode?: LiveCfMode
  children: ReactNode
}) {
  const [mode, setMode] = useState<LiveCfMode>(initialMode)
  const tabs = useRef<HTMLDivElement>(null)
  useEffect(() => setMode(initialMode), [initialMode])

  function select(next: LiveCfMode) {
    setMode(next)
    const url = new URL(window.location.href)
    url.searchParams.set('mode', next)
    window.history.replaceState(null, '', url)
  }

  return (
    <div className="min-w-0 shrink-0" data-live-cf-workspace>
      <div className="px-4 pt-4 md:px-8 md:pt-8">
        <p className="mb-3 text-sm text-slate-500">เลือกโหมดควบคุมไลฟ์สด</p>
        <div
          ref={tabs}
          role="tablist"
          aria-label="โหมดไลฟ์สด"
          className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 sm:grid-cols-2"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next =
              event.key === 'Home'
                ? 'cf'
                : event.key === 'End'
                  ? 'auction'
                  : mode === 'cf'
                    ? 'auction'
                    : 'cf'
            select(next)
            tabs.current?.querySelector<HTMLButtonElement>(`#live-mode-${next}`)?.focus()
          }}
        >
          {(
            [
              { id: 'cf', label: 'โหมดดูด CF ปกติ', icon: ShoppingCart },
              { id: 'auction', label: 'โหมดประมูลสด (Auction Mode)', icon: Gavel },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              id={`live-mode-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={mode === tab.id}
              aria-controls={`live-panel-${tab.id}`}
              tabIndex={mode === tab.id ? 0 : -1}
              onClick={() => select(tab.id)}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 ${mode === tab.id ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-600 hover:bg-orange-50'}`}
            >
              <tab.icon className="h-5 w-5 shrink-0" />
              {tab.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          การสลับแท็บเปลี่ยนหน้าควบคุม รอบประมูลที่เปิดอยู่จะรับคอมเมนต์ต่อจนกว่าจะปิดหรือยกเลิก
        </p>
      </div>
      <div id="live-panel-cf" role="tabpanel" aria-labelledby="live-mode-cf" hidden={mode !== 'cf'}>
        {children}
      </div>
      <div
        id="live-panel-auction"
        role="tabpanel"
        aria-labelledby="live-mode-auction"
        hidden={mode !== 'auction'}
        className="p-4 md:p-8"
      >
        <LiveSessionDashboard tenantId={tenantId} active={mode === 'auction'} />
        <LiveAuctionPanel
          tenantId={tenantId}
          bankAccounts={bankAccounts}
          pages={pages}
          active={mode === 'auction'}
        />
      </div>
    </div>
  )
}
