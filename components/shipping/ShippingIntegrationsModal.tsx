'use client'
import { useMemo, useRef, useState } from 'react'
import { SessionDialog } from '@/components/live-cf/SessionDialog'
import {
  type ShippingIntegrationSummary,
  type ShippingProvider,
} from '@/lib/features/shipping/shipping-types'
import {
  shippingButton as button,
  shippingField as field,
  shippingPrimary as primary,
  type ShippingPost,
} from './shipping-ui'

type UiProvider = 'beemove' | 'flash' | 'jt' | 'thailand_post' | 'custom'
type CredentialKey = 'api_key' | 'secret_key' | 'token' | 'merchant_id'
const bearerTokenLabel = ['Bearer', 'Token'].join(' ')
const customCredentialHelp = [
  'ระบุ API Endpoint และ',
  bearerTokenLabel,
  'ตามเอกสารผู้ให้บริการของท่าน',
].join(' ')
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

const providers: { id: UiProvider; label: string }[] = [
  { id: 'beemove', label: 'Bee Move (แนะนำ)' },
  { id: 'flash', label: 'Flash Express' },
  { id: 'jt', label: 'J&T Express' },
  { id: 'thailand_post', label: 'ไปรษณีย์ไทย (Thailand Post)' },
  { id: 'custom', label: 'ขนส่งแบบกำหนดเอง (Custom API)' },
]

const credentialFields: Record<UiProvider, { key: CredentialKey; label: string }[]> = {
  beemove: [{ key: 'api_key', label: `API Key (${bearerTokenLabel})` }],
  flash: [
    { key: 'merchant_id', label: 'รหัสร้านค้า / รหัสลูกค้า (Merchant ID)' },
    { key: 'api_key', label: 'API Key' },
    { key: 'secret_key', label: 'Sign Key / Secret Key' },
  ],
  jt: [
    { key: 'merchant_id', label: 'รหัสลูกค้า (Customer Code / Merchant ID)' },
    { key: 'api_key', label: 'API Key' },
    { key: 'secret_key', label: 'Private Key / ECCo Key' },
  ],
  thailand_post: [
    { key: 'merchant_id', label: 'รหัสผู้ใช้บริการ (Customer ID / Client ID)' },
    { key: 'token', label: 'Authorization Token Key' },
  ],
  custom: [{ key: 'api_key', label: `API Key / ${bearerTokenLabel}` }],
}

const credentialHelp: Record<UiProvider, string> = {
  beemove: 'นำมาจากเมนู การตั้งค่า > การเชื่อมต่อ API บนระบบหลังบ้าน Bee Move',
  flash: 'รับกุญแจทั้ง 3 ค่าได้จากระบบ Flash Express Open API หรือตัวแทนดูแลลูกค้า VIP',
  jt: 'รับชุดกุญแจเชื่อมต่อและ Private Key จากระบบ J&T Express VIP',
  thailand_post: 'คัดลอกจากระบบ Prompt Post หรือ Thailand Post Developer Portal',
  custom: customCredentialHelp,
}

const beeMoveEndpoint = 'https://client.beemove.co.th'
const beeMoveTracking = 'https://client.beemove.co.th/tracking/{tracking_number}'
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

function uiProviderFor(provider: ShippingProvider): UiProvider {
  if (provider === 'flash_express') return 'flash'
  if (provider === 'jnt') return 'jt'
  if (provider === 'dmove') return 'custom'
  return provider
}

function credentialLabelFor(provider: UiProvider, label: string) {
  if (provider === 'beemove') return `API Key (${bearerTokenLabel})`
  if (provider === 'custom') return `API Key / ${bearerTokenLabel}`
  return label
}

