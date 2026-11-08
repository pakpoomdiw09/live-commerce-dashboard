import { NextRequest, NextResponse } from 'next/server'
import { inboxTenant, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { pageTokenFor } from '@/lib/integrations/facebook/client'
import {
  createFacebookSyncPager,
  nextGraphPage,
  type GraphPaging,
  type GraphPage,
} from '@/lib/integrations/facebook/sync-pagination'

export const runtime = 'nodejs'
export const maxDuration = 60

const PAGE_FIELDS = 'id,updated_time,participants,messages{id,message,from,created_time}'

type FacebookProfile = { id?: unknown; name?: unknown }
type FacebookMessage = {
  id?: unknown
  message?: unknown
  from?: FacebookProfile
  created_time?: unknown
}
type FacebookConversation = {
  id?: unknown
  participants?: { data?: FacebookProfile[] }
  messages?: { data?: FacebookMessage[]; paging?: GraphPaging }
}
type CustomerForSync = {
  id: string
  tenant_id: string | null
  last_message_at: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function externalId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function profileName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null
}

async function resolveCustomer(
  db: Awaited<ReturnType<typeof inboxTenant>>['db'],
  tenantId: string,
  psid: string,
  name: string | null,
  retry = false,
): Promise<CustomerForSync> {
  const existing = await db
    .from('customers')
    .select('id,tenant_id,last_message_at')
    .eq('platform', 'facebook')
    .eq('platform_user_id', psid)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) {
    if (existing.data.tenant_id && existing.data.tenant_id !== tenantId)
      throw new InboxError(
        'ลูกค้า Facebook นี้เชื่อมกับร้านค้าอื่น',
        409,
        'CUSTOMER_TENANT_MISMATCH',
      )
    const changes: Record<string, string> = {}
    if (!existing.data.tenant_id) changes.tenant_id = tenantId
    if (name) changes.display_name = name
    if (Object.keys(changes).length) {
      let update = db
        .from('customers')
        .update(changes)
        .eq('id', existing.data.id)
        .eq('platform', 'facebook')
        .eq('platform_user_id', psid)
      update = existing.data.tenant_id
        ? update.eq('tenant_id', tenantId)
        : update.is('tenant_id', null)
      const saved = await update.select('id,tenant_id,last_message_at').maybeSingle()
      if (saved.error) throw saved.error
      if (!saved.data || saved.data.tenant_id !== tenantId)
        throw new InboxError(
          'ลูกค้า Facebook นี้เชื่อมกับร้านค้าอื่น',
          409,
          'CUSTOMER_TENANT_MISMATCH',
        )
      return saved.data as CustomerForSync
    }
    return existing.data as CustomerForSync
  }

  const inserted = await db
    .from('customers')
    .insert({
      platform: 'facebook',
      platform_user_id: psid,
      tenant_id: tenantId,
      display_name: name ?? `ลูกค้า Facebook (${psid.slice(-4)})`,
    })
    .select('id,tenant_id,last_message_at')
    .single()
  if (inserted.error?.code === '23505' && !retry) {
    return resolveCustomer(db, tenantId, psid, name, true)
  }
  if (inserted.error) throw inserted.error
  return inserted.data as CustomerForSync
}

