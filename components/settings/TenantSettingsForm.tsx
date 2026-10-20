'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { Bot, CheckCircle2, Coins, KeyRound, Landmark, LockKeyhole, MessageSquareReply, RefreshCw, Save, Store } from 'lucide-react'
import { canUseAutoSlip, PLANS, type Billing } from '@/lib/features/billing/plans'
import { BankSelector } from '@/components/banking/BankSelector'
import { BankAccountsManager } from '@/components/settings/BankAccountsManager'
import { FacebookIcon } from '@/components/ui/FacebookIcon'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import type { PageProfile } from '@/lib/integrations/facebook/client'
import type { ConnectedPageInfo } from '@/lib/tenant'
import type { PageConnectionStatus, TenantRole, TenantRow } from '@/lib/types'
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
  billing,
  slipCredits,
  pages,
  connected = null,
  isFirst,
  role,
  section = 'create',
  connectionStatus = 'unverified',
  embedded = false,
  automationOnly = false,
  slipAccess,
}: {
  tenant: TenantRow | null
  billing: Billing | null
  slipCredits: { quota: number; used: number }
  pages: PageProfile[]
  /** new tenant for a Page connected with Facebook: its token is filled in by the server */
  connected?: ConnectedPageInfo | null
  isFirst: boolean
  role: TenantRole
  section?: 'facebook' | 'bank-slip' | 'create'
  connectionStatus?: PageConnectionStatus
  embedded?: boolean
  automationOnly?: boolean
  slipAccess?: boolean
}) {
  const router = useRouter()
  const isOwner = role === 'owner' || role === 'admin'
  const isAdmin = role === 'admin'
  const showFacebook = section !== 'bank-slip'
  const showBankSlip = section !== 'facebook'
  const [editingPage, setEditingPage] = useState(section === 'create')
  const [name, setName] = useState(tenant?.name ?? connected?.name ?? '')
  const [pageId, setPageId] = useState(tenant?.page_id ?? connected?.page_id ?? '')
  const [pageToken, setPageToken] = useState('') // write-only: the saved token is never sent back
  const [bankCode, setBankCode] = useState(tenant?.bank_code ?? 'KBANK')
  const [accountName, setAccountName] = useState(tenant?.account_name ?? '')
  const [accountNumber, setAccountNumber] = useState(tenant?.account_number ?? '')
  const creditsLeft = Math.max(slipCredits.quota - slipCredits.used, 0)
  const slipAllowed = slipAccess ?? (isAdmin || (billing !== null && canUseAutoSlip(billing, creditsLeft)))
  const [autoVerifyDraft, setAutoVerify] = useState(tenant?.auto_verify_enabled ?? false)
  const autoVerify = autoVerifyDraft
  const [autoReply, setAutoReply] = useState(tenant?.auto_reply_enabled ?? true)
  const [quota, setQuota] = useState(String(tenant ? tenant.slip_quota : 500))
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string; warnings?: string[] } | null>(null)

  const promptPay = bankCode === 'PROMPTPAY'
  const linkedPage = pages.find((p) => p.id === tenant?.page_id)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (tenant?.page_id && pageId !== tenant.page_id && !pageToken.trim()
      && !window.confirm('การเปลี่ยน Page ID โดยไม่ใส่ข้อมูลเชื่อมต่อใหม่จะลบการเชื่อมต่อเพจเดิม ต้องการดำเนินการต่อหรือไม่?')) return
    setSaving(true)
    setResult(null)
    const body: Record<string, unknown> = {}
    if (showBankSlip) {
      if (autoReply !== (tenant?.auto_reply_enabled ?? true)) body.auto_reply_enabled = autoReply
      if (autoVerify !== (tenant?.auto_verify_enabled ?? false) && (!autoVerify || slipAllowed)) body.auto_verify_enabled = autoVerify
    }
    if (isOwner) {
      if (showFacebook) {
        if (!tenant || name !== tenant.name) body.name = name
        if (!tenant || pageId !== (tenant.page_id ?? '')) body.page_id = pageId
        if (pageToken.trim()) body.page_access_token = pageToken.trim()
      }
      if (showBankSlip && !tenant) Object.assign(body, { bank_code: bankCode, account_name: accountName, account_number: accountNumber })
    }
    if (isAdmin && showBankSlip && Number(quota) !== (tenant?.slip_quota ?? 500)) body.slip_quota = Number(quota)
    if (Object.keys(body).length === 0) {
      setResult({ ok: true, text: 'ไม่มีการเปลี่ยนแปลงการตั้งค่า' })
      setSaving(false)
      return
    }
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
        const selected = await fetch('/api/tenants/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: saved.id }) })
        if (!selected.ok) throw new Error(await apiError(selected))
        router.replace('/settings')
      }
      // the server may fill the Page ID in from the token
      setPageId(saved.page_id ?? '')
      setPageToken('')
      setEditingPage(false)
      setResult({ ok: true, text: tenant ? 'บันทึกการตั้งค่าแล้ว' : 'สร้างร้านค้าแล้ว', warnings })
      router.refresh()
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className={cn(embedded ? 'w-full min-w-0 space-y-6 pb-6' : 'mx-0 w-full min-w-0 max-w-none space-y-6 pb-28 p-4 md:p-8 md:pb-28')}>
      {!embedded && <PageHeader
        title={tenant ? (showFacebook ? 'ข้อมูลร้านค้า & เชื่อมต่อเพจ' : 'บัญชีรับเงิน & ตรวจสลิป') : isFirst ? 'สร้างร้านค้าแรก' : 'เพิ่มร้านค้าใหม่'}
        description={tenant ? `การตั้งค่าของ ${tenant.name}` : 'เชื่อมต่อเพจและตั้งค่าบัญชีรับเงินสำหรับร้านใหม่'}
        action={tenant ? <Link href={showFacebook ? '/slips?tab=settings' : '/settings'} className="text-sm font-medium text-emerald-700 underline">{showFacebook ? 'ตั้งค่าบัญชีรับเงิน & ตรวจสลิป' : 'ตั้งค่า Facebook Page'}</Link> : undefined}
      />}

      {result && (
        <div role={result.ok ? 'status' : 'alert'} aria-live={result.ok ? 'polite' : 'assertive'} className={cn('flex items-start gap-3 rounded-2xl px-5 py-4 text-sm ring-1', result.ok ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-rose-200')}>
          {result.ok && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{result.text}</p>
            {result.ok && tenant && <p className="mt-1 text-xs">บันทึกสำหรับเพจ {tenant.page_name ?? tenant.name} แล้ว</p>}
            {result.warnings?.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-700">{warning}</p>)}
          </div>
          <button type="button" aria-label="ปิดแจ้งเตือน" onClick={() => setResult(null)} className="rounded-lg px-2 py-1 text-xs font-medium hover:bg-white/60">ปิด</button>
        </div>
      )}

      {!isOwner && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          {showBankSlip ? 'บัญชีพนักงานเปลี่ยนได้เฉพาะระบบอัตโนมัติ การตั้งค่าอื่นแก้ได้โดยเจ้าของร้าน' : 'Facebook Page และ Access Token แก้ได้โดยเจ้าของร้านหรือผู้ดูแลแพลตฟอร์ม'}
        </p>
      )}

      {/* owner-only settings: a disabled fieldset disables every control inside */}
      <fieldset disabled={!isOwner} className="min-w-0 space-y-6">
      {showFacebook && (
      <Card className="overflow-hidden rounded-3xl border-orange-100 shadow-lg shadow-orange-100/40">
        {tenant && <>
          <div className="bg-gradient-to-br from-orange-50 via-pink-50 to-white p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {linkedPage?.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={linkedPage.picture} alt={`รูปโปรไฟล์ ${linkedPage.name}`} className="h-20 w-20 rounded-2xl object-cover shadow-sm ring-4 ring-white" />
              ) : <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-white shadow-sm"><FacebookIcon className="h-10 w-10 text-[#1877f2]" /></span>}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-orange-600">Facebook Page</p>
                <h2 className="mt-1 break-words text-xl font-semibold text-slate-900">{linkedPage?.name ?? tenant.page_name ?? tenant.name}</h2>
                <p className="mt-1 break-all text-sm text-slate-500">Page ID: <span className="font-mono">{tenant.page_id ?? 'ยังไม่ได้เลือกเพจ'}</span></p>
                <span className={cn('mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1',
                  connectionStatus === 'verified' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200')}>
                  <FacebookIcon className="h-3.5 w-3.5" />
                  {connectionStatus === 'verified' ? <><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />เชื่อมต่อเรียบร้อยแล้ว</> :
                    connectionStatus === 'missing-page' ? 'ยังไม่ได้เลือกเพจ' : connectionStatus === 'missing-token' ? 'ยังไม่ได้เชื่อมต่อเพจ' :
                    connectionStatus === 'invalid' ? 'กรุณาเชื่อมต่อเพจใหม่' : connectionStatus === 'limited' ? 'เชื่อมต่อแล้ว · สิทธิ์ยังไม่ครบ' : 'ยังยืนยันการเชื่อมต่อไม่ได้'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-orange-100 px-6 py-5">
            <p className="text-xs text-slate-500">ข้อมูลการเชื่อมต่อจัดเก็บอย่างปลอดภัยและไม่แสดงในหน้านี้</p>
            <Button variant="secondary" disabled={!isOwner} aria-expanded={editingPage} aria-controls="facebook-page-editor" onClick={() => setEditingPage(!editingPage)} className="rounded-xl border border-orange-200 text-orange-700">
              <RefreshCw className="h-4 w-4" aria-hidden />{editingPage ? 'ปิดส่วนแก้ไข' : 'จัดการการเชื่อมต่อ'}
            </Button>
          </div>
        </>}
        {editingPage && <div id="facebook-page-editor" className="border-t border-slate-100">
        <CardHeader title={<Title icon={Store}>{tenant ? 'แก้ไขการเชื่อมต่อเพจ' : 'ข้อมูลร้านค้า'}</Title>} />
        {tenant && <div className="px-5 pt-3"><Link href="/select-page" className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2 text-sm font-medium text-[#1877f2]"><FacebookIcon className="h-4 w-4" />เลือกเพจ / เชื่อมต่อผ่าน Facebook</Link></div>}
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
                connected && !tenant
                  ? `ใช้ token จากการเชื่อมต่อ Facebook ของเพจ ${connected.name} ให้อัตโนมัติ เว้นว่างได้`
                  : tenant?.page_token_set
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
        </div>}
      </Card>
      )}
      {showBankSlip && !automationOnly && <>
      {tenant ? <BankAccountsManager key={tenant.id} tenantId={tenant.id} canManage={isOwner} /> : <Card>
        <CardHeader title={<Title icon={Landmark}>บัญชีรับเงิน</Title>} description="สลิปต้องโอนเข้าบัญชีนี้เท่านั้น (ใช้ตรวจ wrong_receiver)" />
        <div className="space-y-5 p-5">
          <BankSelector value={bankCode} onChange={setBankCode} disabled={saving || !isOwner} label="ธนาคาร" />
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
      </Card>}

      </>}
      </fieldset>
      {showBankSlip && <>
      <Card>
        <CardHeader title={<Title icon={Bot}>ระบบอัตโนมัติ</Title>} />
        {!slipAllowed && (
          <div id="slip-upgrade-hint" role="status" className="mx-5 mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            <p className="flex items-center gap-2 font-medium"><LockKeyhole className="h-4 w-4" aria-hidden />ระบบตรวจสลิปอัตโนมัติถูกล็อก</p>
            <p className="mt-1">แพ็กเกจปัจจุบัน: {billing ? PLANS[billing.plan].name : 'Free'} · เครดิตตรวจสลิปคงเหลือ {creditsLeft.toLocaleString('th-TH')}</p>
            {(!billing || !canUseAutoSlip(billing, 1)) && <p className="mt-1">กรุณาอัปเกรดหรือต่ออายุแพ็กเกจ Starter หรือ Pro เพื่อเปิดใช้งาน</p>}
            {creditsLeft === 0 && <p className="mt-1">กรุณาเติมเครดิตตรวจสลิปโดยติดต่อผู้ดูแลแพลตฟอร์ม เครดิตบรอดแคสต์เป็นคนละประเภท</p>}
            <Link href="/billing" className="mt-2 inline-block font-semibold underline">ดูแพ็กเกจ / เติมเครดิต</Link>
          </div>
        )}
        <div className="divide-y divide-slate-100">
          <ToggleRow
            icon={Bot}
            title="ระบบตรวจสอบสลิปอัตโนมัติ"
            description="ตรวจรูปสลิปที่ลูกค้าส่งในแชททันที ปิดแล้วแอดมินกดตรวจเองจากกล่องข้อความ"
            checked={autoVerify}
            disabled={!slipAllowed && !autoVerifyDraft}
            describedBy={!slipAllowed ? 'slip-upgrade-hint' : undefined}
            onChange={(value) => { if (!value || slipAllowed) setAutoVerify(value) }}
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

      {!automationOnly && <Card id="credits">
        <CardHeader
          title={<Title icon={Coins}>เครดิตตรวจสลิป</Title>}
          description={`ตรวจ 1 สลิป ใช้ 1 เครดิต (คืนให้อัตโนมัติถ้าระบบตรวจสอบสลิปขัดข้อง) เมื่อเครดิตหมดระบบจะหยุดตรวจสอบสลิป${isAdmin ? '' : ' · เติมเครดิตได้โดยติดต่อผู้ดูแลแพลตฟอร์ม'}`}
        />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          {isAdmin ? (
            <Field label="โควตาทั้งหมด">
              <input className={input} type="number" min={0} step={1} value={quota} onChange={(e) => setQuota(e.target.value)} required />
            </Field>
          ) : (
            <Stat label="โควตาทั้งหมด" value={slipCredits.quota} />
          )}
          <Stat label="ใช้ไปแล้ว" value={slipCredits.used} />
          <Stat label="คงเหลือ" value={creditsLeft} />
        </div>
      </Card>}
      </>}
      {/* sticky save bar */}
      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-lg backdrop-blur">
        {result && <p className={cn('mr-auto px-2 text-sm', result.ok ? 'text-emerald-700' : 'text-rose-700')}>{result.text}</p>}
        <Button type="submit" size="lg" loading={saving} disabled={!showBankSlip && !isOwner} className={section === 'facebook' ? 'rounded-xl bg-gradient-to-r from-orange-500 to-pink-500 px-6 shadow-lg shadow-orange-200/60 hover:from-orange-600 hover:to-pink-600 focus-visible:outline-orange-500' : undefined}>
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
  disabled = false,
  describedBy,
}: {
  icon: typeof Store
  title: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  describedBy?: string
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
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      >
        <span className={cn('h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
      </button>
    </div>
  )
}
