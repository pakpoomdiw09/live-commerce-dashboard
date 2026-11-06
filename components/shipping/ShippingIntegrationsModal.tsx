'use client'
import { useMemo, useRef, useState } from 'react'
import { SessionDialog } from '@/components/live-cf/SessionDialog'
import {
  SHIPPING_PROVIDERS,
  SHIPPING_PROVIDER_LABELS,
  type ShippingIntegrationSummary,
  type ShippingProvider,
} from '@/lib/features/shipping/shipping-types'
import {
  shippingButton as button,
  shippingField as field,
  shippingPrimary as primary,
  type ShippingPost,
} from './shipping-ui'

type IntegrationDraft = {
  api_endpoint: string
  api_key: string
  secret_key: string
  token: string
  merchant_id: string
  sender_name: string
  sender_phone: string
  sender_address: string
  tracking_url_template: string
  weight_kg: string
  is_active: boolean
  is_default: boolean
  credentials_configured: boolean
}

const blank = (): IntegrationDraft => ({
  api_endpoint: '',
  api_key: '',
  secret_key: '',
  token: '',
  merchant_id: '',
  sender_name: '',
  sender_phone: '',
  sender_address: '',
  tracking_url_template: '',
  weight_kg: '1',
  is_active: false,
  is_default: false,
  credentials_configured: false,
})

const draftFrom = (
  value?: ShippingIntegrationSummary,
  provider?: ShippingProvider,
): IntegrationDraft =>
  value
    ? {
        ...blank(),
        api_endpoint: value.api_endpoint,
        sender_name: value.sender_info.name,
        sender_phone: value.sender_info.phone,
        sender_address: value.sender_info.address,
        tracking_url_template: value.tracking_url_template,
        weight_kg: String(value.weight_kg),
        is_active: value.is_active,
        is_default: value.is_default,
        credentials_configured: value.credentials_configured,
      }
    : {
        ...blank(),
        ...(provider === 'beemove'
          ? {
              api_endpoint: 'https://client.beemove.co.th',
              tracking_url_template: 'https://client.beemove.co.th/tracking/{tracking_number}',
            }
          : {}),
      }

