import { PageBanner } from '@/components/ui/page-banner'
import { PageHeader } from '@/components/ui/card'
import Link from 'next/link'
import { BankQrWorkspace } from '@/components/slips/BankQrWorkspace'
import { ShieldCheck } from 'lucide-react'
import { SlipsWorkspace, type SlipListRow } from '@/components/slips/SlipsWorkspace'
import { SlipSettingsTab } from '@/components/slips/SlipSettingsTab'
import { SlipOverviewTab } from '@/components/slips/SlipOverviewTab'
import { SlipTabs } from '@/components/slips/SlipTabs'
import type { Billing } from '@/lib/features/billing/plans'
import type { TenantRole, TenantRow } from '@/lib/types'
import { ReceivingCodeManager } from '@/components/slips/ReceivingCodeManager'
import { BankAccountsManager } from '@/components/settings/BankAccountsManager'
import { PaymentAutomationSettings } from '@/components/slips/PaymentAutomationSettings'
import { PaymentChannelStatus } from '@/components/slips/PaymentChannelStatus'
import {
  PaymentChannelsGuide,
  type PaymentChannelTab,
} from '@/components/slips/PaymentChannelsGuide'

export function SlipsDashboard({
  tenant,
  billing,
  role,
  initial,
  activeTab,
  proEnabled = false,
  receivingEnabled = false,
  designerEnabled = false,
}: {
  receivingEnabled?: boolean
  designerEnabled?: boolean
  proEnabled?: boolean
  tenant: TenantRow
  billing: Billing
  role: TenantRole
  initial: SlipListRow[]
  activeTab: 'overview' | 'settings' | PaymentChannelTab
}) {
  const credits = { quota: tenant.slip_quota + tenant.slip_quota_credits, used: tenant.slip_used }
  const canManage = role === 'owner' || role === 'admin'
  if (receivingEnabled) {
    const originalTab: PaymentChannelTab =
      activeTab === 'overview' ? 'history' : activeTab === 'settings' ? 'advanced' : activeTab
    const tab: PaymentChannelTab = designerEnabled
      ? originalTab === 'qr'
        ? 'banks'
        : originalTab === 'advanced'
          ? 'security'
          : originalTab
      : originalTab
    return (
      <div className="mx-0 w-full min-w-0 max-w-none space-y-5 p-4 md:p-8">
        <PageBanner>
          <ShieldCheck aria-hidden className="mb-2 h-8 w-8" />
          <h1 className="text-2xl font-bold">ระบบรับเงินและตรวจสอบสลิป</h1>
          <p className="mt-2 break-words text-sm">
            {tenant.name} · จัดการ QR บัญชีรับเงิน และผลตรวจจากผู้ให้บริการในที่เดียว
          </p>
        </PageBanner>
        <SlipTabs activeTab={tab} extended designer={designerEnabled} />
        <section
          id="slip-tab-panel"
          role="tabpanel"
          aria-labelledby={`slip-tab-${tab}`}
          className="min-w-0 space-y-4"
        >
          <PaymentChannelsGuide tab={tab} designer={designerEnabled} />
          {tab === 'qr' &&
            (canManage ? (
              <ReceivingCodeManager tenantId={tenant.id} />
            ) : (
              <p className="rounded-xl bg-orange-50 p-4 text-sm">
                เฉพาะเจ้าของร้านหรือผู้ดูแลที่มีสิทธิ์เท่านั้นที่ดูข้อมูล QR และหมายเลขผู้รับเต็มได้
              </p>
            ))}
          {tab === 'banks' &&
            (designerEnabled ? (
              <BankQrWorkspace tenantId={tenant.id} canManage={canManage} />
            ) : (
              <BankAccountsManager tenantId={tenant.id} canManage={canManage} />
            ))}
          {tab === 'history' &&
            (proEnabled ? (
              <SlipOverviewTab tenant={tenant} initial={initial} canManage={canManage} />
            ) : (
              <SlipsWorkspace
                key={tenant.id}
                embedded
                initial={initial}
                initialCredits={credits}
                creditBypass={billing.featureBypass === true}
                tenant={{
                  id: tenant.id,
                  name: tenant.name,
                  expectedAmount: tenant.expected_amount,
                }}
              />
            ))}
          {tab === 'automation' && (
            <PaymentAutomationSettings
              tenantId={tenant.id}
              autoVerify={tenant.auto_verify_enabled}
              autoReply={tenant.auto_reply_enabled}
            />
          )}
          {(tab === 'security' || tab === 'advanced') && (
            <PaymentChannelStatus
              tenant={tenant}
              billing={billing}
              security={tab === 'security'}
              canManage={canManage}
            />
          )}
        </section>
      </div>
    )
  }
  return (
    <div className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
      {proEnabled && (
        <PageBanner className="flex flex-wrap items-center justify-between gap-5 shadow-lg shadow-orange-100">
          <div>
            <ShieldCheck className="mb-3 h-8 w-8" />
            <p className="text-xs text-orange-100">ระบบตรวจสอบสลิป · {tenant.name}</p>
            <h1 className="mt-1 text-2xl font-bold">Payment Verification Pro</h1>
            <p className="mt-2 text-sm text-white/90">ตรวจสอบสลิปและจัดการบัญชีรับเงินในที่เดียว</p>
          </div>
          <Link href="/billing" className="rounded-2xl border border-white/30 bg-white/15 p-4">
            <span className="text-xs">เครดิตตรวจสลิปคงเหลือ</span>
            <strong className="mt-1 block text-3xl tabular-nums">
              {Math.max(0, credits.quota - credits.used).toLocaleString('th-TH')}
            </strong>
            <span className="text-xs">เติมเครดิต →</span>
          </Link>
        </PageBanner>
      )}
      {!proEnabled && (
        <PageHeader
          title="ระบบรับเงินและตรวจสอบสลิป"
          description={`${tenant.name} · จัดการบัญชีรับเงินและประวัติการตรวจสลิป`}
        />
      )}
      <SlipTabs activeTab={activeTab} />
      <section id="slip-tab-panel" role="tabpanel" aria-labelledby={`slip-tab-${activeTab}`}>
        {activeTab === 'settings' ? (
          <SlipSettingsTab tenant={tenant} billing={billing} role={role} />
        ) : proEnabled ? (
          <SlipOverviewTab
            tenant={tenant}
            initial={initial}
            canManage={role === 'owner' || role === 'admin'}
          />
        ) : (
          <SlipsWorkspace
            key={tenant.id}
            embedded
            initial={initial}
            initialCredits={credits}
            creditBypass={billing.featureBypass === true}
            tenant={{ id: tenant.id, name: tenant.name, expectedAmount: tenant.expected_amount }}
          />
        )}
      </section>
    </div>
  )
}
