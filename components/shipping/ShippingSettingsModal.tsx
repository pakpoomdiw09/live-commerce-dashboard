'use client'
import { useRef, useState } from 'react'
import { SessionDialog } from '@/components/live-cf/SessionDialog'
import { courierLabel } from './shipping-ui'
import {
  COURIERS,
  normalizeThaiPhone,
  type ShippingSettings,
} from '@/lib/features/shipping/shipping-types'
import {
  shippingField as field,
  shippingButton as button,
  shippingPrimary as primary,
  type ShippingPost,
} from './shipping-ui'

export function ShippingSettingsModal({
  settings,
  post,
  onClose,
}: {
  settings: ShippingSettings
  post: ShippingPost
  onClose: () => void
}) {
  const [draft, setDraft] = useState(settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef(crypto.randomUUID())
  return (
    <SessionDialog title="ตั้งค่าผู้ส่งและขนส่ง" onClose={onClose} busy={busy}>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError('')
          try {
            await post({ action: 'settings', settings: draft }, request.current)
            onClose()
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ')
          } finally {
            setBusy(false)
          }
        }}
      >
        {(
          [
            { key: 'sender_name', label: 'ชื่อร้าน / ผู้ส่ง', max: 200 },
            { key: 'sender_phone', label: 'เบอร์โทรผู้ส่ง', max: 20 },
            { key: 'sender_address', label: 'ที่อยู่ผู้ส่งฉบับเต็ม', max: 1200 },
          ] as const
        ).map((spec) => (
          <label key={spec.key} className="block text-sm font-medium">
            {spec.label}
            <textarea
              aria-label={spec.label}
              rows={spec.key === 'sender_address' ? 3 : 1}
              className={field}
              maxLength={spec.max}
              required
              disabled={busy}
              value={draft[spec.key]}
              onChange={(event) => {
                setDraft((previous) => ({ ...previous, [spec.key]: event.target.value }))
                request.current = crypto.randomUUID()
              }}
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {spec.key === 'sender_name'
                ? 'ชื่อที่จะแสดงบนใบปะหน้าพัสดุ'
                : spec.key === 'sender_phone'
                  ? 'เบอร์ติดต่อร้านเมื่อขนส่งต้องสอบถาม'
                  : 'ระบุที่อยู่ร้านให้ครบ เพื่อใช้ส่งพัสดุตีกลับ'}
            </span>
          </label>
        ))}
        <label className="block text-sm font-medium">
          ขนส่งเริ่มต้น
          <select
            aria-label="ขนส่งเริ่มต้น"
            className={field}
            value={draft.default_courier}
            disabled={busy}
            onChange={(event) => {
              setDraft((previous) => ({ ...previous, default_courier: event.target.value }))
              request.current = crypto.randomUUID()
            }}
          >
            {COURIERS.map((courier) => (
              <option key={courier} value={courier}>
                {courierLabel(courier)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-slate-500">
            เลือกขนส่งที่ร้านใช้เป็นประจำ
          </span>
        </label>
        <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          ตั้งค่า API Key, endpoint และการเชื่อมต่อของแต่ละค่ายได้จากปุ่ม “ตั้งค่าค่ายขนส่ง” ในหน้า
          Shipping
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={button} disabled={busy} onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="submit"
            className={primary}
            disabled={
              busy ||
              !normalizeThaiPhone(draft.sender_phone) ||
              draft.sender_name.trim().length < 2 ||
              draft.sender_address.trim().length < 10
            }
          >
            {busy ? 'กำลังบันทึก…' : 'บันทึกผู้ส่ง'}
          </button>
        </div>
      </form>
    </SessionDialog>
  )
}