async function conversationMessages(
  firstPage: FacebookConversation['messages'],
  conversationId: string | null,
  pager: ReturnType<typeof createFacebookSyncPager>,
): Promise<FacebookMessage[]> {
  const messages = Array.isArray(firstPage?.data) ? [...firstPage.data] : []
  try {
    if (!firstPage?.paging?.next) return messages
    if (!conversationId) throw new InboxError('ไม่มีรหัสบทสนทนา', 502, 'FACEBOOK_PAGING_INVALID')
    let current = pager.url(
      `${encodeURIComponent(conversationId)}/messages`,
      'id,message,from,created_time',
    )
    let next = nextGraphPage(firstPage.paging, current)
    while (next) {
      current = next
      const page = await pager.read<FacebookMessage>(current)
      messages.push(...page.data)
      next = nextGraphPage(page.paging, current)
    }
  } catch (error) {
    pager.warn(error, 'messages')
  }
  return messages
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin')
    if (origin && origin !== req.nextUrl.origin)
      throw new InboxError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น', 403)
    const input: unknown = await req.json().catch(() => null)
    if (!isRecord(input) || typeof input.tenantId !== 'string')
      throw new InboxError('ข้อมูลร้านค้าไม่ถูกต้อง')
    const { db, tenantId } = await inboxTenant(req, input.tenantId)

    const tenant = await db
      .from('tenants')
      .select('page_id,page_access_token')
      .eq('id', tenantId)
      .eq('is_active', true)
      .maybeSingle()
    if (tenant.error) throw tenant.error
    if (!tenant.data)
      throw new InboxError('ไม่พบเพจ Facebook ที่ใช้งานอยู่', 409, 'PAGE_NOT_LINKED')
    const pageId = tenant.data.page_id
    if (typeof pageId !== 'string' || !/^\d+$/.test(pageId))
      throw new InboxError('ยังไม่ได้ตั้ง Page ID ของร้านค้านี้', 409, 'PAGE_NOT_LINKED')
    const token = pageTokenFor(tenant.data)
    if (!token) throw new InboxError('ไม่พบ Page Access Token', 409, 'PAGE_TOKEN_MISSING')
    const pager = createFacebookSyncPager(token)

    let target: CustomerForSync | null = null
    let targetPsid: string | null = null
    if (input.customerId !== undefined) {
      if (typeof input.customerId !== 'string') throw new InboxError('รหัสลูกค้าไม่ถูกต้อง')
      const customer = await db
        .from('customers')
        .select('id,tenant_id,platform,platform_user_id,last_message_at')
        .eq('id', input.customerId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (customer.error) throw customer.error
      if (!customer.data) throw new InboxError('ไม่พบลูกค้า', 404, 'CUSTOMER_NOT_FOUND')
      if (customer.data.platform !== 'facebook' || !externalId(customer.data.platform_user_id))
        throw new InboxError('ลูกค้ารายนี้ไม่ใช่ Facebook Messenger', 400, 'NOT_FACEBOOK_CUSTOMER')
      target = customer.data as CustomerForSync
      targetPsid = customer.data.platform_user_id
    }

    const pendingMessages: {
      customer_id: string
      external_id: string
      provider_message_id: string
      sender: 'customer' | 'agent'
      body: string | null
      attachments: never[]
      created_at: string
    }[] = []
    const customerRows = new Map<string, CustomerForSync>()
    const latestMessageAt = new Map<string, string>()
    let syncedConversations = 0
    let next: URL | null = pager.url(`${pageId}/conversations`, PAGE_FIELDS)
    let matchedTarget = false
    let pagesRead = 0

    while (next) {
      let page: GraphPage<FacebookConversation>
      try {
        page = await pager.read<FacebookConversation>(next)
        pagesRead++
      } catch (error) {
        if (!pagesRead) throw error
        pager.warn(error, 'conversations')
        break
      }
      for (const conversation of page.data ?? []) {
        if (!pager.hasTime()) {
          pager.warn(
            new InboxError('หมดเวลาซิงค์รอบนี้', 409, 'FACEBOOK_SYNC_LIMIT'),
            'conversations',
          )
          break
        }
        if (!isRecord(conversation)) continue
        const participants = Array.isArray(conversation.participants?.data)
          ? conversation.participants.data
          : []
        const firstMessages = conversation.messages
        const participantProfiles = participants.filter(
          (profile) => profile && externalId(profile.id) && externalId(profile.id) !== pageId,
        )
        const pageMessageCustomers = (Array.isArray(firstMessages?.data) ? firstMessages.data : [])
          .map((message) => message?.from)
          .filter(
            (profile): profile is FacebookProfile =>
              !!externalId(profile?.id) && externalId(profile?.id) !== pageId,
          )
        const allProfiles = [...participantProfiles, ...pageMessageCustomers]
        const targetProfile = target
          ? allProfiles.find((profile) => profile.id === targetPsid)
          : null
        if (target && !targetProfile) continue
        if (target) matchedTarget = true

        const profilesById = new Map<string, FacebookProfile>()
        for (const profile of allProfiles) {
          const id = externalId(profile.id)
          if (id && !profilesById.has(id)) profilesById.set(id, profile)
        }
        if (!profilesById.size) continue
        if (profilesById.size !== 1 && !target) {
          pager.warn(
            new InboxError('บทสนทนามีผู้รับหลายคน', 409, 'FACEBOOK_CONVERSATION_AMBIGUOUS'),
            'messages',
          )
          continue
        }
        const resolved = new Map<string, CustomerForSync>()
        const primaryPsid =
          targetPsid ??
          participantProfiles.map((profile) => externalId(profile.id)).find((id) => id !== null) ??
          [...profilesById.keys()][0]
        for (const [psid, profile] of profilesById) {
          if (target && psid !== targetPsid) continue
          const customer =
            target && psid === targetPsid
              ? target
              : await resolveCustomer(db, tenantId, psid, profileName(profile.name))
          resolved.set(psid, customer)
          customerRows.set(customer.id, customer)
        }

        const messages = await conversationMessages(
          firstMessages,
          externalId(conversation.id),
          pager,
        )
        for (const message of messages) {
          if (!isRecord(message)) continue
          const id = externalId(message.id)
          const senderId = externalId(message.from?.id)
          const createdAt =
            typeof message.created_time === 'string' &&
            Number.isFinite(Date.parse(message.created_time))
              ? new Date(message.created_time).toISOString()
              : null
          if (!id || !createdAt || !senderId) continue
          const customer = senderId === pageId ? resolved.get(primaryPsid) : resolved.get(senderId)
          if (!customer) continue
          pendingMessages.push({
            customer_id: customer.id,
            external_id: id,
            provider_message_id: id,
            sender: senderId === pageId ? 'agent' : 'customer',
            body: typeof message.message === 'string' ? message.message : null,
            attachments: [],
            created_at: createdAt,
          })
          const prior = latestMessageAt.get(customer.id) ?? customer.last_message_at ?? ''
          if (createdAt > prior) latestMessageAt.set(customer.id, createdAt)
        }
        syncedConversations++
      }
      if (target && matchedTarget) break
      if (!pager.hasTime()) break
      try {
        next = nextGraphPage(page.paging, next)
      } catch (error) {
        pager.warn(error, 'conversations')
        break
      }
    }

    if (target && !matchedTarget && !pager.partial)
      throw new InboxError('ไม่พบบทสนทนานี้ใน Facebook', 404, 'FACEBOOK_CONVERSATION_NOT_FOUND')

    for (let offset = 0; offset < pendingMessages.length; offset += 100) {
      const batch = [
        ...new Map(
          pendingMessages.slice(offset, offset + 100).map((row) => [row.external_id, row]),
        ).values(),
      ]
      // Dashboard sends and echoes use local external IDs but share Meta's provider ID.
      const existing = await db
        .from('messages')
        .select('customer_id,provider_message_id')
        .in(
          'provider_message_id',
          batch.map((row) => row.provider_message_id),
        )
        .in(
          'customer_id',
          batch.map((row) => row.customer_id),
        )
      if (existing.error) throw existing.error
      const known = new Set(
        (existing.data ?? []).map((row) => `${row.customer_id}:${row.provider_message_id}`),
      )
      const fresh = batch.filter(
        (row) => !known.has(`${row.customer_id}:${row.provider_message_id}`),
      )
      if (!fresh.length) continue
      const saved = await db.from('messages').upsert(fresh, {
        onConflict: 'external_id',
        ignoreDuplicates: true,
      })
      if (saved.error) throw saved.error
    }
    for (const [customerId, lastMessageAt] of latestMessageAt) {
      const saved = await db
        .from('customers')
        .update({ last_message_at: lastMessageAt })
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .or(`last_message_at.is.null,last_message_at.lt.${lastMessageAt}`)
      if (saved.error) throw saved.error
    }

    return NextResponse.json(
      {
        syncedConversations,
        syncedMessages: pendingMessages.length,
        customerCount: customerRows.size,
        targetFound: target ? matchedTarget : undefined,
        partial: pager.partial,
        warnings: pager.warnings,
        message: pager.partial
          ? 'บันทึกข้อความที่ดึงได้แล้ว แต่ยังซิงค์ไม่ครบ กรุณาลองซิงค์อีกครั้งหรือตรวจสิทธิ์เพจ'
          : undefined,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
