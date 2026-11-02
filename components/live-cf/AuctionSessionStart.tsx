'use client'
import { useRef, useState } from 'react'
import { LiveSourcePicker, type LiveSourcePage } from './LiveSourcePicker'
import { defaultSessionAutomation } from '@/lib/features/commerce/session-automation'
import { orange } from './session-ui'

export type AuctionDashboardOptions = {
  pages: LiveSourcePage[]
  bankAccounts: { id: string; bank_code: string; account_number: string }[]
  shopName: string
}
export function AuctionSessionStart({
  tenantId,
  options,
  onStarted,
}: {
  tenantId: string
  options: AuctionDashboardOptions
  onStarted: (id: string) => void
}) {
  const [pageId, setPageId] = useState(options.pages[0]?.id ?? '')
  const [livePostId, setLivePostId] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef({ key: '', id: '' })
  return (
    <form
      className="space-y-3 rounded-xl bg-orange-50/60 p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        const key = `${pageId}:${livePostId}`
        if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() }
        try {
          const response = await fetch('/api/live-auction/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              action: 'start',
              pageId,
              livePostId,
              requestId: request.current.id,
              settings: defaultSessionAutomation(options.bankAccounts[0]?.id),
            }),
            signal: AbortSignal.timeout(30000),
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'เริ่มเซสชันไลฟ์สด ไม่สำเร็จ')
          onStarted(result.id)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'เริ่มเซสชันไลฟ์สด ไม่สำเร็จ')
        } finally {
          setBusy(false)
        }
      }}
    >
      <LiveSourcePicker
        thai
        pages={options.pages}
        pageId={pageId}
        livePostId={livePostId}
        disabled={busy}
        onPageChange={(id) => {
          setPageId(id)
          setLivePostId('')
        }}
        onLiveChange={setLivePostId}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className={orange}
          disabled={busy || !pageId || !livePostId || !options.bankAccounts.length}
        >
          {busy ? 'กำลังเริ่ม…' : 'เริ่มเซสชันไลฟ์สด'}
        </button>
        <p className="text-xs text-slate-500">
          เลือกไลฟ์เดิมเพื่อเปิดเซสชันเดิมต่อ โดยคงบิลและค่าตั้งค่าที่บันทึกไว้
        </p>
      </div>
      {!options.bankAccounts.length && (
        <p role="alert" className="text-sm text-red-700">
          กรุณาเพิ่มบัญชีรับเงินในหน้าตั้งค่าก่อนเริ่มเซสชันไลฟ์สด
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  )
}
