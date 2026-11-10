'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomerTab } from '@/lib/features/commerce/customer-tab-types'
import { customerTabItemLabel, tabMoney } from '@/lib/features/commerce/customer-tab-types'

type Reminder = {
  id: string
  tab_id: string
  status: string
  stage: string
  run_at: string
  error_code: string | null
}
function reminderReason(code: string | null) {
  switch (code) {
    case 'RECIPIENT_ID_MISSING':
      return 'ไม่มี Facebook PSID ของลูกค้า ลูกค้าต้องทักเพจก่อนจึงจะส่งได้'
    case 'MESSAGING_WINDOW_CLOSED':
      return 'หมดช่วงเวลาที่ Facebook อนุญาตให้ส่งข้อความอัตโนมัติ รอให้ลูกค้าทักเพจก่อน'
    case 'AUTOMATION_PAUSED':
      return 'ระบบตอบอัตโนมัติถูกปิด หรือผู้ใช้ปิดรับข้อความอัตโนมัติ'
    case 'PAGE_NOT_READY':
      return 'เพจยังไม่มี Access Token ที่พร้อมส่งข้อความ'
    case 'TAB_REMINDER_SCOPE':
      return 'ข้อมูลลูกค้าหรือเพจไม่ตรงกับบิลนี้'
    case 'TAB_TEMPLATE_INVALID':
      return 'แม่แบบข้อความแจ้งยอดไม่ถูกต้อง'
    case 'TAB_SEND_UNCONFIRMED':
      return 'Facebook ยังยืนยันผลส่งไม่ได้ กรุณาตรวจ Inbox ก่อนส่งซ้ำ'
    default:
      return code ? `ส่งไม่ได้ (${code})` : 'ส่งไม่ได้ กรุณาตรวจสิทธิ์และข้อมูลเพจ'
  }
}
export function CustomerTabsPanel({
  customerId,
  onSelectSlip,
}: {
  customerId: string
  onSelectSlip: (id: string) => void
}) {
  const [tabs, setTabs] = useState<CustomerTab[]>([])
  const [jobs, setJobs] = useState<Reminder[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const invoiceRequests = useRef(new Map<string, string>())
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/customer-tabs?customerId=${encodeURIComponent(customerId)}`,
          { cache: 'no-store', signal },
        )
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'โหลดบิลสะสมไม่สำเร็จ')
        if (!signal?.aborted) {
          setTabs(data.tabs)
          setJobs(data.reminders)
          setError('')
        }
      } catch (cause) {
        if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'โหลดบิลไม่สำเร็จ')
      }
    },
    [customerId],
  )
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!document.hidden) await refresh(controller.signal)
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [refresh])
  async function sendSummary(tabId: string) {
    setBusy(true)
    setNotice('')
    try {
      const requestKey = `${customerId}:${tabId}`
      const clientId = invoiceRequests.current.get(requestKey) ?? crypto.randomUUID()
      invoiceRequests.current.set(requestKey, clientId)
      const response = await fetch('/api/customer-tabs/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, tabId, clientId }),
      })
      const data = await response.json()
      if (!response.ok) {
        // Only a definitive rejection permits a new request. Keep ambiguous IDs for reconciliation.
        if (['SEND_REJECTED', 'MESSENGER_SESSION_REQUIRED'].includes(data.code))
          invoiceRequests.current.delete(requestKey)
        throw new Error(data.error || 'ส่งสรุปยอดไม่สำเร็จ กรุณาตรวจข้อความในแชท')
      }
      invoiceRequests.current.delete(requestKey)
      setNotice('ส่งสรุปยอดเข้า Messenger แล้ว')
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'ส่งสรุปยอดไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }
  async function remind() {
    setBusy(true)
    setNotice('')
    try {
      const response = await fetch('/api/customer-tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, action: 'remind', requestId: crypto.randomUUID() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'เข้าคิวทวงยอดไม่ได้')
      setNotice(data.message)
      await refresh()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'เข้าคิวทวงยอดไม่ได้')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      aria-label="บิลสะสมและยอดคงเหลือ"
      className="space-y-3 rounded-2xl border border-orange-100 bg-white p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">บิลสะสมประมูล / CF</h3>
        <span className="text-[10px] text-slate-400">อัปเดตทุก 3 วินาที</span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-orange-50 p-2 text-xs text-orange-800">
          {notice}
        </p>
      )}
      <p className="text-xs text-slate-500">
        ส่งบิลธุรกรรมได้จากปุ่มสรุปยอด แม้ช่องแชททั่วไปหมดเวลา หาก Facebook ปฏิเสธ
        ให้ผู้ซื้อทักเพจก่อน
      </p>
      {!tabs.length && !error && <p className="text-xs text-slate-400">ยังไม่มีบิลสะสมในระบบ</p>}
      {tabs.map((tab) => (
        <article key={tab.id} className="space-y-3 rounded-xl bg-slate-50 p-3">
          <p className="text-[10px] text-slate-400">
            บิล …{tab.id.slice(-6)} • {tab.status === 'fully_paid' ? 'ชำระครบ' : 'ค้างชำระ'}
          </p>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt>ยอดรวมสะสม</dt>
              <dd>{tabMoney(tab.total_amount)} บาท</dd>
            </div>
            <div className="flex justify-between">
              <dt>โอนแล้ว ตรวจผ่าน</dt>
              <dd className="text-emerald-700">{tabMoney(tab.paid_amount)} บาท</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
              <dt>ยอดค้างสุทธิ</dt>
              <dd className="text-base text-orange-600">{tabMoney(tab.remaining_amount)} บาท</dd>
            </div>
          </dl>
          <p className="text-[10px] text-slate-400">
            รวมค่าส่งครั้งเดียว {tabMoney(tab.shipping_fee)} บาท
          </p>
          <ul className="space-y-2">
            {tab.customer_tab_items
              .filter((item) => !item.cancelled)
              .map((item) => (
                <li key={item.order_id} className="flex justify-between gap-2 text-xs">
                  <span>
                    {customerTabItemLabel(item)}
                    {item.variant_label ? ` • ${item.variant_label}` : ''}
                    <span className="block text-[10px] text-slate-400">
                      {new Date(item.closed_at).toLocaleString('th-TH', {
                        timeZone: 'Asia/Bangkok',
                      })}
                    </span>
                  </span>
                  <span className="whitespace-nowrap">{tabMoney(item.amount)}</span>
                </li>
              ))}
          </ul>
          {tab.customer_tab_payments.map((payment) => (
            <button
              type="button"
              key={payment.slip_id}
              onClick={() => onSelectSlip(payment.slip_id)}
              className="block text-left text-xs text-emerald-700 underline"
            >
              ดูสลิป {tabMoney(payment.amount)} บาท •{' '}
              {new Date(payment.transferred_at).toLocaleString('th-TH', {
                timeZone: 'Asia/Bangkok',
              })}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => void sendSummary(tab.id)}
            className="w-full rounded-lg bg-orange-500 p-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            ส่งสรุปยอดรวมบิลเข้า Messenger
          </button>
          {jobs
            .filter((job) => job.tab_id === tab.id)
            .slice(0, 3)
            .map((job) => (
              <p key={job.id} className="text-[10px] text-slate-500">
                แจ้งยอด:{' '}
                {job.status === 'sent'
                  ? 'ส่งแล้ว'
                  : job.status === 'blocked'
                    ? reminderReason(job.error_code)
                    : job.status === 'requires_review'
                      ? reminderReason(job.error_code)
                      : job.status === 'cancelled'
                        ? 'ยกเลิกเพราะไม่มียอดค้าง'
                        : `รอ ${new Date(job.run_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`}
              </p>
            ))}
        </article>
      ))}
      {tabs.some((tab) => Number(tab.remaining_amount) > 0) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void remind()}
          className="w-full rounded-lg border border-orange-200 p-2 text-xs font-semibold text-orange-700 disabled:opacity-50"
        >
          ส่งข้อความทวงยอด
        </button>
      )}
    </section>
  )
}
