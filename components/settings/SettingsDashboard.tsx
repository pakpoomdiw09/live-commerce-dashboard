'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Bell,
  Bot,
  Check,
  ChevronRight,
  Globe,
  MessageCircle,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  type LucideIcon,
} from 'lucide-react'
import { TenantSettingsForm } from '@/components/settings/TenantSettingsForm'
import { FacebookIcon } from '@/components/ui/FacebookIcon'
import { Card, PageHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PageProfile } from '@/lib/integrations/facebook/client'
import type { Billing } from '@/lib/features/billing/plans'
import type { PageConnectionStatus, TenantRole, TenantRow } from '@/lib/types'

type TabId = 'overview' | 'facebook' | 'notifications' | 'usage' | 'security'
type Readiness = 'ready' | 'setup' | 'unknown'

const tabs: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'ภาพรวม', icon: SlidersHorizontal },
  { id: 'facebook', label: 'Facebook Page', icon: Store },
  { id: 'notifications', label: 'การแจ้งเตือน', icon: Bell },
  { id: 'usage', label: 'การใช้งาน', icon: Settings2 },
  { id: 'security', label: 'ความปลอดภัย', icon: ShieldCheck },
]

const connectionReadiness = (status: PageConnectionStatus): Readiness => {
  if (status === 'verified') return 'ready'
  if (
    status === 'missing-page' ||
    status === 'missing-token' ||
    status === 'invalid' ||
    status === 'limited'
  )
    return 'setup'
  return 'unknown'
}

function StatusPill({ status, children }: { status: Readiness; children: string }) {
  const style =
    status === 'ready'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'setup'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-slate-100 text-slate-600'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        style,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'ready'
            ? 'bg-emerald-500'
            : status === 'setup'
              ? 'bg-amber-500'
              : 'bg-slate-400',
        )}
      />
      {children}
    </span>
  )
}

