import type { SlipStatus } from '@/lib/types'

/** Provider outcomes only: pending and technical errors are separate from failed verification. */
export function summarizeSlips(rows: { status: SlipStatus; amount: number | null }[]) {
  const summary = { amount: 0, passed: 0, failed: 0, pending: 0, errors: 0 }
  for (const row of rows) {
    if (row.status === 'valid') {
      summary.passed++
      summary.amount += Number(row.amount ?? 0)
    } else if (row.status === 'pending') summary.pending++
    else if (row.status === 'error') summary.errors++
    else summary.failed++
  }
  return summary
}