export function ShippingIntegrationsModal({
  integrations,
  post,
  onClose,
}: {
  integrations: ShippingIntegrationSummary[]
  post: ShippingPost
  onClose: () => void
}) {
  const [provider, setProvider] = useState<ShippingProvider>('beemove')
  const saved = useMemo(
    () => Object.fromEntries(integrations.map((item) => [item.provider, item])),
    [integrations],
  )
  const [drafts, setDrafts] = useState<Record<string, IntegrationDraft>>(() =>
    Object.fromEntries(integrations.map((item) => [item.provider, draftFrom(item)])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef(crypto.randomUUID())
  const draft = drafts[provider] ?? draftFrom(saved[provider], provider)
  const setDraft = (patch: Partial<IntegrationDraft>) => {
    setDrafts((previous) => ({
      ...previous,
      [provider]: { ...(previous[provider] ?? draftFrom(saved[provider], provider)), ...patch },
    }))
    request.current = crypto.randomUUID()
  }
  const payload = (includeSecrets: boolean) => ({
    provider,
    apiEndpoint: draft.api_endpoint,
    credentials: {
      ...(includeSecrets
        ? { apiKey: draft.api_key, secretKey: draft.secret_key, token: draft.token }
        : {}),
      merchantId: draft.merchant_id,
    },
    senderInfo: {
      name: draft.sender_name,
      phone: draft.sender_phone,
      address: draft.sender_address,
    },
    trackingUrlTemplate: draft.tracking_url_template,
    weightKg: Number(draft.weight_kg),
    isActive: draft.is_active,
    isDefault: draft.is_default,
    credentialsConfigured: draft.credentials_configured,
  })
  async function submit(action: 'test_integration' | 'save_integration') {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await post(
        { action, integration: payload(true) },
        action === 'save_integration' ? request.current : crypto.randomUUID(),
      )
      if (action === 'test_integration') setNotice('เชื่อมต่อ API สำเร็จ')
      else {
        setNotice('บันทึกการเชื่อมต่อแล้ว')
        setDraft({ api_key: '', secret_key: '', token: '', credentials_configured: true })
      }
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ดำเนินการไม่สำเร็จ')
      return null
    } finally {
      setBusy(false)
    }
  }
  return (
    <SessionDialog title="ตั้งค่าการเชื่อมต่อขนส่ง (BYOK)" onClose={onClose} busy={busy}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="ผู้ให้บริการขนส่ง">
          {SHIPPING_PROVIDERS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={provider === id}
              className={provider === id ? primary : button}
              onClick={() => {
                setProvider(id)
                setError('')
                setNotice('')
              }}
            >
              {SHIPPING_PROVIDER_LABELS[id]}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="space-y-3">
          {provider === 'beemove' && (
            <p className="text-sm text-amber-800">
              การเชื่อมต่อ Bee Move ใช้ API Key เดียว โดย endpoint
              สร้างพัสดุและลิงก์ติดตามยังรอการยืนยันจากผู้ให้บริการ
            </p>
          )}
          <label className="block text-sm font-medium">
            API Base URL
            <input
              className={field}
              type="url"
              required
              placeholder="https://api.example.com/v1"
              value={draft.api_endpoint}
              disabled={busy || provider === 'beemove'}
              onChange={(event) => setDraft({ api_endpoint: event.target.value })}
            />
          </label>
          {(
            [
              ['api_key', 'API Key'],
              ['secret_key', 'Secret Key'],
              ['token', 'Access Token'],
              ['merchant_id', 'Merchant ID'],
            ] as const
          )
            .filter(([key]) => provider !== 'beemove' || key === 'api_key')
            .map(([key, label]) => (
              <label key={key} className="block text-sm font-medium">
                {label}
                <input
                  className={field}
                  type="password"
                  autoComplete="new-password"
                  value={draft[key]}
                  disabled={busy}
                  placeholder={
                    key === 'merchant_id'
                      ? 'ไม่บังคับ'
                      : draft.credentials_configured
                        ? 'ตั้งค่าแล้ว — เว้นว่างเพื่อใช้ค่าปัจจุบัน'
                        : 'กรอก credential'
                  }
                  onChange={(event) => setDraft({ [key]: event.target.value })}
                />
              </label>
            ))}
          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">ข้อมูลผู้ส่งของค่ายนี้</legend>
            <label className="block text-sm font-medium">
              ชื่อผู้ส่ง
              <input
                className={field}
                value={draft.sender_name}
                disabled={busy}
                onChange={(event) => setDraft({ sender_name: event.target.value })}
              />
            </label>
            <label className="mt-2 block text-sm font-medium">
              เบอร์โทรผู้ส่ง
              <input
                className={field}
                value={draft.sender_phone}
                disabled={busy}
                onChange={(event) => setDraft({ sender_phone: event.target.value })}
              />
            </label>
            <label className="mt-2 block text-sm font-medium">
              ที่อยู่ผู้ส่ง
              <textarea
                className={field}
                rows={2}
                value={draft.sender_address}
                disabled={busy}
                onChange={(event) => setDraft({ sender_address: event.target.value })}
              />
            </label>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              น้ำหนักพัสดุ (กก.)
              <input
                className={field}
                type="number"
                min="0.001"
                max="100"
                step="0.001"
                value={draft.weight_kg}
                disabled={busy}
                onChange={(event) => setDraft({ weight_kg: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium">
              Tracking URL Template
              <input
                className={field}
                type="url"
                placeholder="https://track.example.com/{tracking_number}"
                value={draft.tracking_url_template}
                disabled={busy}
                onChange={(event) => setDraft({ tracking_url_template: event.target.value })}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_active}
              disabled={busy}
              onChange={(event) => setDraft({ is_active: event.target.checked })}
            />
            เปิดใช้งานผู้ให้บริการนี้
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_default}
              disabled={busy || !draft.is_active}
              onChange={(event) => setDraft({ is_default: event.target.checked })}
            />
            ใช้เป็นขนส่งเริ่มต้นของร้าน
          </label>
        </div>
        <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          Credential ถูกเข้ารหัสก่อนบันทึกและไม่ถูกส่งกลับมาแสดงอีก การเชื่อมต่อใช้ Generic DMove
          API Contract: GET /health และ POST /parcels ส่ง Authorization: Bearer และคาดหวัง
          tracking_number กับ label_url ผู้ให้บริการที่มี API ต่างรูปแบบต้องมี adapter
          เฉพาะก่อนใช้งาน
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={button} disabled={busy} onClick={onClose}>
            ปิด
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !draft.api_endpoint}
            onClick={() => void submit('test_integration')}
          >
            ทดสอบการเชื่อมต่อ
          </button>
          <button
            type="button"
            className={primary}
            disabled={busy || !draft.api_endpoint || (draft.is_default && !draft.is_active)}
            onClick={() => void submit('save_integration')}
          >
            {busy ? 'กำลังบันทึก…' : 'บันทึกการเชื่อมต่อ'}
          </button>
        </div>
      </div>
    </SessionDialog>
  )
}
