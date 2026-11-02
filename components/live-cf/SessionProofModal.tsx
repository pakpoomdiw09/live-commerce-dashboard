'use client'
import { useEffect, useRef, useState } from 'react'
import { SessionDialog } from './SessionDialog'
import {
  inputMoney,
  sumMoney,
  sessionMoney as money,
  type SessionProof,
  type SessionTab,
} from '@/lib/features/commerce/live-session-types'
import { field, button, orange, read, sessionTime, type Post } from './session-ui'

export function SessionProofModal({
  tenantId,
  sessionId,
  tab,
  post,
  onClose,
}: {
  tenantId: string
  sessionId: string
  tab: SessionTab
  post: Post
  onClose: () => void
}) {
  const [proof, setProof] = useState<SessionProof | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [items, setItems] = useState<{ orderId: string; amount: string; cancelled: boolean }[]>([])
  const [shipping, setShipping] = useState('0'),
    [reason, setReason] = useState('')
  const [attempt, setAttempt] = useState(0)
  const request = useRef(crypto.randomUUID())
  useEffect(() => {
    const controller = new AbortController()
    setProof(null)
    setError('')
    void read(
      `/api/live-cf/sessions?${new URLSearchParams({ tenantId, sessionId, tabId: tab.id })}`,
      controller.signal,
    )
      .then((result: SessionProof) => {
        if (!controller.signal.aborted) {
          setProof(result)
          setItems(
            result.items.map((item) => ({
              orderId: item.orderId,
              amount: String(item.amount),
              cancelled: item.cancelled,
            })),
          )
          setShipping(String(result.tab.shipping_fee))
          request.current = crypto.randomUUID()
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'โหลดข้อมูลไม่สำเร็จ')
      })
    return () => controller.abort()
  }, [tenantId, sessionId, tab.id, attempt])
  const valid =
    inputMoney(shipping, 999999) !== null &&
    items.every((item) => inputMoney(item.amount, 999999999) !== null && Number(item.amount) > 0)
  const activeItems = items.filter((item) => !item.cancelled)
  const total = valid
    ? sumMoney([
        ...activeItems.map((item) => Number(item.amount)),
        ...(activeItems.length ? [Number(shipping)] : []),
      ])
    : null
  const paid = Number(proof?.tab.paid_amount ?? tab.paid)
  const remaining = total === null ? null : Math.max(0, sumMoney([total, -paid]))
  const locked = !!proof?.items.some((item) => item.orderStatus === 'shipped')
  function change() {
    request.current = crypto.randomUUID()
  }
  async function save(remove = false) {
    if (!proof || !valid || reason.trim().length < 3 || locked) return
    setBusy(true)
    setError('')
    const payload = {
      action: 'adjust',
      tabId: tab.id,
      revision: Number(proof.tab.revision),
      shipping: remove ? 0 : Number(shipping),
      reason,
      items: items.map((item) => ({
        ...item,
        amount: Number(item.amount),
        cancelled: remove || item.cancelled,
      })),
    }
    try {
      await post(payload, request.current)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }
  return (
    <SessionDialog title="ยอดที่ลูกค้าต้องจ่าย" onClose={onClose} busy={busy}>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="font-bold">{tab.name}</p>
          <p className="text-sm text-slate-500">
            โอนแล้ว ฿{money(paid)} • {proof?.payments.length ?? tab.slips} สลิป
          </p>
        </div>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => {
            setAttempt((previous) => previous + 1)
            change()
          }}
        >
          โหลดบิลล่าสุด
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!proof ? (
        <p className="text-sm text-slate-500">กำลังโหลดที่มาของยอด…</p>
      ) : (
        <>
          <h3 className="font-semibold">ที่มาของยอดประมูล (ตรวจกับเวลาในคอมเมนต์ไลฟ์ได้)</h3>
          <div className="space-y-3">
            {proof.items.map((item, index) => (
              <div
                key={item.orderId}
                className={`rounded-xl border border-slate-200 p-3 ${items[index]?.cancelled ? 'bg-slate-50' : ''}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold">{item.name}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {item.bidAmount !== null
                        ? `${money(item.bidAmount)} ฿ ← คอมเมนต์ราคาเวลา ${sessionTime(item.bidAt)}`
                        : item.source === 'live_comment'
                          ? 'รายการ CF จากคำสั่งซื้อที่บันทึกไว้'
                          : 'ไม่มีหลักฐานคอมเมนต์ราคาเดิม'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      ปิดรอบ (❤️/❌): {sessionTime(item.closeAt)}
                      {item.bidAt && !item.originalTime && ' • ใช้เวลาที่ระบบรับคอมเมนต์'}
                    </p>
                    {item.commentText && (
                      <p className="mt-1 break-words text-xs text-slate-500">
                        “{item.commentText}” • รหัส {item.commentId}
                      </p>
                    )}
                  </div>
                  <label className="w-36 text-xs font-medium">
                    ยอดเรียกเก็บ (บาท)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max="999999999"
                      className={field}
                      aria-label={`ยอดรายการ ${item.name}`}
                      value={items[index]?.amount ?? ''}
                      disabled={busy || locked || item.cancelled}
                      onChange={(event) => {
                        setItems((previous) =>
                          previous.map((row, i) =>
                            i === index ? { ...row, amount: event.target.value } : row,
                          ),
                        )
                        change()
                      }}
                    />
                  </label>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-red-700">
                  <input
                    type="checkbox"
                    checked={items[index]?.cancelled ?? false}
                    disabled={busy || locked || item.cancelled}
                    onChange={(event) => {
                      setItems((previous) =>
                        previous.map((row, i) =>
                          i === index ? { ...row, cancelled: event.target.checked } : row,
                        ),
                      )
                      change()
                    }}
                  />
                  ยกเลิกยอดรายการนี้{item.cancelled && ' (ยกเลิกแล้ว)'}
                </label>
              </div>
            ))}
          </div>
          <label className="block max-w-xs text-sm font-medium">
            ค่าส่งเฉพาะลูกค้า (ครั้งเดียว)
            <input
              className={field}
              type="number"
              min="0"
              max="999999"
              step="0.01"
              aria-label="ค่าส่งเฉพาะลูกค้า"
              value={shipping}
              disabled={busy || locked}
              onChange={(event) => {
                setShipping(event.target.value)
                change()
              }}
            />
          </label>
          <div className="space-y-2 rounded-xl bg-orange-50 p-4 text-sm text-orange-950">
            <p className="break-words font-semibold">
              {valid && total !== null
                ? `${[...activeItems.map((item) => Number(item.amount)), ...(activeItems.length && Number(shipping) > 0 ? [Number(shipping)] : [])].map(money).join(' + ') || '0.00'} = ${money(total)} ฿`
                : 'กรุณาตรวจจำนวนเงิน'}
            </p>
            <p>
              โอนแล้ว ฿{money(paid)} → คงเหลือสุทธิ ฿{remaining === null ? '—' : money(remaining)}
            </p>
            {total !== null && paid > total && (
              <p>
                เครดิตคงเหลือของลูกค้าคนนี้ ฿{money(sumMoney([paid, -total]))}{' '}
                เงินไม่ถูกย้ายไปผู้อื่น
              </p>
            )}
          </div>
          {!!proof.payments.length && (
            <div className="flex flex-wrap gap-2">
              {proof.payments.map((payment) => (
                <a
                  key={payment.slipId}
                  className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 underline"
                  href={`/inbox?customer=${tab.customerId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  ตรวจสลิป ฿{money(payment.amount)} • {sessionTime(payment.at)}
                </a>
              ))}
            </div>
          )}
          <label className="block text-sm font-medium">
            เหตุผลการแก้ไข
            <input
              aria-label="เหตุผลการแก้ไขยอด"
              className={field}
              value={reason}
              maxLength={500}
              minLength={3}
              disabled={busy || locked}
              onChange={(event) => {
                setReason(event.target.value)
                change()
              }}
              placeholder="เช่น แก้ราคาที่ตรวจจากคอมเมนต์ / ยกเว้นค่าส่ง"
            />
          </label>
          <p className="text-xs text-slate-500">
            ลบยอดจะยกเลิกทุกรายการในบิลนี้และคืนสต็อก CF ที่เคยตัดไว้
            สลิปที่ตรวจผ่านยังคงอยู่เป็นเครดิต การจัดส่งแล้วจะดูหลักฐานได้อย่างเดียว
          </p>
          <div className="flex flex-wrap justify-between gap-3">
            <button
              type="button"
              className="rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
              disabled={busy || locked || !valid || reason.trim().length < 3}
              onClick={() => void save(true)}
            >
              ลบยอด
            </button>
            <div className="flex gap-2">
              <button type="button" className={button} disabled={busy} onClick={onClose}>
                ยกเลิก
              </button>
              <button
                type="button"
                className={orange}
                disabled={busy || locked || !valid || reason.trim().length < 3}
                onClick={() => void save()}
              >
                {busy ? 'กำลังบันทึก…' : 'บันทึกยอด'}
              </button>
            </div>
          </div>
        </>
      )}
    </SessionDialog>
  )
}
