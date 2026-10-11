'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Bot, Coins, KeyRound, Landmark, MessageSquareReply, Save, Store, Target } from 'lucide-react'
import { BankLogo } from '@/components/BankLogo'
import { FacebookIcon } from '@/components/ui/FacebookIcon'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { BANKS } from '@/lib/banks'
import type { PageProfile } from '@/lib/facebook'
import type { TenantRole, TenantRow } from '@/lib/types'
import { apiError, cn } from '@/lib/utils'

const input =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500'

/**
 * Create a tenant (tenant = null, platform admins only) or edit the active one.
 * staff: automation switches only · owner: every shop setting · admin: also the credit quota.
 * The server enforces the same split (PATCH /api/tenants/[id]).
 */
export function TenantSettingsForm({
  tenant,
  pages,
  isFirst,
  role,
}: {
  tenant: TenantRow | null
  pages: PageProfile[]
  isFirst: boolean
  role: TenantRole
}) {
  const router = useRouter()
  const isOwner = role === 'owner' || role === 'admin'
  const isAdmin = role === 'admin'
  const [name, setName] = useState(tenant?.name ?? '')
  const [pageId, setPageId] = useState(tenant?.page_id ?? '')
  const [pageToken, setPageToken] = useState('') // write-only: the saved token is never sent back
  const [bankCode, setBankCode] = useState(tenant?.bank_code ?? 'KBANK')
  const [accountName, setAccountName] = useState(tenant?.account_name ?? '')
  const [accountNumber, setAccountNumber] = useState(tenant?.account_number ?? '')
  const [expected, setExpected] = useState(tenant?.expected_amount != null ? String(tenant.expected_amount) : '')
  const [autoVerify, setAutoVerify] = useState(tenant?.auto_verify_enabled ?? true)
  const [autoReply, setAutoReply] = useState(tenant?.auto_reply_enabled ?? true)
  const [quota, setQuota] = useState(String(tenant?.slip_quota ?? 500))
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string; warnings?: string[] } | null>(null)

  const promptPay = bankCode === 'PROMPTPAY'
  const linkedPage = pages.find((p) => p.id === tenant?.page_id)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setResult(null)
    // only what this role may change: the API refuses the rest
    const body: Record<string, unknown> = { auto_verify_enabled: autoVerify, auto_reply_enabled: autoReply }
    if (isOwner) {
      Object.assign(body, {
        name,
        page_id: pageId,
        bank_code: bankCode,
        account_name: accountName,
        account_number: accountNumber,
        expected_amount: expected,
      })
      if (pageToken.trim()) body.page_access_token = pageToken.trim()
    }
    if (isAdmin) body.slip_quota = Number(quota)
    try {
      const res = await fetch(tenant ? `/api/tenants/${tenant.id}` : '/api/tenants', {
        method: tenant ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await apiError(res))
      const { tenant: saved, warnings = [] } = (await res.json()) as { tenant: TenantRow; warnings?: string[] }
      if (!tenant) {
        // switch to the new tenant right away
        await fetch('/api/tenants/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: saved.id }) })
        router.replace('/settings')
      }
      // the server may fill the Page ID in from the token
      setPageId(saved.page_id ?? '')
      setPageToken('')
      setResult({ ok: true, text: tenant ? 'บันทึกการตั้งค่าแล้ว' : 'สร้างร้านค้าแล้ว', warnings })
      router.refresh()
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="mx-auto w-full max-w-4xl space-y-6 p-4 pb-28 md:p-8 md:pb-28">
      <PageHeader
        title={tenant ? 'ตั้งค่าร้านค้า & บัญชีธนาคาร' : isFirst ? 'สร้างร้านค้าแรก' : 'เพิ่มร้านค้าใหม่'}
        description={tenant ? `การตั้งค่าของ ${tenant.name} ใช้กับสลิปทุกใบที่ส่งเข้าเพจนี้` : 'ผูกเพจ Facebook กับบัญชีรับเงิน เพื่อให้ระบบตรวจสลิปของร้านนี้ได้'}
      />

      {!isOwner && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          บัญชีพนักงานเปลี่ยนได้เฉพาะระบบอัตโนมัติ การตั้งค่าอื่นแก้ได้โดยเจ้าของร้าน
        </p>
      )}

      {/* owner-only settings: a disabled fieldset disables every control inside */}
      <fieldset disabled={!isOwner} className="min-w-0 space-y-6">
      <Card>
        <CardHeader title={<Title icon={Store}>ข้อมูลร้านค้า</Title>} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="ชื่อร้านค้า" required>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="เช่น ร้านเสื้อผ้า Live สด" />
          </Field>
          <Field label="Facebook Page ID" hint={linkedPage && linkedPage.name !== `เพจ ${linkedPage.id}` ? `เชื่อมกับเพจ ${linkedPage.name} แล้ว` : 'เว้นว่างได้: ระบบอ่านจาก Page Access Token ให้'}>
            <div className="relative">
              <FacebookIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#1877f2]" />
              <input
                className={cn(input, 'pl-9 font-mono')}
                value={pageId}
                onChange={(e) => setPageId(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="เช่น 102938475610293"
              />
            </div>
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Page Access Token"
              hint={
                tenant?.page_token_set
                  ? 'บันทึก token แล้ว (ไม่แสดงเพื่อความปลอดภัย) ใส่ใหม่เมื่อต้องการเปลี่ยน · เปลี่ยน Page ID โดยไม่ใส่ token ใหม่ = ลบ token เดิม'
                  : 'ใช้ตอบแชท ส่งการ์ดยืนยัน และตอบคอมเมนต์ของเพจนี้ (ต้องมีสิทธิ์ pages_messaging, pages_manage_engagement)'
              }
            >
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  className={cn(input, 'pl-9 font-mono')}
                  type="password"
                  autoComplete="off"
                  value={pageToken}
                  onChange={(e) => setPageToken(e.target.value)}
                  placeholder={tenant?.page_token_set ? '•••••••• (ตั้งค่าแล้ว)' : 'EAAG...'}
                />
              </div>
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={<Title icon={Landmark}>บัญชีรับเงิน</Title>} description="สลิปต้องโอนเข้าบัญชีนี้เท่านั้น (ใช้ตรวจ wrong_receiver)" />
        <div className="space-y-5 p-5">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-slate-600">ธนาคาร</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BANKS.map((b) => (
                <label
                  key={b.code}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-xl p-2.5 text-xs ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500',
                    bankCode === b.code ? 'bg-emerald-50/60 font-medium text-slate-900 ring-2 ring-emerald-500' : 'text-slate-600 ring-slate-200 hover:ring-slate-300',
                  )}
                >
                  <input type="radio" name="bank" value={b.code} checked={bankCode === b.code} onChange={() => setBankCode(b.code)} className="sr-only" />
                  <BankLogo code={b.code} />
                  <span className="leading-tight">{b.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ชื่อบัญชี">
              <input className={input} value={accountName} onChange={(e) => setAccountName(e.target.value)} maxLength={120} placeholder="ชื่อ-นามสกุล / ชื่อบริษัท" />
            </Field>
            <Field label={promptPay ? 'เบอร์โทร / เลขบัตรประชาชน (พร้อมเพย์)' : 'เลขที่บัญชี'} required hint="ตัวเลขเท่านั้น ใส่ขีดหรือเว้นวรรคได้">
              <input
                className={cn(input, 'font-mono')}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                required
                inputMode="numeric"
                placeholder={promptPay ? '0812345678' : '123-4-56789-0'}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={<Title icon={Target}>ยอดที่คาดหวัง</Title>} description="ยอดมัดจำ / ยอดสินค้าที่สลิปต้องตรง ปล่อยว่างถ้ายอดแต่ละออเดอร์ไม่เท่ากัน" />
        <div className="p-5 sm:w-1/2">
          <Field label="ยอดเงิน (บาท)">
            <input className={input} type="number" min="0.01" step="0.01" inputMode="decimal" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="ไม่ตรวจยอด" />
          </Field>
          <p className="mt-2 text-[11px] text-slate-400">ลูกค้าที่มีออเดอร์ CF ค้างชำระ ระบบใช้ยอดรวมของออเดอร์แทนค่านี้</p>
        </div>
      </Card>
      </fieldset>

      <Card>
        <CardHeader title={<Title icon={Bot}>ระบบอัตโนมัติ</Title>} />
        <div className="divide-y divide-slate-100">
          <ToggleRow
            icon={Bot}
            title="SlipOK Auto-Pilot (ตรวจสลิปอัตโนมัติ)"
            description="ตรวจรูปสลิปที่ลูกค้าส่งในแชททันที ปิดแล้วแอดมินกดตรวจเองจากกล่องข้อความ"
            checked={autoVerify}
            onChange={setAutoVerify}
          />
          <ToggleRow
            icon={MessageSquareReply}
            title="ตอบกลับอัตโนมัติ"
            description="บอทตอบแชท และส่งการ์ด 'ชำระเงินสำเร็จ' เมื่อสลิปถูกต้อง (ปิดรายแชทได้ในกล่องข้อความ)"
            checked={autoReply}
            onChange={setAutoReply}
          />
        </div>
      </Card>

      <Card id="credits">
        <CardHeader
          title={<Title icon={Coins}>เครดิตตรวจสลิป</Title>}
          description={`ตรวจ 1 สลิป ใช้ 1 เครดิต (คืนให้อัตโนมัติถ้า SlipOK ขัดข้อง) เมื่อเครดิตหมดระบบจะหยุดเรียก SlipOK${isAdmin ? '' : ' · เติมเครดิตได้โดยติดต่อผู้ดูแลแพลตฟอร์ม'}`}
        />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          {isAdmin ? (
            <Field label="โควตาทั้งหมด">
              <input className={input} type="number" min={0} step={1} value={quota} onChange={(e) => setQuota(e.target.value)} required />
            </Field>
          ) : (
            <Stat label="โควตาทั้งหมด" value={tenant?.slip_quota ?? 0} />
          )}
          <Stat label="ใช้ไปแล้ว" value={tenant?.slip_used ?? 0} />
          <Stat label="คงเหลือ" value={Math.max(Number(quota || 0) - (tenant?.slip_used ?? 0), 0)} />
        </div>
      </Card>

      {/* sticky save bar */}
      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-lg backdrop-blur">
        {result && (
          <div role="status" className="mr-auto min-w-0 px-2 text-sm">
            <p className={result.ok ? 'text-emerald-700' : 'text-rose-700'}>{result.text}</p>
            {/* saved, but some features won't work with this token (missing permissions, expiry) */}
            {result.warnings?.map((w) => (
              <p key={w} className="mt-0.5 text-xs text-amber-700">
                ⚠ {w}
              </p>
            ))}
          </div>
        )}
        <Button type="submit" loading={saving}>
          {!saving && <Save className="h-4 w-4" aria-hidden />}
          {tenant ? 'บันทึกการตั้งค่า' : 'สร้างร้านค้า'}
        </Button>
      </div>
    </form>
  )
}

function Title({ icon: Icon, children }: { icon: typeof Store; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-slate-400" aria-hidden />
      {children}
    </span>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold tabular-nums">{value.toLocaleString('th-TH')}</p>
    </div>
  )
}

function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: typeof Store
  title: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start gap-4 p-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={cn(
          'inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600',
          checked ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      >
        <span className={cn('h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
      </button>
    </div>
  )
}
