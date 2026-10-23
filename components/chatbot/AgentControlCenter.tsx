'use client'
import { PageBanner } from '@/components/ui/page-banner'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AgentUserGuide, agentTabs } from '@/components/chatbot/AgentUserGuide'
import { Bot } from 'lucide-react'
import { AgentHandoverQueue } from '@/components/chatbot/AgentHandoverQueue'
import type { HandoverCustomer } from '@/lib/features/agents/agent-handover'
import { AgentOverview } from '@/components/chatbot/AgentOverview'
import { StoreRulesSettings } from '@/components/chatbot/StoreRulesSettings'
import { type AgentFlags } from '@/lib/features/agents/agent-control-core'

type Dashboard = {
  shopInstructions: string
  config: { flags: AgentFlags }
  canManage: boolean
  versions: { id: string; version: number; instructions: string; created_at: string }[]
  customers: HandoverCustomer[]
}
const tabs = agentTabs.map(([name]) => name)
export function AgentControlCenter({
  tenantId,
  children,
}: {
  tenantId: string
  children: ReactNode
  playground?: ReactNode
}) {
  const [tab, setTab] = useState(0),
    [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [retrying, setRetrying] = useState(false)
  const endpoint = `/api/agent-control?tenantId=${encodeURIComponent(tenantId)}`
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const r = await fetch(endpoint, { cache: 'no-store', signal }),
        value = await r.json()
      if (!r.ok) throw new Error(value.error ?? 'โหลดศูนย์ควบคุมไม่สำเร็จ')
      setData(value)
      setError('')
    },
    [endpoint],
  )
  const retryLoad = useCallback(async () => {
    setRetrying(true)
    setError('')
    try {
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดศูนย์ควบคุมไม่สำเร็จ')
    } finally {
      setRetrying(false)
    }
  }, [load])
  useEffect(() => {
    const abort = new AbortController()
    void load(abort.signal).catch((e) => {
      if (!abort.signal.aborted) setError(e.message)
    })
    return () => abort.abort()
  }, [load])
  async function request(url: string, method: string, body?: unknown) {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const value = await r.json()
    if (!r.ok) throw new Error(value.error ?? 'ดำเนินการไม่สำเร็จ')
    return value
  }
  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await load()
      setNotice(message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-0 w-full min-w-0 max-w-none space-y-5 p-4 md:p-8">
      <PageBanner>
        <Bot className="mb-3 h-8 w-8" />
        <h1 className="text-2xl font-bold">ศูนย์ควบคุมผู้ช่วย AI อัจฉริยะ</h1>
        <p className="mt-2 text-sm">
          จัดการการตอบแชทอัตโนมัติ กำหนดกฎของร้าน และส่งต่อบทสนทนาให้แอดมินอย่างปลอดภัย
        </p>
        <AgentUserGuide flags={data?.config.flags} />
      </PageBanner>
      <nav
        aria-label="เมนูศูนย์ควบคุมผู้ช่วย AI"
        className="flex gap-2 overflow-x-auto rounded-2xl bg-white p-2"
      >
        {tabs.map((name, index) => (
          <button
            key={name}
            onClick={() => setTab(index)}
            aria-current={tab === index ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap rounded-xl px-4 py-3 text-sm font-medium ${tab === index ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-orange-50'}`}
          >
            {name}
          </button>
        ))}
      </nav>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
        >
          <span>{error}</span>
          <button
            type="button"
            disabled={retrying}
            onClick={() => void retryLoad()}
            className="rounded-lg border border-rose-200 bg-white px-3 py-2 font-medium text-rose-700 disabled:opacity-50"
          >
            {retrying ? 'กำลังลองอีกครั้ง…' : 'ลองอีกครั้ง'}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-800">
          {notice}
        </p>
      )}
      {tab === 0 ? (
        <AgentOverview
          tenantId={tenantId}
          onSaved={() =>
            load().catch((e) =>
              setError(e instanceof Error ? e.message : 'โหลดการตั้งค่าล่าสุดไม่สำเร็จ'),
            )
          }
        />
      ) : !data ? (
        <div
          role="status"
          aria-busy="true"
          className="min-h-[32rem] w-full animate-pulse space-y-5 rounded-2xl border border-slate-100 bg-white p-5"
        >
          <p className="sr-only">กำลังโหลดข้อมูลจากระบบ…</p>
          <div className="h-6 w-1/3 rounded bg-slate-200" />
          <div className="h-4 w-2/3 rounded bg-slate-100" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-28 rounded-xl bg-slate-100" />
            <div className="h-28 rounded-xl bg-slate-100" />
          </div>
          <div className="h-48 rounded-xl bg-slate-100" />
        </div>
      ) : (
        <>
          {tab === 1 && (
            <StoreRulesSettings
              tenantId={tenantId}
              initial={data.shopInstructions}
              onSaved={() => load()}
              disabled={!data.canManage || busy}
            />
          )}
          {tab === 2 && children}
          {tab === 3 && (
            <AgentHandoverQueue
              tenantId={tenantId}
              initial={data.customers}
              busy={busy}
              onAction={async (customer, action, label) => {
                await mutate(
                  () =>
                    request(`/api/inbox/conversations/${customer.id}`, 'PATCH', {
                      action,
                      version: customer.conversation_version,
                    }),
                  `${label}แล้ว`,
                )
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
