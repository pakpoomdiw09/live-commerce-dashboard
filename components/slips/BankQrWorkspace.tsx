'use client'

import { BankAccountsManager } from '@/components/settings/BankAccountsManager'

export function BankQrWorkspace({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  return <BankAccountsManager tenantId={tenantId} canManage={canManage} withQrUpload />
}
