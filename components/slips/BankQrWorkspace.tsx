'use client'

import { BankAccountsManager } from '@/components/settings/BankAccountsManager'
import { BankAccountQrUpload } from '@/components/slips/BankAccountQrUpload'

export function BankQrWorkspace({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  return (
    <BankAccountsManager
      tenantId={tenantId}
      canManage={canManage}
      renderAccountQr={(account, disabled, onBusyChange) => (
        <BankAccountQrUpload
          key={account.id}
          tenantId={tenantId}
          account={account}
          disabled={disabled}
          onBusyChange={onBusyChange}
        />
      )}
    />
  )
}
