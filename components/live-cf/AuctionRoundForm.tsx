'use client'
import { useEffect, useState } from 'react'
import type { SessionSnapshot } from '@/lib/features/commerce/live-session-types'
import { defaultSessionAutomation } from '@/lib/features/commerce/session-automation'
import type { AuctionDashboardOptions } from './AuctionSessionStart'
import { field, orange, button } from './session-ui'

export function AuctionRoundForm({
  tenantId,
  data,
  options,
  onChanged,
}: {
  tenantId: string
  data: SessionSnapshot
  options: AuctionDashboardOptions
  onChanged: () => void
}) {
  const session = data.session
  const [draft, setDraft] = useState({
    itemName: '',
    startPrice: '200',
    minStep: '20',
    shippingFee: '50',
    bankAccountId: session.auction_settings?.bankAccountId ?? options.bankAccounts[0]?.id ?? '',
  })
  const [active, setActive] = useState(data.activeAuction ?? null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  useEffect(() => setActive(data.activeAuction ?? null), [data.activeAuction])
  async function post(path: string, input: Record<string, unknown>) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, ...input }),
      signal: AbortSignal.timeout(30000),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง')
    return result
  }
  return (
    <form
      data-auction-round-form
      className="space-y-4 rounded-xl border border-orange-100 bg-orange-50/40 p-4"
      onSubmit={async (event) => {
        event.preventDefault()
        if (active || busy || session.ended_at) return
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const settings = session.auction_settings ?? defaultSessionAutomation(draft.bankAccountId)
          const result = await post('/api/live-cf/auction', {
            itemName: draft.itemName,
            startPrice: Number(draft.startPrice),
            minStep: Number(draft.minStep),
            shippingFee: Number(draft.shippingFee),
            bankAccountId: draft.bankAccountId,
            pageId: session.page_id,
            livePostId: session.live_post_id,
            // The API also adds the signed-in owner's verified Facebook ID.
            hostIds: [session.page_id],
            privateReply: settings.privateReply,
            publicReply: settings.publicReply,
            // The database inherits the saved Session templates, including the
            // winner-only public variables that legacy bid replies cannot use.
          })
          setActive({ id: result.id, itemName: draft.itemName })
          setNotice(
            'เปิดประมูลแล้ว เมื่อผู้ขายพิมพ์คำปิดรอบ ระบบจะล็อกผู้ชนะและส่งผลทางคอมเมนต์และ Messenger ตามการตอบกลับที่เปิดไว้ทันที',
          )
          onChanged()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'เปิดประมูลไม่สำเร็จ')
        } finally {
          setBusy(false)
        }
      }}
    >
      <h3 className="font-bold text-slate-900">เปิดรอบประมูล</h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-semibold sm:col-span-2">
          ชื่อรายการพระเครื่อง / สินค้า
          <input
            aria-label="ชื่อรายการพระเครื่อง / สินค้า"
            required
            maxLength={200}
            className={field}
            value={draft.itemName}
            disabled={busy || !!active || !!session.ended_at}
            onChange={(e) => setDraft((previous) => ({ ...previous, itemName: e.target.value }))}
            placeholder="เช่น พระสมเด็จ องค์ที่ 1"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            ชื่อนี้จะแสดงในบิลและข้อความแจ้งผู้ชนะ
          </span>
        </label>
        {(
          [
            {
              key: 'startPrice',
              label: 'ราคาเปิดประมูล (บาท)',
              help: 'ราคาที่ลูกค้าคนแรกเริ่มเคาะได้',
              min: '0.01',
            },
            {
              key: 'minStep',
              label: 'ราคาเคาะขั้นต่ำต่อครั้ง (บาท)',
              help: 'แต่ละครั้งที่พิมพ์ตรงคำดัก จะเพิ่มราคาตามจำนวนนี้',
              min: '0.01',
            },
            {
              key: 'shippingFee',
              label: 'ค่าจัดส่งพัสดุ (บาท)',
              help: 'เรียกเก็บจากลูกค้าครั้งเดียวต่อไลฟ์ แม้ซื้อหลายรายการ',
              min: '0',
            },
          ] as const
        ).map((item) => (
          <label key={item.key} className="text-sm font-semibold">
            {item.label}
            <input
              aria-label={item.label}
              type="number"
              required
              min={item.min}
              max={item.key === 'shippingFee' ? 999999 : 999999999}
              step="0.01"
              className={field}
              value={draft[item.key]}
              disabled={busy || !!active || !!session.ended_at}
              onChange={(e) =>
                setDraft((previous) => ({ ...previous, [item.key]: e.target.value }))
              }
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">{item.help}</span>
          </label>
        ))}
        <label className="text-sm font-semibold sm:col-span-2">
          บัญชีธนาคารรับเงิน
          <select
            aria-label="บัญชีธนาคารรับเงิน"
            className={field}
            value={draft.bankAccountId}
            required
            disabled={busy || !!active || !!session.ended_at}
            onChange={(e) =>
              setDraft((previous) => ({ ...previous, bankAccountId: e.target.value }))
            }
          >
            <option value="">เลือกบัญชีรับเงิน</option>
            {options.bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.bank_code} · {account.account_number}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-slate-500">
            ใช้บัญชีนี้เมื่อเปิดบิลใหม่ บิลสะสมที่มีอยู่จะใช้บัญชีเดิมของลูกค้า
          </span>
        </label>
      </div>
      {active && (
        <p role="status" className="rounded-xl bg-white p-3 text-sm text-orange-800">
          กำลังประมูล: <b>{active.itemName}</b> · ผู้ขายนับปากเปล่า
          แล้วพิมพ์คำปิดรอบในนามเพจหรือบัญชี Facebook ของผู้เปิดรอบ
        </p>
      )}
      {session.ended_at && (
        <p className="text-sm text-slate-500">ไลฟ์นี้จบแล้ว เปิดดูบิลและจัดส่งได้ตามปกติ</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          className={`${orange} min-h-14 flex-1 text-base`}
          disabled={busy || !!active || !!session.ended_at || !draft.bankAccountId}
          type="submit"
        >
          {busy ? 'กำลังทำรายการ…' : 'เริ่มเปิดประมูลรอบนี้'}
        </button>
        <button
          type="button"
          className={`${button} min-h-14 bg-slate-100`}
          disabled={busy || !!session.ended_at}
          onClick={async () => {
            setError('')
            setNotice('')
            setBusy(true)
            try {
              if (active) {
                const result = await post('/api/live-cf/auction/close', {
                  auctionId: active.id,
                  cancel: true,
                })
                if (result.status === 'closed') {
                  setNotice('รอบนี้ปิดและบันทึกผู้ชนะแล้ว')
                  setActive(null)
                  onChanged()
                  return
                }
              }
              setActive(null)
              setDraft((previous) => ({
                ...previous,
                itemName: '',
                startPrice: '200',
                minStep: '20',
                shippingFee: '50',
              }))
              setNotice('ล้างรายการแล้ว พร้อมเปิดประมูลรายการใหม่')
              onChanged()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'ยกเลิกรายการไม่สำเร็จ')
            } finally {
              setBusy(false)
            }
          }}
        >
          ยกเลิก / ล้างรอบประมูล
        </button>
      </div>
    </form>
  )
}
