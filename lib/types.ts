/** Row shapes shared by server and client code. Keep in sync with supabase/*.sql. */

export type {LegacySlipState as SlipStatus, LegacyCustomerOrderState as OrderStatus} from '@/lib/domain-state'
import type {LegacySlipState as SlipStatus, LegacyCustomerOrderState as OrderStatus} from '@/lib/domain-state'


export type Sender = 'customer' | 'bot' | 'agent'

export type TenantRow = {
  id: string
  name: string
  account_name: string | null
  account_number: string | null
  bank_code: string | null
  page_name: string | null
  page_id: string | null
  expected_amount: number | null
  auto_reply_enabled: boolean
  auto_verify_enabled: boolean
  slip_quota: number
  slip_quota_credits: number
  slip_used: number
  /** a Page access token is saved (the token itself is never sent to the dashboard) */
  page_token_set: boolean
  created_at: string
}

/** Dashboard-safe tenant columns: must match the column grant in supabase/security.sql. */
export const TENANT_COLUMNS =
  'id, name, account_name, bank_code, page_id, page_name, expected_amount, auto_reply_enabled, auto_verify_enabled, slip_quota, slip_quota_credits, slip_used, page_token_set, created_at'

/** What a signed-in user may do in one tenant. 'admin' = platform admin (or a server-to-server call). */
export type TenantRole = 'admin' | 'owner' | 'staff'

/** Page link and token verification, independent of profile images and the bot switch. */
export type PageConnectionStatus = 'missing-page' | 'missing-token' | 'verified' | 'limited' | 'invalid' | 'unverified'

export type CustomerRow = {
  id: string
  tenant_id: string | null
  display_name: string | null
  avatar_url?: string | null
  platform_user_id: string
  bot_enabled: boolean
  assigned_user_id?: string | null
  conversation_status?: 'open' | 'closed'
  conversation_version?: number
  inbound_seq?: number
  last_message_at: string | null
  phone: string | null
  address: string | null
  tags: string[]
  notes: string | null
  order_status: OrderStatus
  created_at: string
}

export const CUSTOMER_COLUMNS =
  'id, tenant_id, display_name, avatar_url, platform_user_id, bot_enabled, assigned_user_id, conversation_status, conversation_version, inbound_seq, last_message_at, phone, address, tags, notes, order_status, created_at'
export const CUSTOMER_COLUMNS_WITHOUT_AVATAR =
  'id, tenant_id, display_name, platform_user_id, bot_enabled, assigned_user_id, conversation_status, conversation_version, inbound_seq, last_message_at, phone, address, tags, notes, order_status, created_at'

export function isMissingDatabaseColumn(error: unknown, column: string): boolean {
  if (!error || typeof error !== 'object') return false
  const issue = error as { code?: unknown; message?: unknown }
  return ['42703', 'PGRST204'].includes(String(issue.code ?? ''))
    && typeof issue.message === 'string'
    && issue.message.includes(column)
}

export function isMissingCustomerAvatarColumn(error: unknown): boolean {
  return isMissingDatabaseColumn(error, 'avatar_url')
}

export type Attachment = { type: string; payload?: { url?: string; sticker_id?: number } }

export type MessageRow = {
  inbound_seq?: number | null
  provider_message_id?: string | null
  delivery_status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown' | null
  id: string
  customer_id: string
  sender: Sender
  body: string | null
  attachments: Attachment[] | null
  created_at: string
}

export type SlipRow = {
  id: string
  tenant_id: string | null
  customer_id: string | null
  message_id: string | null
  amount: number | null
  expected_amount: number | null
  trans_ref: string | null
  status: SlipStatus
  note: string | null
  created_at: string
  verified_at: string | null
  approved_at: string | null
  confirmed_at: string | null
}

export const SLIP_COLUMNS =
  'id, tenant_id, customer_id, message_id, amount, expected_amount, trans_ref, status, note, created_at, verified_at, approved_at, confirmed_at'

export type CfOrderStatus = 'pending_payment' | 'paid' | 'cancelled' | 'shipped'

export type OrderRow = {
  id: string
  tenant_id: string
  customer_id: string
  product_id: string | null
  product_name: string
  amount: number
  status: CfOrderStatus
  slip_id: string | null
  paid_at: string | null
  created_at: string
}

/** Full detail for the inspector: the row plus what SlipOK read off the slip. */
export type SlipDetail = SlipRow & {
  imageUrl: string | null
  transferredAt: string | null
  sender: { name: string | null; bank: string | null; account: string | null }
  receiver: { name: string | null; bank: string | null; account: string | null }
  tenantName: string | null
  customerName: string | null
}

export type ProductRow = {
  id: string
  tenant_id: string
  code: string
  name: string
  price: number
  stock: number
  is_active: boolean
  description: string | null
  image_url: string | null
  created_at: string
}

export const PRODUCT_COLUMNS = 'id, tenant_id, code, name, price, stock, is_active, description, image_url, created_at'
