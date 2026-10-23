import type { ConversationOwner } from '@/lib/features/agents/agent-control-core'
export type HandoverCustomer = {
  id: string
  display_name: string | null
  avatar_url?: string | null
  platform_user_id: string
  platform: string | null
  ownership: ConversationOwner
  conversation_version: number
  agent_opted_out: boolean
}
export function handoverCustomerName(
  customer: Pick<HandoverCustomer, 'id' | 'display_name' | 'platform_user_id'>,
) {
  return (
    customer.display_name?.trim() ||
    `ผู้ใช้ …${(customer.platform_user_id || customer.id).slice(-4)}`
  )
}
export function handoverChannel(platform: string | null | undefined) {
  const id = platform?.trim().toLowerCase()
  if (['facebook', 'messenger', 'facebook_messenger'].includes(id ?? ''))
    return {
      id: 'facebook',
      label: 'Facebook Messenger',
      color: 'bg-blue-50 text-blue-700 ring-blue-100',
    }
  if (id === 'line')
    return { id: 'line', label: 'LINE', color: 'bg-emerald-50 text-emerald-700 ring-emerald-100' }
  if (id === 'lazada')
    return { id: 'lazada', label: 'Lazada', color: 'bg-orange-50 text-orange-700 ring-orange-100' }
  if (['tiktok', 'tik_tok', 'tik-tok'].includes(id ?? ''))
    return { id: 'tiktok', label: 'TikTok', color: 'bg-slate-100 text-slate-800 ring-slate-200' }
  return {
    id: 'unknown',
    label: id ? 'ช่องทางอื่น' : 'ไม่ระบุช่องทาง',
    color: 'bg-slate-50 text-slate-600 ring-slate-200',
  }
}