function StatusCard({
  title,
  detail,
  status,
  stateLabel,
  icon: Icon,
  href,
  linkLabel,
}: {
  title: string
  detail: string
  status: Readiness
  stateLabel: string
  icon: LucideIcon
  href?: string
  linkLabel?: string
}) {
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <div className="mt-2">
            <StatusPill status={status}>{stateLabel}</StatusPill>
          </div>
          <p className="mt-2 min-h-10 text-xs leading-5 text-slate-500">{detail}</p>
          {href && linkLabel && (
            <Link
              href={href}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:text-orange-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
            >
              {linkLabel}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </Card>
  )
}

export function SettingsDashboard({
  tenant,
  pages,
  role,
  isFirst,
  connectionStatus,
  billing,
  slipCredits,
  slipAccess,
  slipStatusKnown,
  initialTab,
}: {
  tenant: TenantRow
  pages: PageProfile[]
  role: TenantRole
  isFirst: boolean
  connectionStatus: PageConnectionStatus
  billing: Billing | null
  slipCredits: { quota: number; used: number }
  slipAccess: boolean
  slipStatusKnown: boolean
  initialTab?: string
}) {
  const router = useRouter()
  const [tab, setTab] = useState<TabId>(
    tabs.some((item) => item.id === initialTab) ? (initialTab as TabId) : 'overview',
  )
  const [checking, startChecking] = useTransition()
  const page = pages.find((item) => item.id === tenant.page_id)
  const pageStatus = connectionReadiness(connectionStatus)
  const slipStatus: Readiness =
    !billing || !slipStatusKnown
      ? 'unknown'
      : slipAccess && tenant.auto_verify_enabled
        ? 'ready'
        : 'setup'
  const slipLabel =
    !billing || !slipStatusKnown
      ? 'ยังไม่สามารถตรวจสอบสถานะ'
      : slipAccess && tenant.auto_verify_enabled
        ? 'พร้อมใช้งาน'
        : tenant.auto_verify_enabled
          ? 'ต้องตรวจสอบสิทธิ์หรือเครดิต'
          : 'ยังไม่ได้เปิดใช้งาน'
  const slipDetail =
    !billing || !slipStatusKnown
      ? 'ยังอ่านข้อมูลสิทธิ์และเครดิตตรวจสลิปไม่ได้'
      : slipAccess && tenant.auto_verify_enabled
        ? 'เปิดระบบอัตโนมัติและมีสิทธิ์ตรวจสลิป'
        : 'ตรวจสอบสิทธิ์ เครดิต และบัญชีรับเงินที่เปิดใช้งานจากหน้าจัดการสลิป'
  const pageName = page?.name ?? tenant.page_name ?? tenant.name
  const messengerLabel =
    connectionStatus === 'verified'
      ? 'ยังตรวจสอบการรับข้อความไม่ได้'
      : connectionStatus === 'missing-page' || connectionStatus === 'missing-token'
        ? 'ยังไม่ได้เชื่อมต่อ'
        : 'ยังไม่สามารถตรวจสอบสถานะ'
  const messengerDetail =
    connectionStatus === 'verified'
      ? 'สิทธิ์ส่งข้อความของเพจใช้ได้ แต่ระบบยังไม่มีข้อมูลยืนยันการรับข้อความจาก webhook'
      : 'สถานะการรับข้อความจากเพจยังไม่ได้รับการยืนยัน'

  function selectTab(nextTab: TabId) {
    setTab(nextTab)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', nextTab)
    window.history.replaceState(null, '', url)
  }

  function refreshConnection() {
    startChecking(() => router.refresh())
  }

  return (
    <div className="w-full min-w-0 space-y-6 p-4 pb-10 sm:p-6 lg:p-8">
      <PageHeader
        title="ตั้งค่า"
        description="จัดการการเชื่อมต่อและการตั้งค่าพื้นฐานของระบบ SnapBot"
      />

      <div
        role="tablist"
        aria-label="หมวดการตั้งค่า"
        className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-sm"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`settings-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`settings-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const current = tabs.findIndex((item) => item.id === tab)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
              selectTab(tabs[next].id)
              document.getElementById(`settings-tab-${tabs[next].id}`)?.focus()
            }}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 sm:flex-1',
              tab === id
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <section
        id={`settings-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        tabIndex={0}
        className="min-w-0 focus-visible:outline-none"
      >
        {tab === 'overview' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">สถานะระบบ</h2>
              <p className="mt-1 text-sm text-slate-500">
                ข้อมูลจากการเชื่อมต่อและการตั้งค่าของร้านนี้
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              <StatusCard
                title="Facebook Page"
                detail={pageName}
                status={pageStatus}
                stateLabel={
                  connectionStatus === 'verified'
                    ? 'เชื่อมต่อแล้ว'
                    : connectionStatus === 'missing-page'
                      ? 'ยังไม่ได้เลือกเพจ'
                      : connectionStatus === 'missing-token'
                        ? 'ยังไม่ได้เชื่อมต่อ'
                        : connectionStatus === 'limited'
                          ? 'สิทธิ์ยังไม่ครบ'
                          : connectionStatus === 'invalid'
                            ? 'ต้องเชื่อมต่อใหม่'
                            : 'ยังไม่สามารถตรวจสอบสถานะ'
                }
                icon={Store}
                href="/settings?tab=facebook"
                linkLabel="จัดการเพจ"
              />
              <StatusCard
                title="Messenger"
                detail={messengerDetail}
                status={connectionStatus === 'verified' ? 'unknown' : pageStatus}
                stateLabel={messengerLabel}
                icon={MessageCircle}
                href="/settings?tab=security"
                linkLabel="ตรวจสอบสถานะ"
              />
              <StatusCard
                title="ระบบส่งข้อความ"
                detail={
                  connectionStatus === 'verified'
                    ? 'สิทธิ์ส่งข้อความของเพจได้รับการตรวจสอบแล้ว'
                    : 'ต้องเชื่อมต่อเพจและตรวจสอบสิทธิ์ก่อนส่งข้อความ'
                }
                status={pageStatus}
                stateLabel={
                  connectionStatus === 'verified'
                    ? 'พร้อมใช้งาน'
                    : connectionStatus === 'unverified'
                      ? 'ยังไม่สามารถตรวจสอบสถานะ'
                      : 'ต้องตรวจสอบการเชื่อมต่อ'
                }
                icon={Send}
                href={
                  connectionStatus === 'verified'
                    ? '/settings?tab=security'
                    : '/settings?tab=facebook'
                }
                linkLabel={connectionStatus === 'verified' ? 'ดูสิทธิ์การเข้าถึง' : 'ตั้งค่า'}
              />
              <StatusCard
                title="ระบบตรวจสลิป"
                detail={slipDetail}
                status={slipStatus}
                stateLabel={slipLabel}
                icon={Check}
                href="/slips"
                linkLabel="ไปหน้าตรวจสลิป"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  {page?.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={page.picture}
                      alt=""
                      className="h-12 w-12 rounded-xl object-cover ring-1 ring-slate-200"
                    />
                  ) : (
                    <span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-50 text-blue-600">
                      <FacebookIcon className="h-6 w-6" aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900">การเชื่อมต่อ Facebook Page</h3>
                    <p className="truncate text-sm text-slate-500">{pageName}</p>
                  </div>
                  <Link
                    href="/settings?tab=facebook"
                    aria-label="ตั้งค่า Facebook Page"
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-orange-600"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden />
                  </Link>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <StatusPill status={pageStatus}>
                    {connectionStatus === 'verified'
                      ? 'เชื่อมต่อแล้ว'
                      : connectionStatus === 'unverified'
                        ? 'ยังไม่สามารถตรวจสอบสถานะ'
                        : 'ต้องตรวจสอบการเชื่อมต่อ'}
                  </StatusPill>
                  <span className="text-xs text-slate-500">
                    Page ID: {tenant.page_id ?? 'ยังไม่ได้เลือกเพจ'}
                  </span>
                </div>
              </Card>
              <Card className="p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600">
                    <Bot className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900">การตั้งค่าทั่วไป</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      การแจ้งเตือน ภาษา และเขตเวลายังไม่มีการจัดเก็บแยกตามร้าน
                      จึงยังไม่แสดงตัวเลือกที่กดแล้วไม่มีผล
                    </p>
                    <Link
                      href="/settings?tab=usage"
                      className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-orange-700 hover:text-orange-800"
                    >
                      ดูการใช้งานที่ตั้งค่าได้
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === 'facebook' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">การเชื่อมต่อ Facebook Page</h2>
              <p className="mt-1 text-sm text-slate-500">
                ดูสถานะเพจและจัดการการเชื่อมต่อของร้านนี้
              </p>
            </div>
            <TenantSettingsForm
              key={`${tenant.id}-facebook`}
              tenant={tenant}
              billing={billing}
              slipCredits={slipCredits}
              pages={pages}
              isFirst={isFirst}
              role={role}
              section="facebook"
              connectionStatus={connectionStatus}
              embedded
            />
          </div>
        )}

        {tab === 'notifications' && (
          <Card className="p-5 sm:p-7">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600">
                <Bell className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="font-semibold text-slate-900">การแจ้งเตือน</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  ขณะนี้ยังไม่มีการตั้งค่าการแจ้งเตือนที่บันทึกและนำไปใช้งานจริงในระบบ
                  จึงยังไม่มีสวิตช์ให้เปิดหรือปิด
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  เมื่อมีช่องทางแจ้งเตือนรองรับ ระบบจะแสดงตัวเลือกพร้อมสถานะการบันทึกในส่วนนี้
                </p>
              </div>
            </div>
          </Card>
        )}

        {tab === 'usage' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">การใช้งาน</h2>
              <p className="mt-1 text-sm text-slate-500">
                เปิดหรือปิดระบบอัตโนมัติที่บันทึกกับร้านนี้ได้จริง
              </p>
            </div>
            <TenantSettingsForm
              key={`${tenant.id}-usage`}
              tenant={tenant}
              billing={billing}
              slipCredits={slipCredits}
              pages={[]}
              isFirst={isFirst}
              role={role}
              section="bank-slip"
              embedded
              automationOnly
              slipAccess={slipAccess}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoSetting
                icon={Globe}
                title="ภาษา"
                value="ภาษาไทย"
                note="ภาษาที่แสดงในหน้าจอระบบ"
              />
              <InfoSetting
                icon={Globe}
                title="เขตเวลา"
                value="กรุงเทพฯ (UTC+7)"
                note="ใช้กับเวลาที่แสดงในแดชบอร์ด"
              />
            </div>
            <p className="text-xs leading-5 text-slate-500">
              ภาษาและเขตเวลายังเป็นค่าพื้นฐานของระบบ ไม่ได้บันทึกแยกตามร้าน
            </p>
          </div>
        )}

        {tab === 'security' && (
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:p-6">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-slate-900">สถานะการเชื่อมต่อและสิทธิ์</h2>
                <p className="mt-1 text-sm text-slate-500">
                  ตรวจสอบสถานะจาก Meta โดยไม่แสดงข้อมูลลับ
                </p>
              </div>
              <button
                type="button"
                onClick={refreshConnection}
                disabled={checking}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-4 w-4', checking && 'animate-spin')} aria-hidden />
                {checking ? 'กำลังตรวจสอบ…' : 'ตรวจสอบสิทธิ์อีกครั้ง'}
              </button>
            </div>
            <dl className="grid gap-px bg-slate-100 sm:grid-cols-2">
              <div className="bg-white p-5">
                <dt className="text-xs font-medium text-slate-500">Facebook Page</dt>
                <dd className="mt-2">
                  <StatusPill status={pageStatus}>
                    {connectionStatus === 'verified'
                      ? 'เชื่อมต่อแล้ว'
                      : connectionStatus === 'missing-page'
                        ? 'ยังไม่ได้เลือกเพจ'
                        : connectionStatus === 'missing-token'
                          ? 'ยังไม่ได้เชื่อมต่อ'
                          : connectionStatus === 'limited'
                            ? 'สิทธิ์ยังไม่ครบ'
                            : connectionStatus === 'invalid'
                              ? 'ต้องเชื่อมต่อใหม่'
                              : 'ยังไม่สามารถตรวจสอบสถานะ'}
                  </StatusPill>
                </dd>
                <p className="mt-2 break-all text-xs text-slate-500">
                  {tenant.page_id ? `Page ID: ${tenant.page_id}` : 'ยังไม่ได้เลือกเพจ'}
                </p>
              </div>
              <div className="bg-white p-5">
                <dt className="text-xs font-medium text-slate-500">สิทธิ์ส่งข้อความ</dt>
                <dd className="mt-2">
                  <StatusPill
                    status={
                      connectionStatus === 'verified'
                        ? 'ready'
                        : connectionStatus === 'unverified'
                          ? 'unknown'
                          : 'setup'
                    }
                  >
                    {connectionStatus === 'verified'
                      ? 'ตรวจสอบแล้ว'
                      : connectionStatus === 'unverified'
                        ? 'ยังไม่สามารถตรวจสอบสถานะ'
                        : 'ต้องตรวจสอบสิทธิ์'}
                  </StatusPill>
                </dd>
                <p className="mt-2 text-xs text-slate-500">
                  ตรวจสอบสิทธิ์สำหรับตอบข้อความแล้ว โดยไม่เปิดเผยข้อมูลเชื่อมต่อ
                </p>
              </div>
            </dl>
            <p className="px-5 py-4 text-xs leading-5 text-slate-500 sm:px-6">
              ระบบไม่แสดงข้อมูลลับบนหน้านี้ การตรวจสอบทำผ่านเซิร์ฟเวอร์เมื่อเปิดหน้าหรือกดปุ่ม
              และไม่มีการเก็บประวัติวันเวลาตรวจสอบ
            </p>
          </Card>
        )}
      </section>
    </div>
  )
}

function InfoSetting({
  icon: Icon,
  title,
  value,
  note,
}: {
  icon: LucideIcon
  title: string
  value: string
  note: string
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{title}</p>
        <p className="mt-0.5 text-sm font-medium text-slate-900">{value}</p>
        <p className="mt-0.5 text-xs text-slate-500">{note}</p>
      </div>
    </Card>
  )
}