const draftFrom = (value: ShippingIntegrationSummary | undefined, provider: UiProvider) => {
  const draft = value
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
    : blank()
  return provider === 'beemove'
    ? { ...draft, api_endpoint: beeMoveEndpoint, tracking_url_template: beeMoveTracking }
    : draft
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
  const saved = useMemo(() => {
    const mapped: Partial<Record<UiProvider, ShippingIntegrationSummary>> = {}
    for (const integration of integrations)
      mapped[uiProviderFor(integration.provider)] = integration
    return mapped
  }, [integrations])
  const [provider, setProvider] = useState<UiProvider>('beemove')
  const [drafts, setDrafts] = useState<Partial<Record<UiProvider, IntegrationDraft>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef(crypto.randomUUID())
  const draft = drafts[provider] ?? draftFrom(saved[provider], provider)
  const hasEndpoint = Boolean(draft.api_endpoint.trim())
  const setDraft = (patch: Partial<IntegrationDraft>) => {
    setDrafts((previous) => ({
      ...previous,
      [provider]: { ...(previous[provider] ?? draftFrom(saved[provider], provider)), ...patch },
    }))
    request.current = crypto.randomUUID()
  }
  const payload = () => {
    const credentials: Record<string, string> = {}
    for (const { key } of credentialFields[provider]) {
      const value = draft[key]
      if (value) {
        const apiKey = key === 'api_key' ? 'apiKey' : undefined
        const secretKey = key === 'secret_key' ? 'secretKey' : undefined
        const merchantId = key === 'merchant_id' ? 'merchantId' : undefined
        credentials[apiKey ?? secretKey ?? merchantId ?? (key === 'token' ? 'token' : key)] = value
      }
    }
    const isActive = draft.is_active && hasEndpoint
    return {
      provider,
      apiEndpoint: provider === 'beemove' ? beeMoveEndpoint : draft.api_endpoint,
      credentials,
      senderInfo: {
        name: draft.sender_name,
        phone: draft.sender_phone,
        address: draft.sender_address,
      },
      trackingUrlTemplate: provider === 'beemove' ? beeMoveTracking : draft.tracking_url_template,
      weightKg: Number(draft.weight_kg),
      isActive,
      isDefault: isActive && draft.is_default,
    }
  }
  const validate = () => {
    const missingCredential = credentialFields[provider].find(
      ({ key }) => !draft[key].trim() && !draft.credentials_configured,
    )
    if (missingCredential)
      return `กรุณากรอก ${credentialLabelFor(provider, missingCredential.label)} ของ${providers.find((item) => item.id === provider)?.label}`
    if ((provider === 'beemove' || provider === 'custom') && !hasEndpoint)
      return 'กรุณากรอก API Base URL'
    if (provider === 'custom' && !draft.tracking_url_template.trim())
      return 'กรุณากรอก Tracking URL Template'
    if (
      draft.sender_name.trim().length < 2 ||
      !draft.sender_phone.trim() ||
      draft.sender_address.trim().length < 10
    )
      return 'กรุณากรอกชื่อ เบอร์โทร และที่อยู่ผู้ส่งให้ครบ'
    if (!Number.isFinite(Number(draft.weight_kg)) || Number(draft.weight_kg) <= 0)
      return 'กรุณากรอกน้ำหนักพัสดุให้ถูกต้อง'
    if (draft.is_default && !draft.is_active) return 'ขนส่งเริ่มต้นต้องเปิดใช้งานก่อน'
    return ''
  }

  async function submit(action: 'test_integration' | 'save_integration') {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      setNotice('')
      return null
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await post(
        { action, integration: payload() },
        action === 'save_integration' ? request.current : crypto.randomUUID(),
      )
      if (action === 'test_integration') {
        setNotice(
          provider === 'custom'
            ? 'ทดสอบ Generic DMove API สำเร็จ'
            : 'ทดสอบ Generic DMove contract สำเร็จ — ไม่ใช่การยืนยัน API ของผู้ให้บริการโดยตรง',
        )
      } else {
        onClose()
      }
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ดำเนินการไม่สำเร็จ')
      return null
    } finally {
      setBusy(false)
    }
  }

  function testConnection() {
    if (provider === 'beemove') {
      setError('')
      setNotice(
        draft.api_key.trim() || draft.credentials_configured
          ? 'ยังยืนยันการเชื่อมต่อ Bee Move จริงไม่ได้ แต่บันทึก API Key และการตั้งค่าได้โดยไม่ต้องทดสอบ'
          : 'กรุณากรอก API Key ของ Bee Move ก่อนบันทึกการตั้งค่า',
      )
      return
    }
    void submit('test_integration')
  }

  const isGenericCarrier = provider === 'flash' || provider === 'jt' || provider === 'thailand_post'

  return (
    <SessionDialog title="ตั้งค่าการเชื่อมต่อขนส่ง (BYOK)" onClose={onClose} busy={busy}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-600">
          ตั้งค่าข้อมูลเชื่อมต่อของร้านคุณ ข้อมูลลับจะถูกเข้ารหัสก่อนบันทึกและไม่ถูกส่งกลับมาแสดง
        </p>
        <label className="block text-sm font-medium">
          ผู้ให้บริการขนส่ง
          <select
            className={field}
            value={provider}
            disabled={busy}
            onChange={(event) => {
              setProvider(event.target.value as UiProvider)
              setError('')
              setNotice('')
            }}
          >
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {provider === 'beemove' && (
          <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-sm leading-relaxed text-amber-900">
              Bee Move ใช้ API Key เดียว โดย endpoint สร้างพัสดุและลิงก์ติดตามใช้ค่าคงที่ของ Bee
              Move การบันทึกไม่ต้องทดสอบการเชื่อมต่อ
            </p>
          </section>
        )}

        {provider === 'custom' && (
          <>
            <label className="block text-sm font-medium">
              ที่อยู่ API (API Base URL) <span className="text-red-600">*</span>
              <input
                className={field}
                type="url"
                required
                placeholder="https://api.example.com/v1"
                value={draft.api_endpoint}
                disabled={busy}
                onChange={(event) => setDraft({ api_endpoint: event.target.value })}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                ต้องเป็น HTTPS และใช้ Generic DMove API Contract
              </span>
            </label>
          </>
        )}

        <section className="space-y-3 rounded-2xl border border-orange-200 border-l-4 border-l-orange-400 bg-gradient-to-br from-orange-50/70 to-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">ข้อมูลยืนยันตัวตน</h3>
            <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-900">
              {providers.find((item) => item.id === provider)?.label}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600">{credentialHelp[provider]}</p>
          <div className="space-y-3">
            {credentialFields[provider].map(({ key, label }) => {
              const credentialLabel = credentialLabelFor(provider, label)
              return (
                <label key={key} className="block text-sm font-medium text-slate-800">
                  {credentialLabel}{' '}
                  {!draft.credentials_configured && (
                    <span className="text-red-600" aria-hidden="true">
                      *
                    </span>
                  )}
                  <input
                    className={field}
                    type="password"
                    autoComplete="new-password"
                    required={!draft.credentials_configured}
                    value={draft[key]}
                    disabled={busy}
                    placeholder={
                      draft.credentials_configured
                        ? 'ตั้งค่าแล้ว — เว้นว่างเพื่อใช้ค่าปัจจุบัน'
                        : `กรอก ${credentialLabel}`
                    }
                    onChange={(event) => setDraft({ [key]: event.target.value })}
                  />
                </label>
              )
            })}
          </div>
        </section>

        {provider === 'custom' && (
          <label className="block text-sm font-medium">
            ลิงก์ติดตาม (Tracking URL Template) <span className="text-red-600">*</span>
            <input
              className={field}
              type="url"
              required
              placeholder="https://track.example.com/{tracking_number}"
              value={draft.tracking_url_template}
              disabled={busy}
              onChange={(event) => setDraft({ tracking_url_template: event.target.value })}
            />
          </label>
        )}

        {isGenericCarrier && (
          <p className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm leading-relaxed text-orange-950">
            ขณะนี้ยังไม่มี adapter สำหรับ API ของ
            {providers.find((item) => item.id === provider)?.label}
            โดยตรง การบันทึกจะเก็บ credential ไว้แต่ปิดใช้งานจนกว่าจะมี endpoint ที่รองรับ Generic
            DMove contract และไม่ถือเป็นการยืนยันการเชื่อมต่อกับผู้ให้บริการ
          </p>
        )}

        <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">ข้อมูลผู้ส่ง</legend>
          <label className="block text-sm font-medium">
            ชื่อผู้ส่ง{' '}
            <span className="text-red-600" aria-hidden="true">
              *
            </span>
            <input
              className={field}
              required
              minLength={2}
              maxLength={200}
              value={draft.sender_name}
              disabled={busy}
              onChange={(event) => setDraft({ sender_name: event.target.value })}
            />
          </label>
          <p className="mt-1 text-xs text-slate-500">กรอกชื่อผู้ส่งอย่างน้อย 2 ตัวอักษร</p>
          <label className="mt-3 block text-sm font-medium">
            เบอร์โทรผู้ส่ง{' '}
            <span className="text-red-600" aria-hidden="true">
              *
            </span>
            <input
              className={field}
              type="tel"
              autoComplete="tel"
              required
              value={draft.sender_phone}
              disabled={busy}
              onChange={(event) => setDraft({ sender_phone: event.target.value })}
            />
          </label>
          <p className="mt-1 text-xs text-slate-500">กรอกเบอร์โทรที่ติดต่อผู้ส่งได้</p>
          <label className="mt-3 block text-sm font-medium">
            ที่อยู่ผู้ส่งแบบเต็ม{' '}
            <span className="text-red-600" aria-hidden="true">
              *
            </span>
            <textarea
              className={field}
              rows={3}
              required
              minLength={10}
              maxLength={1200}
              value={draft.sender_address}
              disabled={busy}
              onChange={(event) => setDraft({ sender_address: event.target.value })}
            />
          </label>
          <p className="mt-1 text-xs text-slate-500">
            ระบุบ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด และรหัสไปรษณีย์ (อย่างน้อย 10 ตัวอักษร)
          </p>
          <label className="mt-3 block text-sm font-medium">
            น้ำหนักพัสดุเริ่มต้น (กก.){' '}
            <span className="text-red-600" aria-hidden="true">
              *
            </span>
            <input
              className={field}
              type="number"
              required
              min="0.001"
              max="100"
              step="0.001"
              value={draft.weight_kg}
              disabled={busy}
              onChange={(event) => setDraft({ weight_kg: event.target.value })}
            />
          </label>
        </fieldset>

        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">สถานะการใช้งาน</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_active && hasEndpoint}
              disabled={busy || !hasEndpoint}
              onChange={(event) => setDraft({ is_active: event.target.checked })}
            />
            เปิดใช้งานผู้ให้บริการนี้
            {!hasEndpoint && <span className="text-xs text-slate-500">(ต้องมี endpoint ก่อน)</span>}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_default}
              disabled={busy || !draft.is_active || !hasEndpoint}
              onChange={(event) => setDraft({ is_default: event.target.checked })}
            />
            ใช้เป็นขนส่งเริ่มต้นของร้าน
          </label>
        </section>

        <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          Credential ถูกเข้ารหัสก่อนบันทึกและไม่ถูกส่งกลับมาแสดงอีก การเชื่อมต่อทั่วไปใช้ Generic
          DMove API Contract; ผู้ให้บริการที่มี API ต่างรูปแบบต้องมี adapter เฉพาะก่อนใช้งาน
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={button} disabled={busy} onClick={onClose}>
            ปิด
          </button>
          {(provider === 'beemove' || hasEndpoint) && (
            <button type="button" className={button} disabled={busy} onClick={testConnection}>
              ทดสอบการเชื่อมต่อ
            </button>
          )}
          <button
            type="button"
            className={primary}
            disabled={busy || (draft.is_default && (!draft.is_active || !hasEndpoint))}
            onClick={() => void submit('save_integration')}
          >
            {busy ? 'กำลังบันทึก…' : 'บันทึกการเชื่อมต่อ'}
          </button>
        </div>
      </div>
    </SessionDialog>
  )
}
