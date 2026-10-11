'use client'

import { useState } from 'react'
import { baht, bahtShort } from '@/lib/utils'

export type DayPoint = { day: string; label: string; amount: number; count: number }

const H = 200 // plot height in px

/** "Nice" axis maximum: 1, 2, 2.5 or 5 × 10^n just above the data. */
function niceMax(v: number) {
  if (v <= 0) return 1000
  const p = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p
}

/**
 * Daily accepted revenue. One series → one hue, no legend (the card title names it).
 * Bars: rounded data-end, 2px gap, hover tooltip with a hit target wider than the bar.
 */
export function RevenueChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(...data.map((d) => d.amount)))
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const h = hover != null ? data[hover] : null

  return (
    <figure className="relative">
      <div className="flex gap-3">
        {/* y axis */}
        <div className="relative w-12 shrink-0 text-right text-[11px] text-slate-400 tabular-nums" style={{ height: H }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>
              {bahtShort(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* recessive grid */}
          {ticks.map((t) => (
            <div key={t} aria-hidden className="absolute inset-x-0 border-t border-slate-100" style={{ top: H - (t / max) * H }} />
          ))}
          <div className="relative flex items-end gap-0.5" style={{ height: H }} onMouseLeave={() => setHover(null)} aria-hidden>
            {data.map((d, i) => (
              <div key={d.day} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
                <div
                  className={`w-full rounded-t transition-colors ${hover === i ? 'bg-emerald-700' : 'bg-emerald-600'}`}
                  style={{ height: d.amount > 0 ? Math.max((d.amount / max) * H, 2) : 0 }}
                />
              </div>
            ))}
          </div>
          {/* x labels: every other day keeps them from colliding */}
          <div className="mt-2 flex gap-0.5 text-[10px] text-slate-400" aria-hidden>
            {data.map((d, i) => (
              <span key={d.day} className="flex-1 text-center">
                {i % 2 === data.length % 2 || i === data.length - 1 ? d.label : ''}
              </span>
            ))}
          </div>

          {h && hover != null && (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
              style={{ left: `${((hover + 0.5) / data.length) * 100}%`, top: Math.max(H - (h.amount / max) * H - 64, 0) }}
            >
              <p className="text-slate-300">{h.label}</p>
              <p className="font-semibold tabular-nums">{baht(h.amount)}</p>
              <p className="text-slate-300">{h.count} สลิปผ่าน</p>
            </div>
          )}
        </div>
      </div>

      {/* the same numbers for screen readers */}
      <table className="sr-only">
        <caption>ยอดรับเงินรายวัน</caption>
        <thead>
          <tr>
            <th>วัน</th>
            <th>ยอด</th>
            <th>จำนวนสลิป</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{d.label}</td>
              <td>{baht(d.amount)}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
