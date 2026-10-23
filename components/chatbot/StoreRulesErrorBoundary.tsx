'use client'

import { Component, type ReactNode } from 'react'

export class StoreRulesErrorBoundary extends Component<
  { children: ReactNode; resetKey: string; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    console.error('[store-rules] rendering unavailable')
  }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="space-y-3">
        {this.props.fallback}
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
        >
          ลองแสดงกฎอีกครั้ง
        </button>
      </div>
    )
  }
}
